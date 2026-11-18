// Aura Solutions – send emails from the app through the company mailbox (info@) over SMTP, with PDFs attached.
// Secrets (Supabase → Edge Functions → Secrets), added by the account owner: SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS, optional SMTP_FROM_NAME.
// Supabase blocks ports 25 and 587, so this uses SSL on port 465.
import { createClient } from "jsr:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOST = Deno.env.get("SMTP_HOST") || "";
const PORT = Number(Deno.env.get("SMTP_PORT") || 465);
const USER = Deno.env.get("SMTP_USER") || "";
const PASS = Deno.env.get("SMTP_PASS") || "";
const FROM_NAME = Deno.env.get("SMTP_FROM_NAME") || "Aura Solutions Group Limited";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const emailOk = (e: string) => /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(e);
const list = (v: unknown) => String(v || "").split(/[,;]+/).map((x) => x.trim()).filter(Boolean);

async function officeUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  const uid = data?.user?.id; if (!uid) return null;
  const { data: p } = await admin.from("profiles").select("id,full_name,role,active").eq("id", uid).maybeSingle();
  if (!p || p.active === false || !["admin", "manager"].includes(p.role)) return null;
  return p;
}
const transport = () => nodemailer.createTransport({ host: HOST, port: PORT, secure: PORT === 465, auth: { user: USER, pass: PASS }, connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 30000 });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await officeUser(req);
    if (!user) return json({ error: "Only office accounts can send email from the app." }, 403);
    const body = await req.json().catch(() => ({}));
    const configured = !!(HOST && USER && PASS);
    if (body.action === "status") return json({ ok: true, configured, from: USER || null, host: HOST || null, port: PORT });
    if (!configured) return json({ error: "Email isn't set up yet – the mailbox details (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) need adding in Supabase → Edge Functions → Secrets." }, 400);
    if (PORT === 25 || PORT === 587) return json({ error: "Port " + PORT + " is blocked by Supabase – use your host's SSL port 465 (SMTP_PORT = 465)." }, 400);

    if (body.action === "test") {
      const info = await transport().sendMail({ from: { name: FROM_NAME, address: USER }, to: USER, subject: "Test from the Aura job app", text: "This is a test email sent from the job app through " + HOST + ". If you can read this, sending from the app works." });
      await admin.from("email_log").insert({ sent_by: user.id, sent_by_name: user.full_name, to_addr: USER, subject: "Test from the Aura job app", kind: "test", status: "sent", message_id: info.messageId || null });
      return json({ ok: true, to: USER });
    }

    if (body.action === "send") {
      const to = list(body.to), cc = list(body.cc);
      if (!to.length || ![...to, ...cc].every(emailOk)) return json({ error: "Check the email addresses." }, 400);
      const subject = String(body.subject || "").slice(0, 300);
      if (!subject) return json({ error: "Add a subject." }, 400);
      const atts = (body.attachments || []).filter((a: any) => a && a.base64 && a.filename).map((a: any) => ({ filename: String(a.filename).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 150), content: a.base64, encoding: "base64", contentType: a.content_type || "application/pdf" }));
      const size = atts.reduce((n: number, a: any) => n + a.content.length * 0.75, 0);
      if (size > 18 * 1024 * 1024) return json({ error: "The attachments are too big to email (over 18MB). Untick the largest, or send the secure link instead." }, 400);
      const text = String(body.text || "");
      const html = body.html ? String(body.html) : "<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.5\">" + text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/(https?:\/\/[^\s<]+)/g, "<a href=\"$1\">$1</a>").replace(/\n/g, "<br>") + "</div>";
      // a copy always goes to the office mailbox, so there's a record in Outlook
      const bcc = body.copy_office === false ? undefined : USER;
      let info: any = null, err: string | null = null;
      try { info = await transport().sendMail({ from: { name: FROM_NAME, address: USER }, replyTo: USER, to, cc: cc.length ? cc : undefined, bcc, subject, text, html, attachments: atts }); }
      catch (e) { err = (e as Error).message || String(e); }
      await admin.from("email_log").insert({ sent_by: user.id, sent_by_name: user.full_name, to_addr: to.join(", "), cc_addr: cc.join(", ") || null, subject, kind: body.kind || null, ref_id: body.ref_id || null, job_id: body.job_id || null, attachments: atts.map((a: any) => a.filename), status: err ? "failed" : "sent", error: err, message_id: info?.messageId || null });
      if (err) return json({ error: "The email didn't send: " + err }, 502);
      return json({ ok: true, to, cc, message_id: info?.messageId || null });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
