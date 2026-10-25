// Operator view: My jobs list and the step-by-step job screen.
import * as db from './supa.js?v=1.0.2';
import { shell, state, isManagement, managementTabs, DASHBOARD } from './main.js?v=1.0.2';
import { esc, has, nl2br, fmtDate, fmtTime, fmtDateTime, fmtLongDate, todayISO, toLocalInput, fromLocalInput, num, fmtKg,
  $, $$, toast, busy, confirmBox, isHazardousEwc, ewcFmt, errText } from './util.js?v=1.0.2';
import { signaturePad } from './signature.js?v=1.0.2';
import { WEIGHT_UNITS, QUANTITY_UNITS, CONTAINER_TYPES, PHYSICAL_FORMS, STATUS_LABELS } from './config.js?v=1.0.2';

// ====================================================================
// My jobs
// ====================================================================
export async function jobList() {
  const main = shell({ title: 'My jobs', sub: state.profile.full_name || '', tabs: isManagement() ? managementTabs('mine') : '' });
  main.innerHTML = '<div class="loading">Loading your jobs…</div>';
  const jobs = await db.myJobs(state.profile.id);
  const today = todayISO();
  const groups = { 'On site now': [], 'Today': [], 'Coming up': [], 'No date set': [], 'Overdue': [] };
  for (const j of jobs) {
    if (j.status === 'on_site') groups['On site now'].push(j);
    else if (!j.job_date) groups['No date set'].push(j);
    else if (j.job_date === today) groups['Today'].push(j);
    else if (j.job_date < today) groups['Overdue'].push(j);
    else groups['Coming up'].push(j);
  }
  if (!jobs.length) {
    main.innerHTML = `<div class="empty"><h2>No jobs right now</h2><p>New jobs appear here as soon as the office issues them.</p><button class="btn ghost" onclick="location.reload()">Refresh</button></div>`;
    return;
  }
  main.innerHTML = Object.entries(groups).filter(([, l]) => l.length).map(([name, list]) => `
    <h2 style="margin-top:8px">${name} <span class="muted small">(${list.length})</span></h2>
    <div class="joblist" style="margin-bottom:18px">${list.map(jobCard).join('')}</div>`).join('');
}

function jobCard(j) {
  const sent = j.review_notes && j.returned_to_operator_at && j.status === 'on_site';
  return `<a class="jobcard" href="#/job/${j.id}">
    <div class="top">
      <div><div class="name">${esc(j.customer?.company_name || 'Customer')}</div>
      <div class="addr">${esc(siteLine(j))}</div></div>
      ${sent ? '<span class="badge red">Sent back</span>' : `<span class="badge ${j.status === 'on_site' ? 'amber' : ''}">${esc(STATUS_LABELS[j.status] || j.status)}</span>`}
    </div>
    <div class="meta">
      <span>${esc(j.job_type?.name || 'Job')}</span>
      ${j.job_date ? `<span>📅 ${esc(fmtLongDate(j.job_date))}${j.job_time ? ' ' + esc(j.job_time.slice(0, 5)) : ''}</span>` : ''}
      <span>${esc(j.job_number)}</span>
    </div></a>`;
}

const siteName = j => j.site?.site_name || j.producer_name || '';
const siteAddress = j => {
  const addr = j.site?.site_address || j.site_address || '', pc = j.site?.postcode || j.postcode || '';
  return pc && addr.toUpperCase().replace(/\s/g, '').includes(pc.toUpperCase().replace(/\s/g, '')) ? addr : [addr, pc].filter(has).join(', ');
};
const siteLine = j => [siteName(j), siteAddress(j)].filter(has).join(' · ');
const contactName = j => j.site_contact_name || j.site?.site_contact_name || j.customer?.contact_name || '';
const contactPhone = j => j.site_contact_phone || j.site?.site_contact_phone || j.customer?.phone || '';
const isWasteJob = j => !!(j.waste_expected || j.job_type?.requires_waste_workflow);
const isWeightUnit = u => WEIGHT_UNITS.includes(String(u || '').toLowerCase());
export const loadKg = l => l.actual_weight_kg ?? (String(l.quantity_unit).toLowerCase() === 'kg' ? num(l.quantity_value) : String(l.quantity_unit).toLowerCase() === 'tonnes' ? (num(l.quantity_value) ?? 0) * 1000 : num(l.estimated_weight_kg));
export const unitLabel = u => (QUANTITY_UNITS.find(([k]) => k === String(u || '').toLowerCase()) || [u, u || ''])[1];

// ====================================================================
// Job page
// ====================================================================
let ctx = null;  // { job, scope, visit, loads, files, urls, step, sites }

export async function jobPage(jobId, stepOverride) {
  const main = shell({ title: 'Loading job…', back: isManagement() ? DASHBOARD : '#/jobs' });
  main.innerHTML = '<div class="loading">Loading job…</div>';
  const [bundle, sites] = await Promise.all([db.getJobBundle(jobId), db.getDisposalSites().catch(() => [])]);
  const urls = await db.signedUrls(bundle.files.filter(f => /\.(jpe?g|png|webp|heic)$/i.test(f.storage_path)).map(f => f.storage_path)).catch(() => ({}));
  const prevStep = ctx && ctx.job.id === jobId ? ctx.step : null;
  ctx = { ...bundle, urls, sites };
  ctx.step = stepOverride || prevStep || firstOpenStep();
  render();
}

const reload = step => jobPage(ctx.job.id, step);
const editable = () => ['issued', 'accepted', 'on_site'].includes(ctx.job.status);

function steps() {
  const s = [
    { key: 'brief', label: 'Job brief' },
    { key: 'arrive', label: 'Arrive' },
    { key: 'work', label: 'Work carried out' }
  ];
  if (isWasteJob(ctx.job)) s.push({ key: 'waste', label: 'Waste & WTN' });
  s.push({ key: 'signoff', label: 'Sign off' }, { key: 'submit', label: 'Submit' });
  return s;
}

function isDone(key) {
  const { visit, loads, files } = ctx;
  switch (key) {
    case 'brief': return !!visit?.arrived_at;
    case 'arrive': return !!visit?.arrived_at && files.some(f => f.file_type === 'arrival_photo');
    case 'work': return has(visit?.completion_notes);
    case 'waste': return visit?.waste_removed === false || (loads.length > 0 && loads.every(loadComplete));
    case 'signoff': return (has(visit?.customer_signature) && has(visit?.customer_signed_name) || has(visit?.customer_unable_reason)) && has(visit?.operative_signature);
    case 'submit': return !editable();
  }
  return false;
}
function firstOpenStep() {
  if (!editable()) return 'submit';
  const s = steps().find(x => !isDone(x.key));
  return s ? s.key : 'submit';
}
export function loadComplete(l) {
  return has(l.description) && has(l.ewc_code) && num(l.quantity_value) !== null && has(l.quantity_unit) &&
    (isWeightUnit(l.quantity_unit) || num(l.estimated_weight_kg) !== null) && has(l.container_type) &&
    has(l.transferor_signature) && has(l.transferor_signed_name) && l.hierarchy_confirmed && has(l.transferee_signature);
}

function render() {
  const { job } = ctx;
  const st = steps();
  const idx = st.findIndex(s => s.key === ctx.step);
  const main = shell({ title: job.customer?.company_name || 'Job', sub: `${job.job_number} · ${job.job_type?.name || ''}`, back: isManagement() ? DASHBOARD : '#/jobs' });
  const sentBack = job.status === 'on_site' && job.returned_to_operator_at && job.review_notes;
  main.innerHTML = `
    ${sentBack ? `<div class="danger" style="margin-bottom:12px"><b>Sent back by the office:</b><br>${nl2br(job.review_notes)}</div>` : ''}
    ${!editable() && job.status !== 'aborted' ? `<div class="info" style="margin-bottom:12px">This job has been submitted to the office (${esc(STATUS_LABELS[job.status] || job.status)}). It's read-only now.</div>` : ''}
    ${job.status === 'aborted' ? `<div class="danger" style="margin-bottom:12px">This job was stopped: ${esc(job.abort_reason || '')}</div>` : ''}
    <div class="stepper">${st.map((s, i) => `<span class="${i === idx ? 'now' : isDone(s.key) ? 'done' : ''}"></span>`).join('')}</div>
    <div class="steplabel">Step ${idx + 1} of ${st.length}</div>
    <div id="stepBody"></div>
    <details class="more card tight"><summary>All steps</summary>
      <ul class="checklist">${st.map(s => `<li data-go="${s.key}" style="cursor:pointer">
        <span class="tick ${isDone(s.key) ? 'ok' : 'todo'}">${isDone(s.key) ? '✓' : ''}</span><span class="lbl">${s.label}</span>
        ${s.key === ctx.step ? '<span class="badge">Here</span>' : ''}</li>`).join('')}</ul>
    </details>
    ${editable() && job.status !== 'aborted' ? `<div class="center" style="margin-top:18px"><button class="btn warn small" data-cant>Can't complete this job</button></div>` : ''}`;
  $$('[data-go]', main).forEach(li => li.onclick = () => { ctx.step = li.dataset.go; render(); scrollTo(0, 0); });
  const cant = $('[data-cant]', main); if (cant) cant.onclick = cantComplete;
  const body = $('#stepBody', main);
  ({ brief: stepBrief, arrive: stepArrive, work: stepWork, waste: stepWaste, signoff: stepSignoff, submit: stepSubmit })[ctx.step](body);
}

function next() {
  const st = steps(); const i = st.findIndex(s => s.key === ctx.step);
  ctx.step = st[Math.min(i + 1, st.length - 1)].key; render(); scrollTo(0, 0);
}
function bottomBar(html) {
  const bar = document.createElement('div'); bar.className = 'bottombar'; bar.innerHTML = `<div class="inner">${html}</div>`;
  document.querySelector('main').appendChild(bar); return bar;
}

// ---------------- Step 1: brief ----------------
function stepBrief(el) {
  const j = ctx.job;
  const phone = contactPhone(j);
  const addr = siteAddress(j);
  const q = j.site_latitude && j.site_longitude ? `${j.site_latitude},${j.site_longitude}` : addr;
  const w3w = j.what3words || j.site?.what3words;
  const notes = [j.site_location_notes, j.site?.site_location_notes].filter(has);
  el.innerHTML = `
    <h1>Job brief</h1>
    <div class="card">
      <h2>Site contact</h2>
      ${phone ? `<a class="call" href="tel:${esc(phone.replace(/\s/g, ''))}"><span class="ic">✆</span><span><b>${esc(contactName(j) || 'Call site')}</b>${esc(phone)}</span></a>` : `<p class="muted">${esc(contactName(j) || 'No contact given')}</p>`}
    </div>
    <div class="card">
      <h2>Where</h2>
      <p style="margin:0 0 6px"><b>${esc(siteName(j) || j.customer?.company_name || '')}</b><br>${esc(addr)}</p>
      ${q ? `<iframe class="map" loading="lazy" referrerpolicy="no-referrer" src="https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed"></iframe>
        <div class="row"><a class="btn light small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}">Directions</a>
        ${w3w ? `<a class="btn light small" target="_blank" rel="noopener" href="https://what3words.com/${esc(String(w3w).replace(/^\/+/, ''))}">///${esc(String(w3w).replace(/^\/+/, ''))}</a>` : ''}</div>` : ''}
      ${notes.length ? `<h3 style="margin-top:14px">Access and location notes</h3>${notes.map(n => `<div class="note" style="margin-bottom:6px">${nl2br(n)}</div>`).join('')}` : ''}
    </div>
    <div class="card">
      <h2>The job</h2>
      <dl class="kv">
        <dt>Type</dt><dd>${esc(j.job_type?.name || '')}</dd>
        <dt>Date</dt><dd>${esc(j.job_date ? fmtLongDate(j.job_date) : 'Not set')}${j.job_time ? ' · ' + esc(j.job_time.slice(0, 5)) : ''}</dd>
        ${has(j.reference) ? `<dt>Reference</dt><dd>${esc(j.reference)}</dd>` : ''}
        ${has(j.equipment_required) ? `<dt>Equipment</dt><dd>${esc(j.equipment_required)}</dd>` : ''}
      </dl>
      ${has(j.scope_of_work) ? `<h3 style="margin-top:14px">Scope of work</h3><div class="note">${nl2br(j.scope_of_work)}</div>` : ''}
      ${ctx.scope.length ? ctx.scope.map((s, i) => `<div style="margin-top:10px"><b>${i + 1}. ${esc(s.title)}</b>${has(s.details) ? `<div class="muted" style="white-space:pre-wrap">${esc(s.details)}</div>` : ''}${s.photo_path && ctx.urls[s.photo_path] ? `<img src="${ctx.urls[s.photo_path]}" style="border-radius:8px;margin-top:6px;max-height:220px">` : ''}</div>`).join('') : ''}
      ${has(j.instructions) ? `<h3 style="margin-top:14px">Instructions</h3><div class="warn" style="white-space:pre-wrap">${esc(j.instructions)}</div>` : ''}
    </div>
    ${isWasteJob(j) ? `<div class="card"><h2>Expected waste</h2><dl class="kv">
      <dt>Description</dt><dd>${esc(j.planned_waste_description || '—')}</dd>
      <dt>EWC code</dt><dd>${esc(ewcFmt(j.planned_ewc_code) || '—')}</dd>
      <dt>Quantity</dt><dd>${esc([j.planned_waste_quantity, unitLabel(j.planned_waste_unit)].filter(has).join(' ') || '—')}${j.planned_estimated_weight_kg ? ` (est. ${esc(fmtKg(j.planned_estimated_weight_kg))})` : ''}</dd>
      <dt>Container</dt><dd>${esc(j.planned_container_type || '—')}</dd>
      <dt>Disposal site</dt><dd>${esc(j.disposal?.site_name || 'To be confirmed')}</dd></dl></div>` : ''}`;
  if (editable()) bottomBar(`<button class="btn big" data-next>${ctx.visit?.arrived_at ? 'Continue' : 'Start job'}</button>`).querySelector('[data-next]').onclick = next;
}

// ---------------- Step 2: arrive ----------------
function stepArrive(el) {
  const v = ctx.visit;
  el.innerHTML = `
    <h1>Arrive on site</h1>
    <div class="card">
      ${v?.arrived_at ? `<p><span class="badge">On site since ${esc(fmtTime(v.arrived_at))}</span> <span class="muted small">${esc(fmtDate(v.arrived_at))}</span></p>` : `<p>Tap <b>I'm on site</b> when you arrive. It records the time.</p>`}
      <h3>Arrival photo <em style="color:var(--red);font-style:normal">*</em></h3>
      <p class="muted small" style="margin-top:-4px">A photo of the site or work area as you found it.</p>
      ${photoGrid('arrival_photo')}
      ${editable() ? photoButton('arrival_photo', 'Take arrival photo') : ''}
      <label class="f"><span>Arrival notes (optional)</span><textarea id="arrNotes" placeholder="Anything worth noting on arrival">${esc(v?.arrival_notes || '')}</textarea></label>
    </div>`;
  wirePhotos(el, async () => {
    await db.updateVisit(ctx.visit.id, { arrival_notes: $('#arrNotes').value.trim() || null });
    await reload('arrive');
  });
  if (!editable()) return;
  const bar = bottomBar(v?.arrived_at ? `<button class="btn big" data-next>Next</button>` : `<button class="btn big" data-arrive>I'm on site</button>`);
  const arrive = $('[data-arrive]', bar);
  if (arrive) arrive.onclick = () => busy(arrive, async () => {
    await ensureOnSite();
    await db.updateVisit(ctx.visit.id, { arrival_notes: $('#arrNotes').value.trim() || null });
    toast('Arrival recorded');
    await reload('arrive');
  });
  const nx = $('[data-next]', bar);
  if (nx) nx.onclick = () => busy(nx, async () => {
    await db.updateVisit(ctx.visit.id, { arrival_notes: $('#arrNotes').value.trim() || null });
    if (!ctx.files.some(f => f.file_type === 'arrival_photo')) { toast('Add an arrival photo first', 'err'); return; }
    await reload('work');
  });
}

async function ensureOnSite() {
  if (!ctx.visit) ctx.visit = await db.ensureVisit(ctx.job.id, { arrived_at: new Date().toISOString() });
  if (!ctx.visit.arrived_at) ctx.visit = await db.updateVisit(ctx.visit.id, { arrived_at: new Date().toISOString() });
  if (['issued', 'accepted'].includes(ctx.job.status)) ctx.job = { ...ctx.job, ...(await db.setStatus(ctx.job.id, 'on_site')) };
}

// ---------------- photos ----------------
// A photo group is identified by type + optional scope section + optional load.
const gkey = (type, section, load) => `${type}|${section || ''}|${load || ''}`;
const inGroup = (f, type, section, load) => f.file_type === type && (f.scope_section_id || '') === (section || '') && (!load || f.load_id === load);
function photoGrid(type, section = null, load = null) {
  const list = ctx.files.filter(f => inGroup(f, type, section, load));
  return `<div class="photos" data-grid="${gkey(type, section, load)}">${list.map(f => `<div class="ph">${ctx.urls[f.storage_path] ? `<img src="${ctx.urls[f.storage_path]}" alt="">` : '<div class="loading small">Photo</div>'}
    ${editable() && (f.uploaded_by === state.profile.id || isManagement()) ? `<button type="button" data-del-photo="${f.id}" aria-label="Remove photo">✕</button>` : ''}
    ${has(f.caption) ? `<span class="cap">${esc(f.caption)}</span>` : ''}</div>`).join('')}</div>`;
}
function photoButton(type, label, { section = null, load = null, caption = null } = {}) {
  return `<label class="addphoto" data-photo="${type}" data-section="${section || ''}" data-load="${load || ''}" data-caption="${esc(caption || '')}">📷 <span>${esc(label)}</span><input type="file" accept="image/*" capture="environment" multiple></label>`;
}
function refreshGrid(root, type, section, load) {
  const g = $(`[data-grid="${gkey(type, section, load)}"]`, root);
  if (!g) return;
  g.outerHTML = photoGrid(type, section, load);
  wireDeletes(root);
}
function wireDeletes(root) {
  $$('[data-del-photo]', root).forEach(b => b.onclick = async e => {
    e.preventDefault();
    if (!await confirmBox('Remove this photo?', 'Remove')) return;
    const f = ctx.files.find(x => x.id === b.dataset.delPhoto);
    await busy(b, async () => {
      await db.deleteFile(f);
      ctx.files = ctx.files.filter(x => x.id !== f.id);
      refreshGrid(root, f.file_type, f.scope_section_id, f.load_id);
    }, '…');
  });
}
// Uploads stay on the page (no reload) so anything typed in the form is kept.
function wirePhotos(root, onArrival) {
  $$('[data-photo]', root).forEach(lbl => {
    const type = lbl.dataset.photo, section = lbl.dataset.section || null, load = lbl.dataset.load || null, caption = lbl.dataset.caption || null;
    const input = lbl.querySelector('input'), text = lbl.querySelector('span');
    input.onchange = async () => {
      const files = [...input.files]; if (!files.length) return;
      const old = text.textContent; lbl.style.pointerEvents = 'none'; text.textContent = `Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…`;
      try {
        if (type === 'arrival_photo') await ensureOnSite(); else if (!ctx.visit) ctx.visit = await db.ensureVisit(ctx.job.id);
        const added = [];
        for (const file of files) {
          const blob = await compress(file);
          added.push(await db.uploadFile(ctx.job.id, blob, { fileType: type, name: file.name.replace(/\.\w+$/, '') + '.jpg', visitId: ctx.visit.id, userId: state.profile.id, scopeSectionId: section, loadId: load, caption }));
        }
        ctx.files.push(...added);
        Object.assign(ctx.urls, await db.signedUrls(added.map(f => f.storage_path)).catch(() => ({})));
        toast(files.length > 1 ? 'Photos saved' : 'Photo saved');
        if (onArrival) return onArrival();
        refreshGrid(root, type, section, load);
      } catch (e) { toast(errText(e), 'err'); }
      finally { if (lbl.isConnected) { text.textContent = old; lbl.style.pointerEvents = ''; input.value = ''; } }
    };
  });
  wireDeletes(root);
}
async function compress(file) {
  try {
    const url = await db.blobToJpegDataUrl(file, 1600, 0.82);
    return await (await fetch(url)).blob();
  } catch { return file; }
}

// ---------------- Step 3: work ----------------
function stepWork(el) {
  const v = ctx.visit || {};
  const notes = Array.isArray(v.work_notes) ? v.work_notes : [];
  const secs = ctx.scope.length ? ctx.scope : [];
  const ro = !editable() ? 'disabled' : '';
  el.innerHTML = `
    <h1>Work carried out</h1>
    ${secs.map((s, i) => {
      const n = notes.find(x => x.section_id === s.id) || {};
      return `<div class="card">
        <div class="steplabel">Part ${i + 1} of ${secs.length}</div>
        <h2>${esc(s.title)}</h2>
        ${has(s.details) ? `<p class="muted" style="white-space:pre-wrap;margin-top:-4px">${esc(s.details)}</p>` : ''}
        <label class="f"><span>What was done</span><textarea data-sec="${s.id}" ${ro} placeholder="What you did for this part">${esc(n.notes || '')}</textarea></label>
        ${photoGrid('work_photo', s.id)}
        ${editable() ? `<div class="grid2">${photoButton('work_photo', 'Before photo', { section: s.id, caption: 'Before' })}${photoButton('work_photo', 'After photo', { section: s.id, caption: 'After' })}</div>` : ''}
      </div>`;
    }).join('')}
    <div class="card">
      <h2>${secs.length ? 'Summary' : 'What was done'}</h2>
      <label class="f"><span>Completion notes <em>*</em></span><textarea id="compNotes" ${ro} placeholder="Describe the work completed">${esc(v.completion_notes || '')}</textarea>
        <small>This appears on the customer's job sheet.</small></label>
      <label class="f"><span>Issues or follow-up needed</span><textarea id="issues" ${ro} placeholder="Leave blank if none">${esc(v.issues && v.issues !== 'No issues' ? v.issues : '')}</textarea></label>
      ${!secs.length ? `${photoGrid('work_photo')}${editable() ? `<div class="grid2">${photoButton('work_photo', 'Before photo', { caption: 'Before' })}${photoButton('work_photo', 'After photo', { caption: 'After' })}</div>` : ''}` : ''}
    </div>`;
  wirePhotos(el);
  // keep typing safe when a photo upload reloads the page
  $$('textarea', el).forEach(t => t.addEventListener('change', () => saveWork(false)));
  if (!editable()) return;
  const bar = bottomBar(`<button class="btn big" data-next>Save and continue</button>`);
  $('[data-next]', bar).onclick = e => busy(e.currentTarget, async () => {
    if (!$('#compNotes').value.trim()) { toast('Add completion notes first', 'err'); $('#compNotes').focus(); return; }
    await saveWork(true);
    await reload(isWasteJob(ctx.job) ? 'waste' : 'signoff');
  });
}
async function saveWork(strict) {
  if (!ctx.visit) ctx.visit = await db.ensureVisit(ctx.job.id);
  const work_notes = $$('textarea[data-sec]').map(t => ({ section_id: t.dataset.sec, title: ctx.scope.find(s => s.id === t.dataset.sec)?.title || '', notes: t.value.trim() }));
  const fields = { work_notes, completion_notes: $('#compNotes')?.value.trim() || null, issues: $('#issues')?.value.trim() || 'No issues' };
  try { ctx.visit = await db.updateVisit(ctx.visit.id, fields); } catch (e) { if (strict) throw e; }
}

// ---------------- Step 4: waste & WTN ----------------
function stepWaste(el) {
  const { loads, visit } = ctx;
  const noWaste = visit?.waste_removed === false;
  el.innerHTML = `
    <h1>Waste &amp; WTN</h1>
    <p class="muted" style="margin-top:-6px">Add each load you take away. Every load gets its own Waste Transfer Note.</p>
    ${loads.map(l => loadSummary(l)).join('')}
    ${editable() && !noWaste ? `<button class="btn block light" data-add-load style="margin-bottom:12px">＋ Add ${loads.length ? 'another' : 'a'} load</button>` : ''}
    ${!loads.length ? `<label class="check"><input type="checkbox" id="noWaste" ${noWaste ? 'checked' : ''} ${editable() ? '' : 'disabled'}><span><b>No waste was removed on this job</b><br><span class="muted small">Only tick if nothing was taken away.</span></span></label>` : ''}`;
  $$('[data-edit-load]', el).forEach(b => b.onclick = () => loadForm(loads.find(l => l.id === b.dataset.editLoad)));
  $$('[data-dispose]', el).forEach(b => b.onclick = () => disposalForm(loads.find(l => l.id === b.dataset.dispose)));
  const add = $('[data-add-load]', el); if (add) add.onclick = () => loadForm(null);
  const nw = $('#noWaste', el);
  if (nw) nw.onchange = () => busy(null, async () => { if (!ctx.visit) ctx.visit = await db.ensureVisit(ctx.job.id); ctx.visit = await db.updateVisit(ctx.visit.id, { waste_removed: nw.checked ? false : null }); render(); });
  if (!editable()) return;
  const bar = bottomBar(`<button class="btn big" data-next>Continue</button>`);
  $('[data-next]', bar).onclick = () => {
    if (!isDone('waste')) { toast(loads.length ? 'Finish every load (details and both signatures)' : 'Add a load, or tick "No waste was removed"', 'err'); return; }
    next();
  };
}

function loadSummary(l) {
  const ok = loadComplete(l);
  const kg = loadKg(l);
  const site = ctx.sites.find(s => s.id === l.disposal_site_id);
  return `<div class="load">
    <div class="head"><b>Load ${l.load_number} · ${esc(l.wtn_number || '')}</b>${ok ? '<span class="badge">WTN complete</span>' : '<span class="badge amber">Needs finishing</span>'}</div>
    <div class="small">${esc(l.description || 'No description yet')}${has(l.ewc_code) ? ` · EWC ${esc(ewcFmt(l.ewc_code))}` : ''}</div>
    <div class="small muted">${esc([l.quantity_value, unitLabel(l.quantity_unit)].filter(has).join(' '))}${kg ? ` · ${l.actual_weight_kg ? '' : 'est. '}${esc(fmtKg(kg))}` : ''}${has(l.container_type) ? ` · ${esc(l.container_type)}` : ''}</div>
    <div class="small" style="margin-top:6px">${l.disposal_status === 'confirmed' ? `<span class="badge">Disposed ${esc(fmtDate(l.disposed_at))}</span> ${esc(site?.site_name || '')}` : `<span class="badge grey">Awaiting disposal</span> ${esc(site?.site_name || '')}`}</div>
    ${editable() ? `<div class="row" style="margin-top:10px"><button class="btn ghost small" data-edit-load="${l.id}">${ok ? 'View / edit' : 'Finish load'}</button>
      ${ok && l.disposal_status !== 'confirmed' ? `<button class="btn light small" data-dispose="${l.id}">Confirm disposal</button>` : ''}
      ${l.disposal_status === 'confirmed' ? `<button class="btn ghost small" data-dispose="${l.id}">Edit disposal</button>` : ''}</div>` : ''}
  </div>`;
}

function loadForm(load) {
  const j = ctx.job;
  const isNew = !load;
  const l = load || {
    load_number: (Math.max(0, ...ctx.loads.map(x => x.load_number)) + 1),
    description: j.planned_waste_description, ewc_code: j.planned_ewc_code, quantity_value: j.planned_waste_quantity,
    quantity_unit: j.planned_waste_unit, estimated_weight_kg: j.planned_estimated_weight_kg, container_type: j.planned_container_type,
    sic_code: j.producer_sic_code || j.planned_sic_code, disposal_site_id: j.disposal_site_id, physical_form: null, hierarchy_confirmed: false
  };
  const prevLoad = ctx.loads.filter(x => x.id !== l.id).at(-1);
  const units = QUANTITY_UNITS.map(([k, v]) => `<option value="${k}" ${String(l.quantity_unit || '').toLowerCase() === k ? 'selected' : ''}>${v}</option>`).join('');
  const unitKnown = QUANTITY_UNITS.some(([k]) => k === String(l.quantity_unit || '').toLowerCase());
  const containers = CONTAINER_TYPES.map(c => `<option ${String(l.container_type || '').toLowerCase() === c.toLowerCase() ? 'selected' : ''}>${c}</option>`).join('');
  const containerKnown = CONTAINER_TYPES.some(c => c.toLowerCase() === String(l.container_type || '').toLowerCase());
  const forms = PHYSICAL_FORMS.map(([k, v]) => `<label><input type="radio" name="form" value="${k}" ${l.physical_form === k ? 'checked' : ''}><span>${v}</span></label>`).join('');
  const sites = ctx.sites.map(s => `<option value="${s.id}" ${s.id === l.disposal_site_id ? 'selected' : ''}>${esc(s.site_name)}${s.postcode ? ' · ' + esc(s.postcode) : ''}</option>`).join('');
  const main = document.querySelector('main');
  main.innerHTML = `
    <div class="row between"><h1>Load ${l.load_number}${l.wtn_number ? ` <span class="muted small">${esc(l.wtn_number)}</span>` : ''}</h1></div>
    <form id="loadForm" autocomplete="off">
    <div class="card">
      <h2>The waste</h2>
      <label class="f"><span>Description <em>*</em></span><textarea name="description" required style="min-height:70px">${esc(l.description || '')}</textarea></label>
      <div class="grid2">
        <label class="f"><span>EWC code <em>*</em></span><input type="text" name="ewc_code" value="${esc(ewcFmt(l.ewc_code))}" placeholder="e.g. 16 10 02" required inputmode="numeric"></label>
        <label class="f"><span>Producer's SIC code</span><input type="text" name="sic_code" value="${esc(l.sic_code || '')}" inputmode="numeric"></label>
      </div>
      <div id="hazWarn"></div>
      <span class="small" style="font-weight:600">Physical form</span>
      <div class="seg" style="margin-top:5px">${forms}</div>
    </div>
    <div class="card">
      <h2>How much</h2>
      <div class="grid2">
        <label class="f"><span>Quantity <em>*</em></span><input type="number" step="any" min="0" name="quantity_value" value="${esc(l.quantity_value ?? '')}" required inputmode="decimal"></label>
        <label class="f"><span>Unit <em>*</em></span><select name="quantity_unit" required><option value="">Choose…</option>${units}${!unitKnown && has(l.quantity_unit) ? `<option selected value="${esc(l.quantity_unit)}">${esc(l.quantity_unit)}</option>` : ''}</select></label>
      </div>
      <label class="f" id="estWrap"><span>Estimated weight (kg) <em>*</em></span><input type="number" step="any" min="0" name="estimated_weight_kg" value="${esc(l.estimated_weight_kg ?? '')}" inputmode="decimal">
        <small>Needed because the quantity isn't a weight. Your best estimate is fine — the tip's weighbridge figure can be added at disposal.</small></label>
      <label class="f"><span>Container <em>*</em></span><select name="container_type" required><option value="">Choose…</option>${containers}${!containerKnown && has(l.container_type) ? `<option selected>${esc(l.container_type)}</option>` : ''}</select></label>
      <label class="f"><span>Vehicle registration</span><input type="text" name="vehicle_registration" value="${esc(l.vehicle_registration || prevLoad?.vehicle_registration || '')}" style="text-transform:uppercase"></label>
      <label class="f"><span>Going to (disposal site)</span><select name="disposal_site_id"><option value="">To be confirmed</option>${sites}</select></label>
      <label class="check"><input type="checkbox" name="contains_pops" ${l.contains_pops ? 'checked' : ''}><span>Contains persistent organic pollutants (POPs)<br><span class="muted small">Leave unticked if not.</span></span></label>
      <label class="f" id="popsWrap" style="display:none"><span>Which POPs and how much</span><input type="text" name="pops_details" value="${esc(l.pops_details || '')}"></label>
    </div>
    <div class="card">
      <h2>Customer signs the WTN</h2>
      <p class="muted small" style="margin-top:-4px">The person handing over the waste (transferor).</p>
      <label class="f"><span>Name <em>*</em></span><input type="text" name="transferor_signed_name" value="${esc(l.transferor_signed_name || prevLoad?.transferor_signed_name || contactName(j))}"></label>
      <label class="check"><input type="checkbox" name="hierarchy_confirmed" ${l.hierarchy_confirmed ? 'checked' : ''}><span><b>Waste hierarchy</b> <em style="color:var(--red);font-style:normal">*</em><br><span class="small">I confirm I have applied the waste hierarchy as required by Regulation 12 of the Waste (England and Wales) Regulations 2011.</span></span></label>
      <div id="padTor"></div>
    </div>
    <div class="card">
      <h2>You sign the WTN</h2>
      <p class="muted small" style="margin-top:-4px">You're receiving the waste for Aura Solutions (transferee).</p>
      <label class="f"><span>Your name</span><input type="text" name="transferee_signed_name" value="${esc(l.transferee_signed_name || state.profile.full_name || '')}"></label>
      <div id="padTee"></div>
      ${prevLoad?.transferee_signature && !l.transferee_signature ? `<button type="button" class="btn ghost small" data-reuse-tee>Use my signature from Load ${prevLoad.load_number}</button>` : ''}
    </div>
    <div class="card">
      <h3>Load photos</h3>
      ${l.id ? photoGrid('load_photo', null, l.id) + photoButton('load_photo', 'Add photo of the load', { load: l.id }) : '<p class="muted small">Save the load first to add photos.</p>'}
    </div>
    </form>
    ${!isNew ? `<div class="center"><button class="btn warn small" data-del-load>Delete this load</button></div>` : ''}`;
  const f = $('#loadForm');
  const padTor = signaturePad($('#padTor'), l.transferor_signature);
  const padTee = signaturePad($('#padTee'), l.transferee_signature);
  const reuse = $('[data-reuse-tee]'); if (reuse) reuse.onclick = () => { padTee.set(prevLoad.transferee_signature); reuse.remove(); };
  const syncUnit = () => { $('#estWrap').style.display = isWeightUnit(f.quantity_unit.value) ? 'none' : ''; };
  const syncHaz = () => {
    $('#hazWarn').innerHTML = isHazardousEwc(f.ewc_code.value)
      ? `<div class="danger" style="margin-bottom:12px"><b>Hazardous waste (code with *).</b> A standard WTN isn't valid — it needs a Hazardous Waste Consignment Note. Call the office before you take it.</div>` : '';
  };
  const syncPops = () => { $('#popsWrap').style.display = f.contains_pops.checked ? '' : 'none'; };
  f.quantity_unit.onchange = syncUnit; f.ewc_code.oninput = syncHaz; f.contains_pops.onchange = syncPops;
  syncUnit(); syncHaz(); syncPops();
  if (l.id) wirePhotos(main);
  const del = $('[data-del-load]');
  if (del) del.onclick = async () => { if (!await confirmBox(`Delete Load ${l.load_number}? Its WTN number won't be reused.`, 'Delete')) return; await busy(del, async () => { await db.deleteLoad(l.id); await reload('waste'); }); };

  const bar = bottomBar(`<button class="btn ghost" data-cancel>Back</button><button class="btn" data-save>Save load</button>`);
  $('[data-cancel]', bar).onclick = () => render();
  $('[data-save]', bar).onclick = e => busy(e.currentTarget, async () => {
    const ewc = ewcFmt(f.ewc_code.value);
    if (isHazardousEwc(ewc)) { toast('Hazardous waste needs a consignment note — contact the office', 'err'); return; }
    const row = {
      id: l.id, job_id: j.id, load_number: l.load_number,
      description: f.description.value.trim() || null, ewc_code: ewc || null, hazardous: false,
      sic_code: f.sic_code.value.trim() || null, physical_form: f.form.value || null,
      quantity_value: num(f.quantity_value.value), quantity_unit: f.quantity_unit.value || null,
      estimated_weight_kg: isWeightUnit(f.quantity_unit.value) ? null : num(f.estimated_weight_kg.value),
      container_type: f.container_type.value || null, vehicle_registration: f.vehicle_registration.value.trim().toUpperCase() || null,
      disposal_site_id: f.disposal_site_id.value || null,
      contains_pops: f.contains_pops.checked, pops_details: f.contains_pops.checked ? (f.pops_details.value.trim() || null) : null,
      transferor_signed_name: f.transferor_signed_name.value.trim() || null, hierarchy_confirmed: f.hierarchy_confirmed.checked,
      transferee_signed_name: f.transferee_signed_name.value.trim() || null
    };
    if (!padTor.isEmpty()) { row.transferor_signature = padTor.toDataURL(); if (!l.transferor_signed_at || row.transferor_signature !== l.transferor_signature) row.transferor_signed_at = new Date().toISOString(); }
    else { row.transferor_signature = null; row.transferor_signed_at = null; }
    if (!padTee.isEmpty()) { row.transferee_signature = padTee.toDataURL(); if (!l.transferee_signed_at || row.transferee_signature !== l.transferee_signature) row.transferee_signed_at = new Date().toISOString(); }
    else { row.transferee_signature = null; row.transferee_signed_at = null; }
    if (row.transferor_signature && !l.collected_at) row.collected_at = row.transferor_signed_at;
    if (isNew) { row.created_by = state.profile.id; delete row.id; }
    if (!ctx.visit) await ensureOnSite();
    if (ctx.visit.waste_removed !== true) ctx.visit = await db.updateVisit(ctx.visit.id, { waste_removed: true });
    const saved = await db.saveLoad(row);
    const missing = [];
    if (!loadComplete(saved)) {
      if (!has(saved.description)) missing.push('description');
      if (!has(saved.ewc_code)) missing.push('EWC code');
      if (saved.quantity_value === null || !has(saved.quantity_unit)) missing.push('quantity');
      if (!isWeightUnit(saved.quantity_unit) && saved.estimated_weight_kg === null) missing.push('estimated weight');
      if (!has(saved.container_type)) missing.push('container');
      if (!saved.hierarchy_confirmed) missing.push('waste hierarchy tick');
      if (!has(saved.transferor_signature) || !has(saved.transferor_signed_name)) missing.push("customer's name and signature");
      if (!has(saved.transferee_signature)) missing.push('your signature');
      toast(`Saved. Still needed: ${missing.join(', ')}`, 'err');
      await jobPage(j.id, 'waste'); loadForm(ctx.loads.find(x => x.id === saved.id));
      return;
    }
    toast(`Load ${saved.load_number} saved · ${saved.wtn_number}`);
    await reload('waste');
  });
  scrollTo(0, 0);
}

function disposalForm(l) {
  const site0 = l.disposal_site_id || ctx.job.disposal_site_id;
  const sites = ctx.sites.map(s => `<option value="${s.id}" ${s.id === site0 ? 'selected' : ''}>${esc(s.site_name)}${s.postcode ? ' · ' + esc(s.postcode) : ''}</option>`).join('');
  const unable = has(l.receiver_unable_reason);
  const main = document.querySelector('main');
  main.innerHTML = `
    <h1>Confirm disposal · Load ${l.load_number}</h1>
    <p class="muted" style="margin-top:-6px">${esc(l.wtn_number)} · ${esc(l.description || '')}</p>
    <form id="dispForm">
    <div class="card">
      <label class="f"><span>Receiving site <em>*</em></span><select name="site" required><option value="">Choose…</option>${sites}</select></label>
      <div id="permit" class="small muted" style="margin:-6px 0 12px"></div>
      <label class="f"><span>Date and time tipped <em>*</em></span><input type="datetime-local" name="at" value="${esc(toLocalInput(l.disposed_at))}" required></label>
    </div>
    <div class="card">
      <h2>Receiver signs</h2>
      <div class="seg"><label><input type="radio" name="mode" value="sign" ${unable ? '' : 'checked'}><span>Receiver signs</span></label><label><input type="radio" name="mode" value="unable" ${unable ? 'checked' : ''}><span>Unable to sign</span></label></div>
      <div id="signWrap">
        <label class="f"><span>Receiver's name <em>*</em></span><input type="text" name="receiver_name" value="${esc(l.receiver_name || '')}"></label>
        <div id="padRec"></div>
      </div>
      <label class="f" id="unableWrap"><span>Why not? <em>*</em></span><input type="text" name="unable" value="${esc(l.receiver_unable_reason || '')}" placeholder="e.g. Unmanned site, ticket issued at weighbridge"></label>
    </div>
    <div class="card">
      <h2>Ticket (optional)</h2>
      <div class="grid2">
        <label class="f"><span>Ticket / weighbridge no.</span><input type="text" name="ticket" value="${esc(l.ticket_number || '')}"></label>
        <label class="f"><span>Actual weight (kg)</span><input type="number" step="any" min="0" name="actual" value="${esc(l.actual_weight_kg ?? '')}" inputmode="decimal"></label>
      </div>
      <label class="f"><span>Waste tracking ID (if the site gives one)</span><input type="text" name="dwt" value="${esc(l.waste_tracking_id || '')}"></label>
      ${photoGrid('disposal_ticket', null, l.id)}
      ${photoButton('disposal_ticket', 'Photo of ticket', { load: l.id, caption: 'Disposal ticket' })}
      <label class="f"><span>Notes</span><textarea name="notes" style="min-height:60px">${esc(l.disposal_notes || '')}</textarea></label>
    </div>
    </form>`;
  const f = $('#dispForm');
  const pad = signaturePad($('#padRec'), l.receiver_signature);
  const syncMode = () => { const u = f.mode.value === 'unable'; $('#signWrap').style.display = u ? 'none' : ''; $('#unableWrap').style.display = u ? '' : 'none'; };
  const syncPermit = () => { const s = ctx.sites.find(x => x.id === f.site.value); $('#permit').textContent = s ? [s.address, s.postcode].filter(has).join(', ') + (s.permit_number ? ` · Permit ${s.permit_number}` : ' · Permit number not set (office can add it)') : ''; };
  $$('input[name=mode]', f).forEach(r => r.onchange = syncMode); f.site.onchange = syncPermit;
  syncMode(); syncPermit();
  wirePhotos(main);
  const bar = bottomBar(`<button class="btn ghost" data-cancel>Back</button><button class="btn" data-save>Confirm disposal</button>`);
  $('[data-cancel]', bar).onclick = () => render();
  $('[data-save]', bar).onclick = e => busy(e.currentTarget, async () => {
    const unableMode = f.mode.value === 'unable';
    if (!f.site.value) return toast('Choose the receiving site', 'err');
    if (!f.at.value) return toast('Enter when it was tipped', 'err');
    if (unableMode && !f.unable.value.trim()) return toast('Say why the receiver could not sign', 'err');
    if (!unableMode && (!f.receiver_name.value.trim() || pad.isEmpty())) return toast("Receiver's name and signature are needed", 'err');
    await db.saveLoad({
      id: l.id, disposal_site_id: f.site.value, disposed_at: fromLocalInput(f.at.value), disposal_status: 'confirmed',
      receiver_name: unableMode ? null : f.receiver_name.value.trim(), receiver_signature: unableMode ? null : pad.toDataURL(),
      receiver_signed_at: unableMode ? null : (l.receiver_signed_at || new Date().toISOString()),
      receiver_unable_reason: unableMode ? f.unable.value.trim() : null,
      ticket_number: f.ticket.value.trim() || null, actual_weight_kg: num(f.actual.value), waste_tracking_id: f.dwt.value.trim() || null,
      disposal_notes: f.notes.value.trim() || null
    });
    toast('Disposal confirmed');
    await reload('waste');
  });
  scrollTo(0, 0);
}

// ---------------- Step 5: sign off ----------------
function stepSignoff(el) {
  const v = ctx.visit || {};
  const unable = has(v.customer_unable_reason);
  const withSig = ctx.loads.filter(l => has(l.transferor_signature)).at(-1);
  const withTee = ctx.loads.filter(l => has(l.transferee_signature)).at(-1);
  el.innerHTML = `
    <h1>Sign off</h1>
    <div class="card">
      <h2>Customer</h2>
      <p class="muted small" style="margin-top:-4px">The customer confirms the work on the job sheet.</p>
      <div class="seg"><label><input type="radio" name="mode" value="sign" ${unable ? '' : 'checked'}><span>Customer signs</span></label><label><input type="radio" name="mode" value="unable" ${unable ? 'checked' : ''}><span>No one available</span></label></div>
      <div id="custSign">
        <label class="f"><span>Customer name <em>*</em></span><input type="text" id="custName" value="${esc(v.customer_signed_name || withSig?.transferor_signed_name || contactName(ctx.job))}"></label>
        <div id="padCust"></div>
        ${withSig && !has(v.customer_signature) ? `<button class="btn ghost small" data-reuse-cust>Use the signature from Load ${withSig.load_number}'s WTN</button>` : ''}
      </div>
      <label class="f" id="custUnable"><span>Reason <em>*</em></span><input type="text" id="custReason" value="${esc(v.customer_unable_reason || '')}" placeholder="e.g. Site unmanned, customer informed by phone"></label>
    </div>
    <div class="card">
      <h2>You</h2>
      <label class="f"><span>Your name</span><input type="text" id="opName" value="${esc(v.operative_signed_name || state.profile.full_name || '')}"></label>
      <div id="padOp"></div>
      ${withTee && !has(v.operative_signature) ? `<button class="btn ghost small" data-reuse-op>Use my signature from Load ${withTee.load_number}</button>` : ''}
    </div>`;
  const padCust = signaturePad($('#padCust', el), v.customer_signature);
  const padOp = signaturePad($('#padOp', el), v.operative_signature);
  const rc = $('[data-reuse-cust]', el); if (rc) rc.onclick = () => { padCust.set(withSig.transferor_signature); $('#custName').value = withSig.transferor_signed_name || $('#custName').value; rc.remove(); };
  const ro = $('[data-reuse-op]', el); if (ro) ro.onclick = () => { padOp.set(withTee.transferee_signature); ro.remove(); };
  const syncMode = () => { const u = $('input[name=mode]:checked', el).value === 'unable'; $('#custSign').style.display = u ? 'none' : ''; $('#custUnable').style.display = u ? '' : 'none'; };
  $$('input[name=mode]', el).forEach(r => r.onchange = syncMode); syncMode();
  if (!editable()) { $$('input,button', el).forEach(x => x.disabled = true); return; }
  const bar = bottomBar(`<button class="btn big" data-next>Save and continue</button>`);
  $('[data-next]', bar).onclick = e => busy(e.currentTarget, async () => {
    const unableMode = $('input[name=mode]:checked', el).value === 'unable';
    const now = new Date().toISOString();
    if (unableMode && !$('#custReason').value.trim()) return toast('Give a reason why the customer could not sign', 'err');
    if (!unableMode && (!$('#custName').value.trim() || padCust.isEmpty())) return toast("Customer's name and signature are needed", 'err');
    if (padOp.isEmpty()) return toast('Add your signature', 'err');
    if (!ctx.visit) await ensureOnSite();
    const custSig = unableMode ? null : padCust.toDataURL();
    const opSig = padOp.toDataURL();
    ctx.visit = await db.updateVisit(ctx.visit.id, {
      customer_signature: custSig, customer_signed_name: unableMode ? null : $('#custName').value.trim(),
      customer_signed_at: unableMode ? null : (custSig === v.customer_signature ? v.customer_signed_at : now),
      customer_unable_reason: unableMode ? $('#custReason').value.trim() : null,
      operative_signature: opSig, operative_signed_name: $('#opName').value.trim() || state.profile.full_name,
      operative_signed_at: opSig === v.operative_signature ? v.operative_signed_at : now
    });
    await reload('submit');
  });
}

// ---------------- Step 6: submit ----------------
function stepSubmit(el) {
  const st = steps().filter(s => s.key !== 'submit');
  const allDone = st.every(s => isDone(s.key));
  const pending = ctx.loads.filter(l => l.disposal_status !== 'confirmed');
  el.innerHTML = `
    <h1>${editable() ? 'Submit to office' : 'Submitted'}</h1>
    <div class="card">
      <ul class="checklist">${st.map(s => `<li data-go2="${s.key}" style="cursor:pointer"><span class="tick ${isDone(s.key) ? 'ok' : 'todo'}">${isDone(s.key) ? '✓' : '!'}</span>
        <span class="lbl">${s.label}${isDone(s.key) ? '' : '<small>Not finished — tap to go back</small>'}</span></li>`).join('')}</ul>
    </div>
    ${pending.length && editable() ? `<div class="info" style="margin-bottom:12px">${pending.length === 1 ? 'One load is' : `${pending.length} loads are`} still awaiting disposal. You can submit now — confirm disposal from the load later, or the office will.</div>` : ''}
    ${!editable() && ctx.visit?.submitted_at ? `<div class="card"><p>Submitted ${esc(fmtDateTime(ctx.visit.submitted_at))}. The office will review it and send the job sheet${ctx.loads.length ? ' and WTNs' : ''} to the customer.</p></div>` : ''}`;
  $$('[data-go2]', el).forEach(li => li.onclick = () => { ctx.step = li.dataset.go2; render(); scrollTo(0, 0); });
  if (!editable()) return;
  const bar = bottomBar(`<button class="btn big" data-submit ${allDone ? '' : 'disabled'}>Submit job</button>`);
  $('[data-submit]', bar).onclick = e => busy(e.currentTarget, async () => {
    if (!await confirmBox('Submit this job to the office? You won\'t be able to change it after.', 'Submit')) return;
    const now = new Date().toISOString();
    await db.updateVisit(ctx.visit.id, { completed_at: ctx.visit.completed_at || now, left_site_at: ctx.visit.left_site_at || now, submitted_at: now });
    await db.setStatus(ctx.job.id, 'returned');
    toast('Job submitted. Thank you!');
    location.hash = '#/jobs';
  }, 'Submitting…');
}

// ---------------- can't complete ----------------
function cantComplete() {
  const main = document.querySelector('main');
  main.innerHTML = `
    <h1>Can't complete this job</h1>
    <div class="card">
      <label class="f"><span>Reason <em>*</em></span><select id="abReason"><option value="">Choose…</option>
        <option>No access to site</option><option>Customer cancelled on site</option><option>Unsafe to proceed</option>
        <option>Waste not as described</option><option>Equipment or vehicle problem</option><option>Weather</option><option>Other</option></select></label>
      <label class="f"><span>What happened <em>*</em></span><textarea id="abNotes" placeholder="Explain so the office can rebook or follow up"></textarea></label>
      ${photoGrid('issue_photo')}
      ${photoButton('issue_photo', 'Add a photo (recommended)', { caption: 'Issue' })}
    </div>`;
  wirePhotos(main);
  const bar = bottomBar(`<button class="btn ghost" data-cancel>Back</button><button class="btn" style="background:var(--red)" data-stop>Stop job</button>`);
  $('[data-cancel]', bar).onclick = () => render();
  $('[data-stop]', bar).onclick = e => busy(e.currentTarget, async () => {
    const r = $('#abReason').value, n = $('#abNotes').value.trim();
    if (!r || !n) return toast('Choose a reason and explain what happened', 'err');
    if (!await confirmBox('Stop this job and tell the office?', 'Stop job')) return;
    await db.abortJob(ctx.job.id, r, n);
    toast('The office has been told');
    location.hash = '#/jobs';
  });
}
