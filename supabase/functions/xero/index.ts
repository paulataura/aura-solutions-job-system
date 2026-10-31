// Aura Solutions – Xero connection (office users only).
// Holds the Xero tokens server-side; the browser never sees them.
// Secrets needed (Supabase → Edge Functions → Secrets): XERO_CLIENT_ID, XERO_CLIENT_SECRET
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("XERO_CLIENT_ID") || "CB78FE23415F4FE4A593617287A93E4E";
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
  if (!p || p.active === false || p.role !== "admin") return null;
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
function dueDate(terms: string | null, d: Date) {
  const t = String(terms || "30 days EOM");
  if (/eom|end of month/i.test(t)) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)).toISOString().slice(0, 10);
  if (/receipt/i.test(t)) return d.toISOString().slice(0, 10);
  const n = parseInt((t.match(/(\d+)/) || [])[1], 10);
  return new Date(d.getTime() + (isNaN(n) ? 30 : n) * 864e5).toISOString().slice(0, 10);
}

// one Xero line: account, VAT and tracking (e.g. Service: Waste removal) can be set per line
const lineItem = (defAcc: string, defTax: string) => (l: any) => ({
  Description: String(l.description).slice(0, 4000), Quantity: Number(l.quantity) || 1, UnitAmount: Number(l.unit_amount),
  AccountCode: l.account_code || defAcc || undefined, TaxType: l.tax_type || defTax || undefined,
  Tracking: (l.tracking || []).filter((t: any) => t && t.name && t.option).map((t: any) => ({ Name: t.name, Option: t.option })),
});

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
    if (!user) return json({ error: "Only admin accounts can use finance and the Xero link." }, 403);
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
      const [acc, tax, themes, trk] = await Promise.all([xero("Accounts"), xero("TaxRates"), xero("BrandingThemes"), xero("TrackingCategories?includeArchived=false")]);
      return json({
        accounts: (acc?.Accounts || []).filter((a: any) => a.Status === "ACTIVE" && ["REVENUE", "SALES", "OTHERINCOME"].includes(a.Type)).map((a: any) => ({ code: a.Code, name: a.Name })),
        expenseAccounts: (acc?.Accounts || []).filter((a: any) => a.Status === "ACTIVE" && ["DIRECTCOSTS", "EXPENSE", "OVERHEADS"].includes(a.Type)).map((a: any) => ({ code: a.Code, name: a.Name, type: a.Type })),
        taxRates: (tax?.TaxRates || []).filter((t: any) => t.Status === "ACTIVE").map((t: any) => ({ type: t.TaxType, name: t.Name, rate: t.EffectiveRate, sales: t.CanApplyToRevenue, purchases: t.CanApplyToExpenses })),
        themes: (themes?.BrandingThemes || []).map((t: any) => ({ id: t.BrandingThemeID, name: t.Name })),
        tracking: (trk?.TrackingCategories || []).filter((c: any) => c.Status === "ACTIVE").map((c: any) => ({ id: c.TrackingCategoryID, name: c.Name, options: (c.Options || []).filter((o: any) => o.Status === "ACTIVE").map((o: any) => ({ id: o.TrackingOptionID, name: o.Name })) })),
      });
    }

    if (action === "save_settings") {
      const { data } = await admin.from("xero_connection").select("settings").eq("id", 1).maybeSingle();
      const settings = { ...(data?.settings || {}), ...(body.settings || {}) };
      await admin.from("xero_connection").upsert({ id: 1, settings, updated_at: new Date().toISOString() });
      return json({ ok: true, settings });
    }

    if (action === "create_invoice") {
      const { data: job } = await admin.from("jobs").select("id,job_number,reference,customer_po,customer_id").eq("id", body.job_id).maybeSingle();
      if (!job) return json({ error: "Job not found." }, 404);
      const { data: fin0 } = await admin.from("job_finance").select("xero_invoice_id").eq("job_id", job.id).maybeSingle();
      if (fin0?.xero_invoice_id) return json({ error: "This job already has a Xero invoice." }, 400);
      if (!job.customer_id) return json({ error: "The job has no customer." }, 400);
      const { data: conn } = await admin.from("xero_connection").select("settings").eq("id", 1).maybeSingle();
      const s = conn?.settings || {};
      if (!s.sales_account_code || !s.sales_tax_type) return json({ error: "Choose the Xero sales account and VAT rate in the Xero settings first." }, 400);
      const lines = (body.lines || []).filter((l: any) => l.description && Number(l.unit_amount) !== 0);
      if (!lines.length) return json({ error: "Add at least one invoice line with a price." }, 400);
      const contactId = await ensureContact("customers", job.customer_id);
      const { data: cust } = await admin.from("customers").select("payment_terms").eq("id", job.customer_id).maybeSingle();
      const today = new Date();
      const inv = await xero("Invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Invoices: [{
          Type: "ACCREC", Contact: { ContactID: contactId }, Date: today.toISOString().slice(0, 10), DueDate: dueDate(cust?.payment_terms ?? null, today),
          LineAmountTypes: "Exclusive", Status: "DRAFT", Reference: [job.customer_po || job.reference, job.job_number ? "Job " + job.job_number : ""].filter(Boolean).join(" · ").slice(0, 255) || undefined,
          BrandingThemeID: s.branding_theme_id || undefined,
          LineItems: lines.map(lineItem(s.sales_account_code, s.sales_tax_type)),
        }] }),
      });
      const x = inv?.Invoices?.[0];
      if (!x?.InvoiceID) throw new Error("Xero didn't return the invoice.");
      const now = new Date().toISOString();
      await admin.from("jobs").update({ invoiced_at: now, invoiced_by_name: user.full_name }).eq("id", job.id);
      await admin.from("job_finance").upsert({ job_id: job.id, xero_invoice_id: x.InvoiceID, invoice_number: x.InvoiceNumber || null, xero_invoice_status: x.Status, xero_invoice_total: x.Total, invoice_net_amount: x.SubTotal, xero_synced_at: now, updated_at: now }, { onConflict: "job_id" });
      return json({ ok: true, invoice: { id: x.InvoiceID, number: x.InvoiceNumber, status: x.Status, subtotal: x.SubTotal, total: x.Total } });
    }

    if (action === "attach") {
      const { data: job } = await admin.from("job_finance").select("xero_invoice_id").eq("job_id", body.job_id).maybeSingle();
      if (!job?.xero_invoice_id) return json({ error: "No Xero invoice on this job." }, 400);
      const bytes = Uint8Array.from(atob(body.base64 || ""), (ch) => ch.charCodeAt(0));
      const name = String(body.filename || "document.pdf").replace(/[^A-Za-z0-9 ._-]+/g, "-");
      await xero(`Invoices/${job.xero_invoice_id}/Attachments/${encodeURIComponent(name)}?IncludeOnline=true`, { method: "PUT", headers: { "Content-Type": body.content_type || "application/pdf" }, body: bytes });
      return json({ ok: true });
    }

    if (action === "sync_invoice") {
      const { data: job } = await admin.from("job_finance").select("job_id,xero_invoice_id").eq("job_id", body.job_id).maybeSingle();
      if (!job?.xero_invoice_id) return json({ error: "No Xero invoice on this job." }, 400);
      const r = await xero(`Invoices/${job.xero_invoice_id}`);
      const x = r?.Invoices?.[0];
      if (!x) throw new Error("Invoice not found in Xero.");
      const upd: any = { invoice_number: x.InvoiceNumber || null, xero_invoice_status: x.Status, xero_invoice_total: x.Total, invoice_net_amount: x.SubTotal, xero_synced_at: new Date().toISOString() };
      if (x.Status === "VOIDED" || x.Status === "DELETED") {
        upd.xero_invoice_id = null; upd.invoice_number = null; upd.invoice_net_amount = null; upd.invoice_lines = null;
        await admin.from("jobs").update({ invoiced_at: null, invoiced_by_name: null }).eq("id", job.job_id);
      }
      await admin.from("job_finance").update({ ...upd, updated_at: new Date().toISOString() }).eq("job_id", job.job_id);
      return json({ ok: true, invoice: { number: x.InvoiceNumber, status: x.Status, subtotal: x.SubTotal, total: x.Total, amount_due: x.AmountDue, amount_paid: x.AmountPaid } });
    }

    if (action === "push_po") {
      const { data: po } = await admin.from("purchase_orders").select("*").eq("id", body.po_id).maybeSingle();
      if (!po) return json({ error: "PO not found." }, 404);
      if (!po.supplier_id) return json({ error: "The PO has no supplier." }, 400);
      const { data: conn } = await admin.from("xero_connection").select("settings").eq("id", 1).maybeSingle();
      const s = conn?.settings || {};
      const contactId = await ensureContact("suppliers", po.supplier_id);
      let ref = "";
      if (po.job_id) { const { data: j } = await admin.from("jobs").select("job_number").eq("id", po.job_id).maybeSingle(); ref = j?.job_number || ""; }
      const lines = (po.lines || []).filter((l: any) => l.description).map((l: any) => ({ description: l.description + (l.unit ? " (" + l.unit + ")" : ""), quantity: l.qty, unit_amount: l.unit_price, account_code: l.account_code, tax_type: l.tax_type, tracking: l.tracking }));
      if (!lines.length) return json({ error: "The PO has no lines." }, 400);
      const payload: any = {
        PurchaseOrderNumber: po.po_number, Contact: { ContactID: contactId }, Date: po.order_date, DeliveryDate: po.required_date || undefined,
        Reference: ref || (po.job_id ? "" : "Overhead"), LineAmountTypes: "Exclusive", Status: po.status === "cancelled" ? "DELETED" : po.status === "draft" ? "DRAFT" : "AUTHORISED",
        DeliveryInstructions: po.notes ? String(po.notes).slice(0, 500) : undefined,
        LineItems: lines.map(lineItem(s.cost_account_code || "325", s.purchase_tax_type || "INPUT2")),
      };
      if (po.xero_po_id) payload.PurchaseOrderID = po.xero_po_id;
      const r = await xero("PurchaseOrders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ PurchaseOrders: [payload] }) });
      const x = r?.PurchaseOrders?.[0];
      if (!x?.PurchaseOrderID) throw new Error("Xero didn't return the purchase order.");
      await admin.from("purchase_orders").update({ xero_po_id: x.PurchaseOrderID }).eq("id", po.id);
      return json({ ok: true, xero_po_id: x.PurchaseOrderID, status: x.Status });
    }

    if (action === "sync_po") {
      // Bills made from a Xero PO carry the PO number as their reference
      const { data: po } = await admin.from("purchase_orders").select("id,po_number,supplier_id,xero_po_id").eq("id", body.po_id).maybeSingle();
      if (!po) return json({ error: "PO not found." }, 404);
      const where = encodeURIComponent(`Type=="ACCPAY" AND Reference=="${q(po.po_number)}" AND Status!="DELETED" AND Status!="VOIDED"`);
      const r = await xero(`Invoices?where=${where}&summaryOnly=true`);
      const bills = (r?.Invoices || []);
      let poStatus = null;
      if (po.xero_po_id) { try { const p = await xero(`PurchaseOrders/${po.xero_po_id}`); poStatus = p?.PurchaseOrders?.[0]?.Status || null; } catch (_) { /* ignore */ } }
      if (bills.length) {
        const amt = Math.round(bills.reduce((a: number, b: any) => a + Number(b.SubTotal || 0), 0) * 100) / 100;
        const b0 = bills[0];
        const d = String(b0.DateString || b0.Date || "").slice(0, 10);
        await admin.from("purchase_orders").update({ supplier_invoice_amount: amt, supplier_invoice_number: bills.map((b: any) => b.InvoiceNumber).filter(Boolean).join(", ") || null, supplier_invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null, status: "invoiced" }).eq("id", po.id);
      }
      return json({ ok: true, po_status: poStatus, bills: bills.map((b: any) => ({ number: b.InvoiceNumber, subtotal: b.SubTotal, total: b.Total, status: b.Status, due: b.AmountDue })) });
    }

    if (action === "sync_tracking") {
      // Keep a Xero tracking category (default "Resource") in step with the app's resource list
      const catName = String(body.name || "Resource").slice(0, 100);
      const { data: res } = await admin.from("finance_categories").select("id,name,active,xero_tracking_option_id").eq("kind", "resource").order("sort");
      const all = await xero("TrackingCategories?includeArchived=true");
      let cat = (all?.TrackingCategories || []).find((c: any) => c.Name === catName);
      if (!cat) {
        const made = await xero("TrackingCategories", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Name: catName }) });
        cat = made?.TrackingCategories?.[0];
        if (!cat?.TrackingCategoryID) throw new Error("Xero didn't create the tracking category.");
        cat.Options = [];
      } else if (cat.Status === "ARCHIVED") {
        await xero(`TrackingCategories/${cat.TrackingCategoryID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Name: catName, Status: "ACTIVE" }) });
      }
      const opts: any[] = cat.Options || [];
      const report: string[] = [];
      for (const r of res || []) {
        const name = String(r.name).slice(0, 100);
        let o = opts.find((x: any) => x.TrackingOptionID === r.xero_tracking_option_id) || opts.find((x: any) => x.Name === name);
        if (r.active === false) {
          if (o && o.Status !== "ARCHIVED") {
            try { await xero(`TrackingCategories/${cat.TrackingCategoryID}/Options/${o.TrackingOptionID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Name: o.Name, Status: "ARCHIVED" }) }); report.push("archived " + o.Name); }
            catch (e) { report.push("could not archive " + o.Name + ": " + (e as Error).message); }
          }
          continue;
        }
        if (!o) {
          const made = await xero(`TrackingCategories/${cat.TrackingCategoryID}/Options`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Name: name }) });
          o = made?.Options?.[0];
          report.push("added " + name);
        } else if (o.Name !== name || o.Status === "ARCHIVED") {
          const upd = await xero(`TrackingCategories/${cat.TrackingCategoryID}/Options/${o.TrackingOptionID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Name: name, Status: "ACTIVE" }) });
          report.push((o.Name !== name ? "renamed " + o.Name + " to " : "re-activated ") + name);
          o = upd?.Options?.[0] || o;
        }
        if (o?.TrackingOptionID && o.TrackingOptionID !== r.xero_tracking_option_id) await admin.from("finance_categories").update({ xero_tracking_option_id: o.TrackingOptionID, xero_tracking_option: name }).eq("id", r.id);
        else await admin.from("finance_categories").update({ xero_tracking_option: name }).eq("id", r.id);
      }
      const { data: c } = await admin.from("xero_connection").select("settings").eq("id", 1).maybeSingle();
      await admin.from("xero_connection").update({ settings: { ...(c?.settings || {}), tracking_category_name: catName, tracking_category_id: cat.TrackingCategoryID } }).eq("id", 1);
      return json({ ok: true, category: catName, changes: report });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
