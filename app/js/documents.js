// Job sheet and Waste Transfer Note documents: data rules, HTML layout and PDF output.
import { esc, has, nl2br, fmtDate, fmtTime, fmtDateTime, fmtKg, num, ewcFmt, isHazardousEwc } from './util.js';
import { WEIGHT_UNITS } from './config.js';
import { loadKg, unitLabel } from './operator.js';

// Join address parts, skipping a postcode the address already contains
const join = (...a) => a.filter(has).reduce((acc, part) => {
  const cur = acc.join(', ').toUpperCase().replace(/\s+/g, '');
  if (cur && cur.includes(String(part).toUpperCase().replace(/\s+/g, ''))) return acc;
  return [...acc, String(part).trim()];
}, []).join(', ');

// ---------- who is who on the WTN ----------
export function parties(b, company) {
  const { job } = b;
  const site = job.site || {};
  const cust = job.customer || {};
  const siteAddr = join(site.site_address || job.site_address, site.postcode || job.postcode);
  return {
    client: { name: cust.company_name, contact: cust.contact_name, address: join(cust.address, cust.postcode), phone: cust.phone, email: cust.email },
    transferor: {
      name: job.producer_name || cust.company_name,
      address: has(job.producer_name) ? (join(job.producer_address, job.producer_postcode) || siteAddr) : (join(cust.address, cust.postcode) || siteAddr),
      capacity: 'Producer of the waste'
    },
    broker: has(job.broker_name) ? { name: job.broker_name, address: job.broker_address, registration: job.broker_registration } : null,
    transferee: {
      name: company?.company_name || 'Aura Solutions Group Limited',
      address: join(company?.business_address, company?.postcode),
      capacity: `Registered waste carrier (${company?.waste_carrier_type || 'upper tier'})`,
      registration: company?.waste_carrier_registration,
      expires: company?.waste_carrier_expires_at
    },
    place: join(site.site_name || job.producer_name, siteAddr) || siteAddr,
    siteName: site.site_name || job.producer_name || cust.company_name,
    siteAddress: siteAddr
  };
}

// ---------- legal checks (Duty of Care Regulations 1991 + Waste Regs 2011) ----------
export function wtnProblems(load, b, company) {
  const p = parties(b, company);
  const out = [];
  const need = (ok, msg) => { if (!ok) out.push(msg); };
  need(has(load.description), 'Waste description');
  need(has(load.ewc_code), 'EWC code');
  need(!isHazardousEwc(load.ewc_code), 'Hazardous code — needs a consignment note, not a WTN');
  need(num(load.quantity_value) !== null && has(load.quantity_unit), 'Quantity and unit');
  need(WEIGHT_UNITS.includes(String(load.quantity_unit).toLowerCase()) || num(load.estimated_weight_kg) !== null || num(load.actual_weight_kg) !== null, 'Estimated weight');
  need(has(load.container_type), 'Container type (or loose)');
  need(has(load.sic_code || b.job.producer_sic_code), "Producer's SIC code");
  need(has(p.transferor.name) && has(p.transferor.address), 'Transferor name and address');
  need(has(p.transferee.registration), 'Your waste carrier registration (company settings)');
  need(has(p.place), 'Place of transfer');
  need(!!(load.collected_at || load.transferor_signed_at), 'Date and time of transfer');
  need(load.hierarchy_confirmed, 'Waste hierarchy declaration');
  need(has(load.transferor_signature) && has(load.transferor_signed_name), "Transferor's name and signature");
  need(has(load.transferee_signature), "Transferee's signature");
  if (p.broker) need(has(p.broker.registration), 'Broker registration number');
  return out;
}

// ---------- HTML ----------
const CSS = `
.aura-doc{font:11px/1.45 "Helvetica Neue",Arial,sans-serif;color:#17221b}
.aura-doc *{box-sizing:border-box}
.aura-doc .sheet{position:relative;width:794px;height:1123px;background:#fff;padding:52px 52px 44px;display:flex;flex-direction:column;overflow:hidden;margin:0 0 12px}
.aura-doc .sheet > *{flex-shrink:0}
.aura-doc .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2f6b3a;padding-bottom:8px;margin-bottom:10px}
.aura-doc .head img{height:58px}
.aura-doc .co{text-align:right;font-size:9.5px;color:#4a5a4f;line-height:1.4}
.aura-doc .co b{color:#17221b;font-size:11px}
.aura-doc h1{font-size:19px;margin:0 0 2px;color:#2f6b3a}
.aura-doc .sub{color:#4a5a4f;margin-bottom:10px;display:flex;justify-content:space-between;align-items:flex-end}
.aura-doc .badge{display:inline-block;background:#2f6b3a;color:#fff;border-radius:4px;padding:3px 9px;font-weight:700;font-size:12px}
.aura-doc .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.aura-doc .box{border:1px solid #cdd6cf;border-radius:5px;overflow:hidden;margin-bottom:8px}
.aura-doc .grid .box{margin:0}
.aura-doc .box h3{margin:0;background:#eef4ef;color:#2f6b3a;font-size:10px;text-transform:uppercase;letter-spacing:.6px;padding:5px 8px;border-bottom:1px solid #cdd6cf}
.aura-doc .in{padding:6px 8px}
.aura-doc table.dkv{width:100%;border-collapse:collapse}
.aura-doc table.dkv td{padding:2px 0;vertical-align:top}
.aura-doc table.dkv td.k{color:#5b6b60;width:36%;padding-right:6px}
.aura-doc table.dkv td.v{font-weight:600}
.aura-doc table.t{width:100%;border-collapse:collapse}
.aura-doc table.t th{text-align:left;font-size:9.5px;color:#5b6b60;font-weight:600;padding:3px 4px;border-bottom:1px solid #cdd6cf}
.aura-doc table.t td{padding:4px;border-bottom:1px solid #edf1ee;font-weight:600;vertical-align:top}
.aura-doc .pre{white-space:pre-wrap}
.aura-doc .sigs{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.aura-doc .sig{border:1px solid #cdd6cf;border-radius:5px;padding:6px 8px}
.aura-doc .sig .lbl{font-size:9.5px;color:#5b6b60;text-transform:uppercase;letter-spacing:.5px;font-weight:700}
.aura-doc .sig .img{height:54px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #9aa79e;margin:4px 0}
.aura-doc .sig .img img{max-height:52px;max-width:100%}
.aura-doc .sig .none{color:#8a978e;font-style:italic}
.aura-doc .photos{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.aura-doc .photo{border:1px solid #cdd6cf;border-radius:5px;overflow:hidden}
.aura-doc .photo img{width:100%;height:405px;object-fit:cover;display:block}
.aura-doc .photo .cap{padding:5px 8px;font-size:10px;color:#4a5a4f}
.aura-doc .photo .cap b{color:#17221b}
.aura-doc .decl{font-size:9.5px;color:#33423a;background:#f6f8f6;border:1px solid #dfe5e0;border-radius:5px;padding:6px 8px;margin-bottom:8px}
.aura-doc .foot{margin-top:auto;padding-top:8px;border-top:1px solid #dfe5e0;font-size:8.5px;color:#6b7a70;display:flex;justify-content:space-between}
`;

const kv = rows => `<table class="dkv">${rows.filter(r => has(r[1])).map(([k, v, raw]) => `<tr><td class="k">${esc(k)}</td><td class="v">${raw ? v : nl2br(v)}</td></tr>`).join('')}</table>`;
const box = (title, inner) => `<div class="box"><h3>${esc(title)}</h3><div class="in">${inner}</div></div>`;
const sig = (label, img, name, at, noneText) => `<div class="sig"><div class="lbl">${esc(label)}</div><div class="img">${img ? `<img src="${img}">` : `<span class="none">${esc(noneText || 'Not signed')}</span>`}</div>${esc(name || '')}${at ? `<br><span style="color:#5b6b60">Signed ${esc(fmtDateTime(at))}</span>` : ''}</div>`;

function head(logo, company, right) {
  return `<div class="head"><img src="${logo}"><div class="co">${right || `<b>${esc(company?.company_name || 'AURA SOLUTIONS GROUP LIMITED')}</b><br>${esc(join(company?.business_address, company?.postcode))}<br>${esc([company?.waste_carrier_type, company?.waste_carrier_registration].filter(has).join(' · '))}`}</div></div>`;
}
const qtyText = l => {
  const q = [l.quantity_value, unitLabel(l.quantity_unit)].filter(has).join(' ');
  const kg = loadKg(l);
  if (WEIGHT_UNITS.includes(String(l.quantity_unit).toLowerCase())) return q + (l.actual_weight_kg ? ` (weighbridge ${fmtKg(l.actual_weight_kg)})` : '');
  return q + (kg ? ` (${l.actual_weight_kg ? 'weighbridge' : 'estimated'} ${fmtKg(kg)})` : '');
};

export function jobSheetHTML(b, company, logo, images, totalPages) {
  const { job, visit, loads, scope } = b;
  const p = parties(b, company);
  const v = visit || {};
  const notes = (Array.isArray(v.work_notes) ? v.work_notes : []).filter(n => has(n.notes));
  const done = v.completed_at || v.submitted_at;
  const pages = [];
  pages.push(`<section class="sheet">
    ${head(logo, company)}
    <h1>Job Completion Sheet</h1>
    <div class="sub"><span>${esc(job.job_type?.name || 'Job')}${done ? ` · Completed ${esc(fmtDate(done))}` : ''}</span><span class="badge">${esc(job.job_number)}</span></div>
    <div class="grid">
      ${box('Client', kv([['Client', p.client.name], ['Contact', p.client.contact], ['Address', p.client.address], ['Phone / email', [p.client.phone, p.client.email].filter(has).join(' · ')]]))}
      ${box('Site', kv([['Site', p.siteName], ['Address', p.siteAddress], ['Site contact', [job.site_contact_name, job.site_contact_phone].filter(has).join(' · ')], ['Your reference', job.reference]]))}
    </div>
    ${box('Job details', kv([['Scope of work', job.scope_of_work], ['Instructions', job.instructions], ['Operative', v.operative_signed_name || job.operative?.full_name], ['Arrived on site', fmtDateTime(v.arrived_at)], ['Work completed', fmtDateTime(done)]]))}
    ${box('Work carried out', `${notes.length ? notes.map(n => `<div style="margin-bottom:5px"><b>${esc(n.title)}</b><div class="pre">${esc(n.notes)}</div></div>`).join('') : ''}${kv([['Completion notes', v.completion_notes], ['Issues / follow-up', has(v.issues) ? v.issues : 'None reported']])}`)}
    ${loads.length ? box('Waste removed', `<table class="t"><tr><th>Load</th><th>Waste</th><th>EWC</th><th>Quantity</th><th>WTN</th><th>Disposal</th></tr>${loads.map(l => {
      const site = b.sites?.find(s => s.id === l.disposal_site_id);
      return `<tr><td>${l.load_number}</td><td>${esc(l.description)}</td><td>${esc(ewcFmt(l.ewc_code))}</td><td>${esc(qtyText(l))}</td><td>${esc(l.wtn_number)}</td><td>${l.disposal_status === 'confirmed' ? `${esc(site?.site_name || '')}<br><span style="font-weight:400">${esc(fmtDate(l.disposed_at))}</span>` : `${esc(site?.site_name || '')}<br><span style="font-weight:400">Awaiting disposal</span>`}</td></tr>`;
    }).join('')}</table>`) : (v.waste_removed === false ? box('Waste removed', 'No waste removed on this job.') : '')}
    <div class="sigs" style="margin-top:auto;margin-bottom:8px">
      ${sig('Customer sign-off', v.customer_signature, v.customer_signed_name, v.customer_signed_at, has(v.customer_unable_reason) ? `Not signed: ${v.customer_unable_reason}` : '')}
      ${sig('Operative', v.operative_signature, v.operative_signed_name, v.operative_signed_at)}
    </div>
    <div class="foot" style="margin-top:0"><span>${esc(company?.company_name || '')} · Job ${esc(job.job_number)}</span><span>Page 1 of ${totalPages}</span></div>
  </section>`);
  for (let i = 0; i < images.length; i += 4) {
    const chunk = images.slice(i, i + 4);
    pages.push(`<section class="sheet">
      ${head(logo, company, `<b>Job ${esc(job.job_number)}</b><br>${esc(p.siteName || '')}<br>${esc(done ? fmtDate(done) : '')}`)}
      <h1>Site Photos</h1><div class="sub"><span>Photos taken on site</span></div>
      <div class="photos">${chunk.map(im => `<div class="photo"><img src="${im.url}"><div class="cap"><b>${esc(im.label)}</b>${im.at ? ` · ${esc(fmtDateTime(im.at))}` : ''}</div></div>`).join('')}</div>
      <div class="foot"><span>${esc(company?.company_name || '')} · Job ${esc(job.job_number)}</span><span>Page ${pages.length + 1} of ${totalPages}</span></div>
    </section>`);
  }
  return pages;
}

export function wtnHTML(load, b, company, logo) {
  const p = parties(b, company);
  const site = b.sites?.find(s => s.id === load.disposal_site_id);
  const transferAt = load.collected_at || load.transferor_signed_at;
  const dest = site ? join(site.site_name, site.address, site.postcode) + (site.permit_number ? ` (permit ${site.permit_number})` : '') : '';
  const disposed = load.disposal_status === 'confirmed';
  return `<section class="sheet">
    ${head(logo, company)}
    <h1>Waste Transfer Note</h1>
    <div class="sub"><span>Duty of care: Environmental Protection Act 1990, s.34 · Job ${esc(b.job.job_number)} · Load ${load.load_number}</span><span class="badge">${esc(load.wtn_number)}</span></div>
    ${box('Section A – Description of the waste', kv([
      ['Description', load.description], ['EWC / List of Waste code', `${ewcFmt(load.ewc_code)} (non-hazardous)`],
      ['Physical form', load.physical_form ? load.physical_form[0].toUpperCase() + load.physical_form.slice(1) : ''],
      ['Quantity', qtyText(load)], ['How is it contained', load.container_type],
      ["Producer's SIC code", load.sic_code || b.job.producer_sic_code],
      ['POPs', load.contains_pops ? (load.pops_details || 'Contains POPs') : (load.contains_pops === false ? 'None declared' : '')]
    ]))}
    <div class="grid">
      ${box('Section B – Transferor (current holder)', kv([['Name', p.transferor.name], ['Address', p.transferor.address], ['Capacity', p.transferor.capacity],
        ...(p.broker ? [['Arranged by broker', join(p.broker.name, p.broker.address)], ['Broker registration', p.broker.registration]] : [])]))}
      ${box('Section C – Transferee (receiving the waste)', kv([['Name', p.transferee.name], ['Address', p.transferee.address], ['Capacity', p.transferee.capacity],
        ['Registration no.', [p.transferee.registration, p.transferee.expires ? `(expires ${fmtDate(p.transferee.expires)})` : ''].filter(has).join(' ')], ['Vehicle', load.vehicle_registration]]))}
    </div>
    ${box('Section D – The transfer', kv([['Place of transfer (collection address)', p.place], ['Date and time of transfer', fmtDateTime(transferAt)], ['Destination (disposal site)', dest]]))}
    ${disposed ? box('Confirmation of disposal', kv([['Received at', site ? join(site.site_name, site.postcode) : ''], ['Date and time', fmtDateTime(load.disposed_at)],
      ['Received by', load.receiver_name || (has(load.receiver_unable_reason) ? `Not signed: ${load.receiver_unable_reason}` : '')], ['Ticket no.', load.ticket_number],
      ['Weighbridge weight', load.actual_weight_kg ? fmtKg(load.actual_weight_kg) : ''], ['Waste tracking ID', load.waste_tracking_id]])) : ''}
    <div class="decl"><b>Waste hierarchy declaration.</b> ${load.hierarchy_confirmed ? '☑' : '☐'} The transferor confirms they have fulfilled their duty to apply the waste hierarchy as required by Regulation 12 of the Waste (England and Wales) Regulations 2011.</div>
    <div class="sigs" ${disposed && load.receiver_signature ? 'style="grid-template-columns:1fr 1fr 1fr"' : ''}>
      ${sig("Transferor's signature", load.transferor_signature, load.transferor_signed_name, load.transferor_signed_at)}
      ${sig("Transferee's signature", load.transferee_signature, [load.transferee_signed_name, p.transferee.name].filter(has).join(' · '), load.transferee_signed_at)}
      ${disposed && load.receiver_signature ? sig('Receiving site', load.receiver_signature, load.receiver_name, load.receiver_signed_at) : ''}
    </div>
    <div class="foot"><span>Both parties must keep this note for at least two years. · ${esc(load.wtn_number)}</span><span>Page 1 of 1</span></div>
  </section>`;
}

// ---------- PDF ----------
let libs;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the PDF tools. Check your connection.')); document.head.appendChild(s); }); }
async function pdfLibs() {
  if (!libs) libs = (async () => {
    if (!window.html2canvas) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  })();
  return libs;
}

// Render HTML pages (strings with <section class="sheet">) into one A4 PDF Blob.
export async function pagesToPdf(pages, { onProgress } = {}) {
  await pdfLibs();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;z-index:-1';
  host.innerHTML = `<style>${CSS}</style><div class="aura-doc">${pages.join('')}</div>`;
  document.body.appendChild(host);
  try {
    await Promise.all([...host.querySelectorAll('img')].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const sheets = [...host.querySelectorAll('.sheet')];
    for (let i = 0; i < sheets.length; i++) {
      onProgress?.(i + 1, sheets.length);
      const c = await window.html2canvas(sheets[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      if (i) pdf.addPage();
      pdf.addImage(c.toDataURL('image/jpeg', 0.88), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }
    return pdf.output('blob');
  } finally { host.remove(); }
}

// Preview HTML (same pages, scaled) for the review screen
export function previewHTML(pages) {
  return `<style>${CSS}.aura-doc .sheet{box-shadow:0 1px 6px rgba(0,0,0,.15)}</style><div class="aura-doc">${pages.join('')}</div>`;
}
