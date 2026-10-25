// Management: review lists, the review screen, approval and documents.
import * as db from './supa.js?v=1.0.1';
import { shell, state, managementTabs } from './main.js?v=1.0.1';
import { esc, has, nl2br, fmtDate, fmtDateTime, fmtLongDate, toLocalInput, fromLocalInput, num, fmtKg, $, $$, toast, busy, confirmBox, ewcFmt, errText } from './util.js?v=1.0.1';
import { STATUS_LABELS, QUANTITY_UNITS, CONTAINER_TYPES, PHYSICAL_FORMS, WEIGHT_UNITS } from './config.js?v=1.0.1';
import { loadKg, unitLabel, loadComplete } from './operator.js?v=1.0.1';
import { parties, wtnProblems, jobSheetHTML, wtnHTML, pagesToPdf, previewHTML } from './documents.js?v=1.0.1';

const LOGO = 'img/logo.png';
const LISTS = {
  review: { title: 'Awaiting review', statuses: ['returned', 'completed'], empty: 'Nothing waiting. Submitted jobs appear here.' },
  approved: { title: 'Approved', statuses: ['reviewed'], empty: 'No approved jobs yet.' },
  live: { title: 'Live jobs', statuses: ['issued', 'accepted', 'on_site'], empty: 'No live jobs.' }
};

// ====================================================================
export async function reviewList(kind) {
  const cfg = LISTS[kind];
  const main = shell({ title: cfg.title, sub: state.profile.full_name, tabs: managementTabs(kind), wide: true });
  main.innerHTML = '<div class="loading">Loading…</div>';
  const jobs = await db.reviewJobs(cfg.statuses);
  const ids = jobs.map(j => j.id);
  let loads = [];
  if (ids.length) { const r = await db.sb.from('job_waste_loads').select('job_id, disposal_status').in('job_id', ids); loads = r.data || []; }
  if (!jobs.length) { main.innerHTML = `<div class="empty">${esc(cfg.empty)}</div>`; return; }
  main.innerHTML = `<div class="card" style="padding:0;overflow:auto"><table class="list">
    <tr><th>Job</th><th>Customer / site</th><th>Type</th><th>Operative</th><th>Date</th><th>Status</th></tr>
    ${jobs.map(j => {
      const jl = loads.filter(l => l.job_id === j.id), pend = jl.filter(l => l.disposal_status !== 'confirmed').length;
      return `<tr class="click" data-open="${j.id}">
        <td><b>${esc(j.job_number)}</b>${has(j.reference) ? `<br><span class="muted small">${esc(j.reference)}</span>` : ''}</td>
        <td><b>${esc(j.customer?.company_name || '')}</b><br><span class="muted small">${esc([j.site?.site_name, j.site?.postcode || j.postcode || j.site_address].filter(has).join(' · '))}</span></td>
        <td>${esc(j.job_type?.name || '')}</td><td>${esc(j.operative?.full_name || '—')}</td>
        <td>${esc(j.job_date ? fmtLongDate(j.job_date) : '—')}</td>
        <td><span class="badge ${j.status === 'returned' ? 'amber' : j.status === 'reviewed' ? '' : 'grey'}">${esc(STATUS_LABELS[j.status] || j.status)}</span>
          ${pend ? `<br><span class="badge grey" style="margin-top:4px">${pend} awaiting disposal</span>` : ''}</td></tr>`;
    }).join('')}</table></div>`;
  $$('[data-open]', main).forEach(tr => tr.onclick = () => {
    const j = jobs.find(x => x.id === tr.dataset.open);
    location.hash = ['issued', 'accepted', 'on_site'].includes(j.status) ? `#/job/${j.id}` : `#/check/${j.id}`;
  });
}

// ====================================================================
let R = null; // { ...bundle, sites, company, urls }

export async function reviewPage(jobId) {
  const main = shell({ title: 'Review job', back: '#/review', wide: true });
  main.innerHTML = '<div class="loading">Loading job…</div>';
  const [bundle, sites, company] = await Promise.all([db.getJobBundle(jobId), db.sb.from('disposal_sites').select('*').order('site_name').then(r => r.data || []), db.getCompany()]);
  const imgs = bundle.files.filter(f => /\.(jpe?g|png|webp)$/i.test(f.storage_path)).map(f => f.storage_path);
  const urls = await db.signedUrls(imgs).catch(() => ({}));
  R = { ...bundle, sites, company, urls };
  draw();
}
const refresh = () => reviewPage(R.job.id);

function draw() {
  const { job, visit, loads } = R;
  const v = visit || {};
  const p = parties(R, R.company);
  const back = job.status === 'reviewed' ? '#/approved' : '#/review';
  const main = shell({ title: `${job.job_number} · ${job.customer?.company_name || ''}`, sub: `${job.job_type?.name || ''} · ${STATUS_LABELS[job.status] || job.status}`, back, wide: true });
  const problems = allProblems();
  const docs = R.files.filter(f => ['job_sheet_pdf', 'wtn_pdf'].includes(f.file_type));
  const legacyWaste = !loads.length && v.waste_removed && (has(v.waste_description) || has(v.waste_type) || has(v.waste_ewc_code) || has(v.ewc_code));
  main.innerHTML = `<div class="cols">
  <div>
    ${job.status === 'aborted' ? `<div class="danger" style="margin-bottom:12px"><b>Stopped by ${esc(job.aborted_by_name || '')}:</b> ${esc(job.abort_reason || '')}<br>${nl2br(job.abort_notes || '')}</div>` : ''}

    <div class="card"><h2>Job and site</h2>
      <dl class="kv"><dt>Client</dt><dd>${esc(p.client.name)}</dd><dt>Site</dt><dd>${esc(p.place)}</dd>
      <dt>Scope</dt><dd style="white-space:pre-wrap">${esc(job.scope_of_work || '')}</dd>
      <dt>Operative</dt><dd>${esc(job.operative?.full_name || '')}</dd>
      <dt>On site</dt><dd>${esc(fmtDateTime(v.arrived_at))} → ${esc(fmtDateTime(v.completed_at || v.submitted_at))}</dd></dl>
    </div>

    <form class="card" id="fWork"><h2>Work carried out</h2>
      ${(Array.isArray(v.work_notes) ? v.work_notes : []).map((n, i) => `<label class="f"><span>${esc(n.title || 'Part ' + (i + 1))}</span><textarea data-wn="${i}">${esc(n.notes || '')}</textarea></label>`).join('')}
      <label class="f"><span>Completion notes (on the job sheet)</span><textarea name="completion_notes">${esc(v.completion_notes || '')}</textarea></label>
      <label class="f"><span>Issues / follow-up</span><textarea name="issues" style="min-height:60px">${esc(v.issues || '')}</textarea></label>
      <div class="grid2">
        <label class="f"><span>Arrived</span><input type="datetime-local" name="arrived_at" value="${v.arrived_at ? esc(toLocalInput(v.arrived_at)) : ''}"></label>
        <label class="f"><span>Completed</span><input type="datetime-local" name="completed_at" value="${(v.completed_at || v.submitted_at) ? esc(toLocalInput(v.completed_at || v.submitted_at)) : ''}"></label>
      </div>
      <div class="grid2">
        <div><span class="small" style="font-weight:600">Customer sign-off</span>${v.customer_signature ? `<img class="sigimg" src="${v.customer_signature}">` : `<p class="warn small">${has(v.customer_unable_reason) ? 'Not signed: ' + esc(v.customer_unable_reason) : 'Not signed'}</p>`}
          <label class="f"><span>Customer name</span><input type="text" name="customer_signed_name" value="${esc(v.customer_signed_name || '')}"></label></div>
        <div><span class="small" style="font-weight:600">Operative</span>${v.operative_signature ? `<img class="sigimg" src="${v.operative_signature}">` : '<p class="warn small">Not signed</p>'}
          <label class="f"><span>Operative name</span><input type="text" name="operative_signed_name" value="${esc(v.operative_signed_name || job.operative?.full_name || '')}"></label></div>
      </div>
      ${visit ? `<button class="btn ghost" type="submit">Save work details</button>` : '<p class="muted">No visit recorded.</p>'}
    </form>

    <form class="card" id="fParties"><h2>WTN parties</h2>
      <p class="muted small" style="margin-top:-4px">Fill these in when the waste producer or site owner isn't the paying client — for example when a broker arranged the job.</p>
      <div class="grid2">
        <label class="f"><span>Producer (transferor) name</span><input type="text" name="producer_name" value="${esc(job.producer_name || '')}" placeholder="${esc(job.customer?.company_name || '')}"></label>
        <label class="f"><span>Producer SIC code</span><input type="text" name="producer_sic_code" value="${esc(job.producer_sic_code || '')}"></label>
      </div>
      <div class="grid2">
        <label class="f"><span>Producer address</span><input type="text" name="producer_address" value="${esc(job.producer_address || '')}" placeholder="Defaults to the site address"></label>
        <label class="f"><span>Producer postcode</span><input type="text" name="producer_postcode" value="${esc(job.producer_postcode || '')}"></label>
      </div>
      <div class="grid2">
        <label class="f"><span>Broker name</span><input type="text" name="broker_name" value="${esc(job.broker_name || '')}"></label>
        <label class="f"><span>Broker registration</span><input type="text" name="broker_registration" value="${esc(job.broker_registration || '')}"></label>
      </div>
      <label class="f"><span>Broker address</span><input type="text" name="broker_address" value="${esc(job.broker_address || '')}"></label>
      <button class="btn ghost" type="submit">Save parties</button>
    </form>

    <div class="card"><h2>Waste loads <span class="count">(${loads.length})</span></h2>
      ${legacyWaste ? `<div class="info" style="margin-bottom:10px">This job was recorded in the old app. Its waste details are on the visit record, not as a load. <button class="btn small" data-convert style="margin-top:8px">Create a load from the old record</button></div>` : ''}
      ${!loads.length && !legacyWaste ? `<p class="muted">${v.waste_removed === false ? 'Operator recorded no waste removed.' : 'No loads recorded.'}</p>` : ''}
      ${loads.map(loadEditor).join('')}
      ${['returned', 'completed', 'reviewed'].includes(job.status) ? `<button class="btn light small" data-add-load>＋ Add a load</button>` : ''}
    </div>

    <div class="card"><h2>Photos</h2>${photoSection()}</div>
  </div>

  <div>
    <div class="card"><h2>Checks</h2>
      ${problems.length ? `<ul class="checklist">${problems.map(x => `<li><span class="tick todo">!</span><span class="lbl">${esc(x)}</span></li>`).join('')}</ul>` : `<p><span class="badge">All required details present</span></p>`}
    </div>
    <div class="card"><h2>Actions</h2><div class="stack">
      <button class="btn ghost block" data-preview>Preview documents</button>
      ${['returned', 'completed'].includes(job.status) ? `<button class="btn block" data-approve ${problems.length ? 'disabled' : ''}>Approve and create documents</button>
        <button class="btn warn block" data-sendback>Send back to operator</button>` : ''}
      ${job.status === 'reviewed' ? `<button class="btn block light" data-approve ${problems.length ? 'disabled' : ''}>Re-create documents</button>
        ${loads.every(l => l.disposal_status === 'confirmed') ? `<button class="btn block" data-close>Close job</button>` : `<p class="muted small">Close the job once every load's disposal is confirmed.</p>`}` : ''}
      ${problems.length && ['returned', 'completed', 'reviewed'].includes(job.status) ? '<p class="muted small">Fix the checks above to enable approval.</p>' : ''}
    </div></div>
    <div class="card"><h2>Documents</h2>
      ${docs.length ? docs.slice().reverse().map(d => `<a class="doclink" href="#" data-doc="${d.id}"><span class="ic">PDF</span><span><b>${esc(d.caption || d.file_name)}</b><br><span class="muted small">${esc(fmtDateTime(d.created_at))}</span></span></a>`).join('') : '<p class="muted">Created when you approve the job.</p>'}
      ${docs.length ? '<p class="muted small">Tap to open. Links you share work for 7 days.</p>' : ''}
    </div>
  </div></div>
  <div id="previewWrap"></div>`;
  wire(main);
}

function allProblems() {
  const { visit, loads, job } = R;
  const v = visit || {};
  const out = [];
  if (!visit) out.push('No visit recorded');
  if (!has(v.completion_notes)) out.push('Completion notes');
  if (!(has(v.customer_signature) || has(v.customer_unable_reason))) out.push('Customer sign-off (signature or reason)');
  if (!has(v.operative_signature)) out.push('Operative signature');
  const wasteJob = job.waste_expected || job.job_type?.requires_waste_workflow;
  if (wasteJob && !loads.length && v.waste_removed !== false) out.push('Waste: add a load, or the operator must record that no waste was removed');
  loads.forEach(l => wtnProblems(l, R, R.company).forEach(x => out.push(`Load ${l.load_number} (${l.wtn_number}): ${x}`)));
  return out;
}

// ---------- load editor ----------
function loadEditor(l) {
  const opts = (list, cur) => list.map(([k, v]) => `<option value="${k}" ${String(cur || '').toLowerCase() === k ? 'selected' : ''}>${v}</option>`).join('');
  const sites = R.sites.map(s => `<option value="${s.id}" ${s.id === l.disposal_site_id ? 'selected' : ''}>${esc(s.site_name)}${s.postcode ? ' · ' + esc(s.postcode) : ''}${s.permit_number ? '' : ' (no permit no.)'}</option>`).join('');
  const kg = loadKg(l);
  return `<form class="load" data-load="${l.id}">
    <div class="head"><b>Load ${l.load_number} · ${esc(l.wtn_number)}</b>
      <span>${loadComplete(l) ? '<span class="badge">Complete</span>' : '<span class="badge amber">Incomplete</span>'} ${l.disposal_status === 'confirmed' ? '<span class="badge">Disposed</span>' : '<span class="badge grey">Awaiting disposal</span>'}</span></div>
    <label class="f"><span>Description</span><input type="text" name="description" value="${esc(l.description || '')}"></label>
    <div class="grid2">
      <label class="f"><span>EWC code</span><input type="text" name="ewc_code" value="${esc(ewcFmt(l.ewc_code))}"></label>
      <label class="f"><span>SIC code</span><input type="text" name="sic_code" value="${esc(l.sic_code || '')}" placeholder="${esc(R.job.producer_sic_code || '')}"></label>
    </div>
    <div class="grid2">
      <label class="f"><span>Quantity</span><input type="number" step="any" name="quantity_value" value="${esc(l.quantity_value ?? '')}"></label>
      <label class="f"><span>Unit</span><select name="quantity_unit"><option value="">—</option>${opts(QUANTITY_UNITS, l.quantity_unit)}</select></label>
    </div>
    <div class="grid2">
      <label class="f"><span>Estimated weight (kg)</span><input type="number" step="any" name="estimated_weight_kg" value="${esc(l.estimated_weight_kg ?? '')}"></label>
      <label class="f"><span>Container</span><select name="container_type"><option value="">—</option>${CONTAINER_TYPES.map(c => `<option ${String(l.container_type || '').toLowerCase() === c.toLowerCase() ? 'selected' : ''}>${c}</option>`).join('')}${l.container_type && !CONTAINER_TYPES.some(c => c.toLowerCase() === l.container_type.toLowerCase()) ? `<option selected>${esc(l.container_type)}</option>` : ''}</select></label>
    </div>
    <div class="grid2">
      <label class="f"><span>Physical form</span><select name="physical_form"><option value="">—</option>${opts(PHYSICAL_FORMS, l.physical_form)}</select></label>
      <label class="f"><span>Vehicle</span><input type="text" name="vehicle_registration" value="${esc(l.vehicle_registration || '')}"></label>
    </div>
    <div class="grid2">
      <label class="f"><span>Transferred at</span><input type="datetime-local" name="collected_at" value="${(l.collected_at || l.transferor_signed_at) ? esc(toLocalInput(l.collected_at || l.transferor_signed_at)) : ''}"></label>
      <label class="f"><span>Transferor signed by</span><input type="text" name="transferor_signed_name" value="${esc(l.transferor_signed_name || '')}"></label>
    </div>
    <label class="check"><input type="checkbox" name="hierarchy_confirmed" ${l.hierarchy_confirmed ? 'checked' : ''}><span>Waste hierarchy confirmed by transferor</span></label>
    <div class="grid2">
      <div><span class="small" style="font-weight:600">Transferor signature</span>${l.transferor_signature ? `<img class="sigimg" src="${l.transferor_signature}">` : '<p class="warn small">Missing</p>'}</div>
      <div><span class="small" style="font-weight:600">Transferee signature</span>${l.transferee_signature ? `<img class="sigimg" src="${l.transferee_signature}">` : '<p class="warn small">Missing</p>'}</div>
    </div>
    <hr class="sep"><h3>Disposal</h3>
    <div class="grid2">
      <label class="f"><span>Disposal site</span><select name="disposal_site_id"><option value="">To be confirmed</option>${sites}</select></label>
      <label class="f"><span>Tipped at</span><input type="datetime-local" name="disposed_at" value="${l.disposed_at ? esc(toLocalInput(l.disposed_at)) : ''}"></label>
    </div>
    <div class="grid2">
      <label class="f"><span>Received by</span><input type="text" name="receiver_name" value="${esc(l.receiver_name || '')}"></label>
      <label class="f"><span>Or: reason not signed</span><input type="text" name="receiver_unable_reason" value="${esc(l.receiver_unable_reason || '')}" placeholder="e.g. Confirmed from weighbridge ticket"></label>
    </div>
    <div class="grid2">
      <label class="f"><span>Ticket no.</span><input type="text" name="ticket_number" value="${esc(l.ticket_number || '')}"></label>
      <label class="f"><span>Weighbridge weight (kg)</span><input type="number" step="any" name="actual_weight_kg" value="${esc(l.actual_weight_kg ?? '')}"></label>
    </div>
    ${l.receiver_signature ? `<img class="sigimg" src="${l.receiver_signature}" style="margin-bottom:8px">` : ''}
    <label class="check"><input type="checkbox" name="disposed" ${l.disposal_status === 'confirmed' ? 'checked' : ''}><span><b>Disposal confirmed</b>${kg ? `<br><span class="muted small">${l.actual_weight_kg ? 'Weighbridge' : 'Estimated'} ${esc(fmtKg(kg))}</span>` : ''}</span></label>
    <div class="row"><button class="btn ghost small" type="submit">Save load</button></div>
  </form>`;
}

function photoSection() {
  const groups = [['arrival_photo', 'Arrival'], ['work_photo', 'Work'], ['load_photo', 'Loads'], ['completion_photo', 'Completion'], ['disposal_ticket', 'Disposal tickets'], ['issue_photo', 'Issues']];
  const html = groups.map(([t, label]) => {
    const list = R.files.filter(f => f.file_type === t && R.urls[f.storage_path]);
    if (!list.length) return '';
    return `<h3>${label}</h3><div class="photos">${list.map(f => `<a class="ph" href="${R.urls[f.storage_path]}" target="_blank" rel="noopener"><img src="${R.urls[f.storage_path]}" alt="">${has(f.caption) ? `<span class="cap">${esc(f.caption)}</span>` : ''}</a>`).join('')}</div>`;
  }).join('');
  return html || '<p class="muted">No photos.</p>';
}

// ---------- wiring ----------
function wire(main) {
  const v = R.visit;
  const fw = $('#fWork', main);
  if (fw && v) fw.onsubmit = e => { e.preventDefault(); busy(fw.querySelector('[type=submit]'), async () => {
    const work_notes = (Array.isArray(v.work_notes) ? v.work_notes : []).map((n, i) => ({ ...n, notes: $(`[data-wn="${i}"]`, fw).value.trim() }));
    await db.updateVisit(v.id, {
      work_notes, completion_notes: fw.completion_notes.value.trim() || null, issues: fw.issues.value.trim() || null,
      arrived_at: fromLocalInput(fw.arrived_at.value) || v.arrived_at, completed_at: fromLocalInput(fw.completed_at.value) || v.completed_at,
      customer_signed_name: fw.customer_signed_name.value.trim() || null, operative_signed_name: fw.operative_signed_name.value.trim() || null
    });
    toast('Saved'); await refresh();
  }); };
  const fp = $('#fParties', main);
  fp.onsubmit = e => { e.preventDefault(); busy(fp.querySelector('[type=submit]'), async () => {
    const f = k => fp[k].value.trim() || null;
    await db.updateJob(R.job.id, { producer_name: f('producer_name'), producer_sic_code: f('producer_sic_code'), producer_address: f('producer_address'), producer_postcode: f('producer_postcode'), broker_name: f('broker_name'), broker_registration: f('broker_registration'), broker_address: f('broker_address') });
    toast('Saved'); await refresh();
  }); };
  $$('form[data-load]', main).forEach(fl => fl.onsubmit = e => { e.preventDefault(); busy(fl.querySelector('[type=submit]'), async () => {
    const l = R.loads.find(x => x.id === fl.dataset.load);
    const t = k => fl[k].value.trim() || null;
    const disposed = fl.disposed.checked;
    if (disposed && (!fl.disposal_site_id.value || !fl.disposed_at.value)) { toast('To confirm disposal, choose the site and the date tipped', 'err'); return; }
    if (disposed && !t('receiver_name') && !t('receiver_unable_reason')) { toast("Add who received it, or why it wasn't signed", 'err'); return; }
    await db.saveLoad({
      id: l.id, description: t('description'), ewc_code: ewcFmt(fl.ewc_code.value) || null, sic_code: t('sic_code'),
      quantity_value: num(fl.quantity_value.value), quantity_unit: fl.quantity_unit.value || null,
      estimated_weight_kg: WEIGHT_UNITS.includes(fl.quantity_unit.value) ? null : num(fl.estimated_weight_kg.value),
      container_type: fl.container_type.value || null, physical_form: fl.physical_form.value || null, vehicle_registration: t('vehicle_registration'),
      collected_at: fromLocalInput(fl.collected_at.value), transferor_signed_name: t('transferor_signed_name'), hierarchy_confirmed: fl.hierarchy_confirmed.checked,
      disposal_site_id: fl.disposal_site_id.value || null, disposed_at: fromLocalInput(fl.disposed_at.value),
      receiver_name: t('receiver_name'), receiver_unable_reason: t('receiver_unable_reason'), ticket_number: t('ticket_number'),
      actual_weight_kg: num(fl.actual_weight_kg.value), disposal_status: disposed ? 'confirmed' : 'pending'
    });
    toast(`Load ${l.load_number} saved`); await refresh();
  }); });
  const add = $('[data-add-load]', main);
  if (add) add.onclick = () => busy(add, async () => {
    const j = R.job;
    await db.saveLoad({ job_id: j.id, load_number: Math.max(0, ...R.loads.map(x => x.load_number)) + 1, description: j.planned_waste_description, ewc_code: j.planned_ewc_code,
      quantity_value: j.planned_waste_quantity, quantity_unit: j.planned_waste_unit, container_type: j.planned_container_type, disposal_site_id: j.disposal_site_id, created_by: state.profile.id });
    toast('Load added — signatures must come from site'); await refresh();
  });
  const conv = $('[data-convert]', main);
  if (conv) conv.onclick = () => busy(conv, convertLegacy);
  $('[data-preview]', main).onclick = e => busy(e.currentTarget, showPreview, 'Building…');
  const ap = $('[data-approve]', main); if (ap) ap.onclick = () => busy(ap, approve, 'Creating documents…');
  const sbk = $('[data-sendback]', main); if (sbk) sbk.onclick = sendBack;
  const cl = $('[data-close]', main);
  if (cl) cl.onclick = () => busy(cl, async () => {
    if (!await confirmBox('Close this job? It moves out of your lists.', 'Close job')) return;
    await db.setStatus(R.job.id, 'closed'); toast('Job closed'); location.hash = '#/approved';
  });
  $$('[data-doc]', main).forEach(a => a.onclick = async e => {
    e.preventDefault();
    const d = R.files.find(f => f.id === a.dataset.doc);
    const w = window.open('', '_blank');
    try { const url = await db.signedUrl(d.storage_path, 60 * 60 * 24 * 7); if (w) w.location = url; else location.href = url; }
    catch (err) { if (w) w.close(); toast(errText(err), 'err'); }
  });
}

async function convertLegacy() {
  const v = R.visit;
  const qty = num(v.waste_quantity_value) ?? num(String(v.waste_quantity || '').match(/[\d.]+/)?.[0]);
  const unit = (v.waste_quantity_unit || String(v.waste_quantity || '').replace(/[\d.\s]+/, '') || '').toLowerCase().trim();
  const site = R.sites.find(s => s.id === R.job.disposal_site_id) || R.sites.find(s => has(v.disposal_site) && v.disposal_site.toLowerCase().includes(s.site_name.toLowerCase().slice(0, 12)));
  await db.saveLoad({
    job_id: R.job.id, load_number: 1, wtn_number: v.waste_transfer_note_number || null,
    description: v.waste_description || v.waste_type, ewc_code: ewcFmt(v.waste_ewc_code || v.ewc_code), sic_code: v.waste_sic_code || R.job.producer_sic_code || R.job.planned_sic_code,
    quantity_value: qty, quantity_unit: unit || null, container_type: v.waste_container_type || R.job.planned_container_type,
    collected_at: v.waste_transfer_at || v.customer_signed_at || v.completed_at, hierarchy_confirmed: !!v.waste_hierarchy_confirmed,
    transferor_signed_name: v.waste_transferor_name || v.customer_signed_name || null, transferor_signature: v.waste_transferor_signature || v.customer_signature,
    transferor_signed_at: v.waste_transferor_signed_at || v.customer_signed_at,
    transferee_signed_name: v.waste_transferee_name || v.operative_signed_name || R.job.operative?.full_name || null, transferee_signature: v.waste_transferee_signature || v.operative_signature,
    transferee_signed_at: v.waste_transferee_signed_at || v.operative_signed_at,
    disposal_site_id: site?.id || null, created_by: state.profile.id
  });
  toast('Load created from the old record. Check every field.'); await refresh();
}

function sendBack() {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal"><h2>Send back to operator</h2><p class="muted small">The job goes back to ${esc(R.job.operative?.full_name || 'the operator')} with your note at the top.</p>
    <label class="f"><span>What needs doing?</span><textarea id="sbNote" placeholder="e.g. Please add a photo of the cleaned chamber and the customer's signature"></textarea></label>
    <div class="row end"><button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes>Send back</button></div></div>`;
  document.body.appendChild(wrap);
  $('[data-no]', wrap).onclick = () => wrap.remove();
  $('[data-yes]', wrap).onclick = e => busy(e.currentTarget, async () => {
    const note = $('#sbNote', wrap).value.trim();
    if (!note) return toast('Say what needs doing', 'err');
    await db.updateJob(R.job.id, { status: 'on_site', review_notes: note, returned_to_operator_at: new Date().toISOString() });
    if (R.visit) await db.updateVisit(R.visit.id, { submitted_at: null });
    wrap.remove(); toast('Sent back to the operator'); location.hash = '#/review';
  });
}

// ---------- documents ----------
async function photoImages(dataUrls) {
  const order = [['arrival_photo', 'On arrival'], ['work_photo', 'Work'], ['load_photo', 'Load'], ['completion_photo', 'On completion']];
  const out = [];
  for (const [t, label] of order) {
    for (const f of R.files.filter(x => x.file_type === t && /\.(jpe?g|png|webp)$/i.test(x.storage_path))) {
      const sec = R.scope.find(s => s.id === f.scope_section_id);
      const load = R.loads.find(l => l.id === f.load_id);
      const lbl = [label === 'Work' ? (f.caption || 'Work') : label, sec?.title, load ? `Load ${load.load_number}` : ''].filter(has).join(' · ');
      out.push({ url: dataUrls ? await db.downloadAsDataUrl(f.storage_path, 1200).catch(() => R.urls[f.storage_path]) : R.urls[f.storage_path], label: lbl, at: f.created_at });
    }
  }
  return out.filter(x => x.url);
}

async function buildPages(forPdf) {
  const images = await photoImages(forPdf);
  const total = 1 + Math.ceil(images.length / 4);
  const sheet = jobSheetHTML(R, R.company, LOGO, images, total);
  const wtns = R.loads.map(l => ({ load: l, html: wtnHTML(l, R, R.company, LOGO) }));
  return { sheet, wtns };
}

async function showPreview() {
  const { sheet, wtns } = await buildPages(false);
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.style.cssText += ';display:block;overflow:auto;padding:20px';
  wrap.innerHTML = `<div style="max-width:830px;margin:0 auto"><div class="row between" style="margin-bottom:10px"><b style="color:#fff">Preview</b><button class="btn small" data-close>Close preview</button></div>
    <div style="transform-origin:top left">${previewHTML([...sheet, ...wtns.map(w => w.html)])}</div></div>`;
  document.body.appendChild(wrap);
  $('[data-close]', wrap).onclick = () => wrap.remove();
  wrap.onclick = e => { if (e.target === wrap) wrap.remove(); };
}

async function approve() {
  const problems = allProblems();
  if (problems.length) { toast('Fix the checks first', 'err'); return; }
  const first = R.job.status !== 'reviewed';
  if (!await confirmBox(first ? `Approve ${R.job.job_number} and create the job sheet${R.loads.length ? ` and ${R.loads.length} WTN${R.loads.length > 1 ? 's' : ''}` : ''}?` : 'Re-create the documents with the latest details?', first ? 'Approve' : 'Re-create')) return;
  const { sheet, wtns } = await buildPages(true);
  const old = R.files.filter(f => ['job_sheet_pdf', 'wtn_pdf'].includes(f.file_type));
  const jobNo = R.job.job_number;
  const sheetPdf = await pagesToPdf(sheet);
  await db.uploadFile(R.job.id, sheetPdf, { fileType: 'job_sheet_pdf', name: `${jobNo}_Job-Sheet.pdf`, caption: `Job sheet ${jobNo}`, visitId: R.visit?.id, userId: state.profile.id, folder: 'documents' });
  for (const w of wtns) {
    const pdf = await pagesToPdf([w.html]);
    await db.uploadFile(R.job.id, pdf, { fileType: 'wtn_pdf', name: `${w.load.wtn_number}.pdf`, caption: `${w.load.wtn_number} · Load ${w.load.load_number}`, visitId: R.visit?.id, loadId: w.load.id, userId: state.profile.id, folder: 'documents' });
  }
  for (const f of old) await db.deleteFile(f).catch(() => {});
  if (first) await db.updateJob(R.job.id, { status: 'reviewed', reviewed_at: new Date().toISOString(), reviewed_by: state.profile.id, reviewed_by_name: state.profile.full_name, review_notes: null });
  toast(first ? 'Approved — documents created' : 'Documents re-created');
  await refresh();
}
