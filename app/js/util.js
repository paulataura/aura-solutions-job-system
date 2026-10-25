// Small shared helpers: escaping, dates, DOM, toasts.

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const has = v => v !== null && v !== undefined && String(v).trim() !== '';
export const nl2br = v => esc(v).replace(/\n/g, '<br>');

const TZ = 'Europe/London';
export function fmtDate(v) {
  if (!v) return '';
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00Z') : new Date(v);
  return d.toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function fmtTime(v) {
  if (!v) return '';
  return new Date(v).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}
export const fmtDateTime = v => v ? `${fmtDate(v)} at ${fmtTime(v)}` : '';
export function fmtLongDate(v) {
  if (!v) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00Z') : new Date(v);
  return d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
}
export function todayISO() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p; // YYYY-MM-DD
}
// Value for <input type="datetime-local"> in UK time
export function toLocalInput(v) {
  const d = v ? new Date(v) : new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
// Read a datetime-local value as UK time and return an ISO string
export function fromLocalInput(s) {
  if (!s) return null;
  const guess = new Date(s + ':00Z');
  // find the UK offset at that moment
  const ukStr = toLocalInput(guess.toISOString());
  const diff = (new Date(ukStr + ':00Z') - guess);
  return new Date(guess.getTime() - diff).toISOString();
}

export const num = v => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
export const fmtKg = kg => kg === null || kg === undefined ? '' : (kg >= 1000 ? `${(kg / 1000).toLocaleString('en-GB', { maximumFractionDigits: 3 })} tonnes` : `${Number(kg).toLocaleString('en-GB')} kg`);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, kind = 'ok') {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = `toast ${kind} show`;
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'err' ? 6000 : 2800);
}

export function errText(e) {
  if (!e) return 'Something went wrong.';
  const m = e.message || e.error_description || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No connection. Check your signal and try again.';
  return m;
}

// Disable a button while an async action runs; shows errors as a toast.
export async function busy(btn, fn, label = 'Saving…') {
  const old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = label; }
  try { return await fn(); }
  catch (e) { console.error(e); toast(errText(e), 'err'); return undefined; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}

export function confirmBox(message, okLabel = 'Yes') {
  return new Promise(res => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal"><p>${esc(message)}</p><div class="row end"><button class="btn ghost" data-no>Cancel</button><button class="btn" data-yes>${esc(okLabel)}</button></div></div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('[data-no]').onclick = () => { wrap.remove(); res(false); };
    wrap.querySelector('[data-yes]').onclick = () => { wrap.remove(); res(true); };
  });
}

export const isHazardousEwc = code => /\*/.test(String(code || ''));
export const ewcFmt = code => {
  const d = String(code || '').replace(/[^0-9*]/g, '');
  const digits = d.replace(/\*/g, '');
  if (digits.length !== 6) return String(code || '').trim();
  return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)}${d.includes('*') ? '*' : ''}`;
};
