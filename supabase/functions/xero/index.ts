// Aura Solutions – Xero connection (office users only).
// Holds the Xero tokens server-side; the browser never sees them.
// Secrets needed (Supabase → Edge Functions → Secrets): XERO_CLIENT_ID, XERO_CLIENT_SECRET
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("XERO_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("XERO_CLIENT_SECRET") || "";
const REDIRECT = `${SUPABASE_URL}/functions/v1/xero-callback`;
const SCOPES = "openid profile email offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings accounting.attachments";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function officeUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: p } = await admin.from("profiles").select("id,full_name,role,active").eq("id", uid).maybeSingle();
  if (!p || p.active === false || !["admin", "manager"].includes(p.role)) return null;
  return p;
}

async function connection() {
  const { data } = await admin.from("xero_connection").select("*").eq("id", 1).maybeSingle();
  if (!data?.refresh_token) throw new Error("Xero is not connected yet.");
  if (data.expires_at && new Date(data.expires_at).getTime() > Date.now() + 60_000) return data;
  const r = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`) },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: data.refresh_token }),
  });
  const t = await r.json();
  if (!r.ok) throw new Error("Xero sign-in has expired – please reconnect Xero. (" + (t.error || r.status) + ")");
  const upd = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(Date.now() + (t.expires_in || 1800) * 1000).toISOString(), updated_at: new Date().toISOString() };
  await admin.from("xero_connection").update(upd).eq("id", 1);
  return { ...data, ...upd };
}

async function xero(path: string, init: RequestInit = {}) {
  const c = await connection();
  const r = await fetch("https://api.xero.com/api.xro/2.0/" + path, {
    ...init,
    headers: { Authorization: "Bearer " + c.access_token, "Xero-tenant-id": c.tenant_id, Accept: "application/json", ...(init.headers || {}) },
  });
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) {
    const v = body?.Elements?.[0]?.ValidationErrors?.map((e: any) => e.Message).join("; ") || body?.Message || body?.Detail || text || r.status;
    throw new Error("Xero: " + v);
  }
  return body;
}

const q = (s: string) => String(s || "").replace(/"/g, '\\"');
function dueDate30EOM(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)).toISOString().slice(0, 10); }

async function ensureContact(table: "customers" | "suppliers", id: string) {
  const { data: c } = await admin.from(table).select("*").eq("id", id).maybeSingle();
  if (!c) throw new Error("Contact not found.");
  if (c.xero_contact_id) return c.xero_contact_id as string;
  const name = c.company_name || c.name;
  const found = await xero(`Contacts?where=${encodeURIComponent(`Name=="${q(name)}"`)}`);
  let cid = found?.Contacts?.[0]?.ContactID;
  if (!cid) {
    const created = await xero("Contacts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Contacts: [{ Name: name, EmailAddress: c.invoice_email || c.accounts_email || c.email || undefined, Phones: c.phone ? [{ PhoneType: "DEFAULT", PhoneNumber: c.phone }] : undefined, Addresses: (c.address || c.postcode) ? [{ AddressType: "POBOX", AddressLine1: c.address || "", PostalCode: c.postcode || "" }] : undefined }] }),
    });
    cid = created?.Contacts?.[0]?.ContactID;
  }
  if (!cid) throw new Error("Could not find or create the contact in Xero.");
  await admin.from(table).update({ xero_contact_id: cid }).eq("id", id);
  return cid as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await officeUser(req);
    if (!user) return json({ error: "Only office users can use the Xero link." }, 403);
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "connect") {
      if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "The Xero app keys haven't been added to Supabase yet (XERO_CLIENT_ID and XERO_CLIENT_SECRET)." }, 400);
      const state = crypto.randomUUID().replace(/-/g, "");
      await admin.from("xero_oauth_state").insert({ state, user_id: user.id, user_name: user.full_name });
      const url = "https://login.xero.com/identity/connect/authorize?" + new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT, scope: SCOPES, state });
      return json({ url });
    }

    if (action === "disconnect") {
      await admin.from("xero_connection").update({ access_token: null, refresh_token: null, expires_at: null, tenant_id: null, tenant_name: null }).eq("id", 1);
      return json({ ok: true });
    }

    if (action === "options") {
      const [acc, tax, themes] = await Promise.all([xero("Accounts"), xero("TaxRates"), xero("BrandingThemes")]);
      return json({
        accounts: (acc?.Accounts || []).filter((a: any) => a.Status === "ACTIVE" && ["REVENUE", "SALES", "OTHERINCOME"].includes(a.Type)).map((a: any) => ({ code: a.Code, name: a.Name })),
        expenseAccounts: (acc?.Accounts || []).filter((a: any) => a.Status === "ACTIVE" && ["DIRECTCOSTS", "EXPENSE", "OVERHEADS"].includes(a.Type)).map((a: any) => ({ code: a.Code, name: a.Name })),
        taxRates: (tax?.TaxRates || []).filter((t: any) => t.Status === "ACTIVE").map((t: any) => ({ type: t.TaxType, name: t.Name, rate: t.EffectiveRate, sales: t.CanApplyToRevenue, purchases: t.CanApplyToExpenses })),
        themes: (themes?.BrandingThemes || []).map((t: any) => ({ id: t.BrandingThemeID, name: t.Name })),
      });
    }

    if (action === "save_settings") {
      const { data } = await admin.from("xero_connection").select("settings").eq("id", 1).maybeSingle();
      const settings = { ...(data?.settings || {}), ...(body.settings || {}) };
      await admin.from("xero_connection").upsert({ id: 1, settings, updated_at: new Date().toISOString() });
      return json({ ok: true, settings });
    }

    if (action === "create_invoice") {
      const { data: job } = await admin.from("jobs").select("id,job_number,reference,customer_po,customer_id,xero_invoice_id").eq("id", body.job_id).maybeSingle();
      if (!job) return json({ error: "Job not found." }, 404);
      if (job.xero_invoice_id) return json({ error: "This job already has a Xero invoice." }, 400);
      if (!job.customer_id) return json({ error: "The job has no customer." }, 400);
      const { data: conn } = await admin.from("xero_connection").select("settings").eq("id", 1).maybeSingle();
      const s = conn?.settings || {};
      if (!s.sales_account_code || !s.sales_tax_type) return json({ error: "Choose the Xero sales account and VAT rate in the Xero settings first." }, 400);
      const lines = (body.lines || []).filter((l: any) => l.description && Number(l.unit_amount) !== 0);
      if (!lines.length) return json({ error: "Add at least one invoice line with a price." }, 400);
      const contactId = await ensureContact("customers", job.customer_id);
      const today = new Date();
      const inv = await xero("Invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Invoices: [{
          Type: "ACCREC", Contact: { ContactID: contactId }, Date: today.toISOString().slice(0, 10), DueDate: dueDate30EOM(today),
          LineAmountTypes: "Exclusive", Status: "DRAFT", Reference: [job.job_number, job.customer_po ? "PO " + job.customer_po : ""].filter(Boolean).join(" / ").slice(0, 255),
          BrandingThemeID: s.branding_theme_id || undefined,
          LineItems: lines.map((l: any) => ({ Description: String(l.description).slice(0, 4000), Quantity: Number(l.quantity) || 1, UnitAmount: Number(l.unit_amount), AccountCode: l.account_code || s.sales_account_code, TaxType: s.sales_tax_type })),
        }] }),
      });
      const x = inv?.Invoices?.[0];
      if (!x?.InvoiceID) throw new Error("Xero didn't return the invoice.");
      const now = new Date().toISOString();
      await admin.from("jobs").update({ xero_invoice_id: x.InvoiceID, invoice_number: x.InvoiceNumber || null, xero_invoice_status: x.Status, xero_invoice_total: x.Total, invoice_net_amount: x.SubTotal, invoiced_at: now, invoiced_by_name: user.full_name, xero_synced_at: now }).eq("id", job.id);
      return json({ ok: true, invoice: { id: x.InvoiceID, number: x.InvoiceNumber, status: x.Status, subtotal: x.SubTotal, total: x.Total } });
    }

    if (action === "attach") {
      const { data: job } = await admin.from("jobs").select("xero_invoice_id").eq("id", body.job_id).maybeSingle();
      if (!job?.xero_invoice_id) return json({ error: "No Xero invoice on this job." }, 400);
      const bytes = Uint8Array.from(atob(body.base64 || ""), (ch) => ch.charCodeAt(0));
      const name = String(body.filename || "document.pdf").replace(/[^A-Za-z0-9 ._-]+/g, "-");
      await xero(`Invoices/${job.xero_invoice_id}/Attachments/${encodeURIComponent(name)}?IncludeOnline=true`, { method: "PUT", headers: { "Content-Type": body.content_type || "application/pdf" }, body: bytes });
      return json({ ok: true });
    }

    if (action === "sync_invoice") {
      const { data: job } = await admin.from("jobs").select("id,xero_invoice_id").eq("id", body.job_id).maybeSingle();
      if (!job?.xero_invoice_id) return json({ error: "No Xero invoice on this job." }, 400);
      const r = await xero(`Invoices/${job.xero_invoice_id}`);
      const x = r?.Invoices?.[0];
      if (!x) throw new Error("Invoice not found in Xero.");
      const upd: any = { invoice_number: x.InvoiceNumber || null, xero_invoice_status: x.Status, xero_invoice_total: x.Total, invoice_net_amount: x.SubTotal, xero_synced_at: new Date().toISOString() };
      if (x.Status === "VOIDED" || x.Status === "DELETED") { upd.xero_invoice_id = null; upd.invoiced_at = null; upd.invoice_number = null; upd.invoice_net_amount = null; }
      await admin.from("jobs").update(upd).eq("id", job.id);
      return json({ ok: true, invoice: { number: x.InvoiceNumber, status: x.Status, subtotal: x.SubTotal, total: x.Total, amount_due: x.AmountDue, amount_paid: x.AmountPaid } });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
