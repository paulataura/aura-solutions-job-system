// Supabase client and every read/write the app makes, in one place.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, BUCKET } from './config.js';

export const sb = window.AURA_TEST_CLIENT || createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

const must = ({ data, error }) => { if (error) throw error; return data; };

// ---------- auth ----------
export async function currentProfile() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const p = must(await sb.from('profiles').select('id, full_name, role, phone, active').eq('id', session.user.id).maybeSingle());
  if (!p) return { id: session.user.id, full_name: session.user.email, role: 'unknown', active: false, email: session.user.email };
  return { ...p, email: session.user.email };
}
export const signIn = (email, password) => sb.auth.signInWithPassword({ email, password }).then(r => { if (r.error) throw r.error; return r.data; });
export const signOut = () => sb.auth.signOut();

// ---------- reference data ----------
export const getCompany = async () => must(await sb.from('company_settings').select('*').limit(1).maybeSingle());
export const getDisposalSites = async () => must(await sb.from('disposal_sites').select('*').eq('active', true).order('site_name'));

// ---------- jobs ----------
const JOB_SELECT = `*, customer:customers(*), site:customer_sites(*), job_type:job_types(id, code, name, requires_waste_workflow),
  disposal:disposal_sites(*), operative:profiles!jobs_assigned_to_fkey(id, full_name, phone)`;

async function selectJobs(q) {
  try { return must(await q(JOB_SELECT)); }
  catch (e) { // relationship name differs: fall back without the operative join
    if (/relationship|foreign key|profiles/i.test(e.message || '')) return must(await q(JOB_SELECT.replace(/,\s*operative:[^)]*\)/, '')));
    throw e;
  }
}

export const myJobs = (userId) => selectJobs(sel => sb.from('jobs').select(sel)
  .eq('assigned_to', userId).in('status', ['issued', 'accepted', 'on_site']).order('job_date', { ascending: true, nullsFirst: false }));

export const reviewJobs = (statuses) => selectJobs(sel => sb.from('jobs').select(sel)
  .in('status', statuses).order('updated_at', { ascending: false }).limit(100));

export async function getJobBundle(jobId) {
  const [job] = await selectJobs(sel => sb.from('jobs').select(sel).eq('id', jobId));
  if (!job) throw new Error('Job not found, or you do not have access to it.');
  const [scope, visits, loads, files] = await Promise.all([
    sb.from('job_scope_sections').select('*').eq('job_id', jobId).order('position').then(must),
    sb.from('job_visits').select('*').eq('job_id', jobId).order('created_at', { ascending: false }).then(must),
    sb.from('job_waste_loads').select('*').eq('job_id', jobId).order('load_number').then(must),
    sb.from('job_files').select('*').eq('job_id', jobId).order('created_at').then(must)
  ]);
  return { job, scope, visit: visits[0] || null, loads, files };
}

export async function ensureVisit(jobId, fields = {}) {
  const existing = must(await sb.from('job_visits').select('*').eq('job_id', jobId).order('created_at', { ascending: false }).limit(1));
  if (existing[0]) return existing[0];
  return must(await sb.from('job_visits').insert({ job_id: jobId, ...fields }).select().single());
}
export const updateVisit = async (id, fields) => must(await sb.from('job_visits').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).select().single());
export const updateJob = async (id, fields) => must(await sb.from('jobs').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).select().single());
export const setStatus = async (jobId, status) => must(await sb.rpc('operative_update_job_status', { p_job_id: jobId, p_new_status: status }));
export const abortJob = async (jobId, reason, notes) => must(await sb.rpc('abort_job', { p_job_id: jobId, p_reason: reason, p_notes: notes }));

// ---------- loads ----------
export async function saveLoad(load) {
  const { id, ...fields } = load;
  if (id) return must(await sb.from('job_waste_loads').update(fields).eq('id', id).select().single());
  return must(await sb.from('job_waste_loads').insert(fields).select().single());
}
export const deleteLoad = async id => must(await sb.from('job_waste_loads').delete().eq('id', id));

// ---------- files ----------
export async function uploadFile(jobId, blob, { fileType, name, caption = null, visitId = null, loadId = null, scopeSectionId = null, userId = null, folder = '' }) {
  const ext = (name.split('.').pop() || 'bin').toLowerCase();
  const path = `jobs/${jobId}/${folder ? folder + '/' : ''}${fileType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || undefined, upsert: false });
  if (up.error) throw up.error;
  const row = { job_id: jobId, visit_id: visitId, file_type: fileType, file_name: name, storage_path: path, caption, uploaded_by: userId };
  if (loadId) row.load_id = loadId;
  if (scopeSectionId) row.scope_section_id = scopeSectionId;
  return must(await sb.from('job_files').insert(row).select().single());
}
export async function signedUrl(path, seconds = 3600) {
  const r = await sb.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (r.error) throw r.error;
  return r.data.signedUrl;
}
export async function signedUrls(paths, seconds = 3600) {
  if (!paths.length) return {};
  const r = await sb.storage.from(BUCKET).createSignedUrls(paths, seconds);
  if (r.error) throw r.error;
  return Object.fromEntries(r.data.filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
}
export async function downloadAsDataUrl(path, maxSide = 1400) {
  const r = await sb.storage.from(BUCKET).download(path);
  if (r.error) throw r.error;
  return blobToJpegDataUrl(r.data, maxSide);
}
export async function blobToJpegDataUrl(blob, maxSide = 1400, quality = 0.85) {
  const bmp = await createImageBitmap(blob);
  const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
export async function deleteFile(file) {
  await sb.storage.from(BUCKET).remove([file.storage_path]);
  must(await sb.from('job_files').delete().eq('id', file.id));
}
