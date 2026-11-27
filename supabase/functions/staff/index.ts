// Aura Solutions – add staff logins (admins and managers only).
// Sends the new person an invite email to set their own password; nobody else ever sees or types it.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://app.aurasolutions.co.uk/app.html";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const okEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

async function caller(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: p } = await admin.from("profiles").select("id,full_name,role,active").eq("id", uid).maybeSingle();
  if (!p || p.active === false || !["admin", "manager"].includes(p.role)) return null;
  return p;
}

async function findUser(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => String(x.email || "").toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 200) break;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const me = await caller(req);
    if (!me) return json({ error: "Only admins and managers can add staff." }, 403);
    const body = await req.json().catch(() => ({}));

    if (body.action === "invite") {
      const email = String(body.email || "").trim().toLowerCase();
      const full_name = String(body.full_name || "").trim();
      const role = ["operative", "manager", "admin"].includes(body.role) ? body.role : "operative";
      if (!full_name) return json({ error: "Add their name." }, 400);
      if (!okEmail(email)) return json({ error: "Add a valid email address – that's where their invite goes." }, 400);
      if (role === "admin" && me.role !== "admin") return json({ error: "Only an admin can add another admin." }, 403);
      if (await findUser(email)) return json({ error: "There's already a login for " + email + ". Use “Resend invite” on them instead." }, 400);
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: APP_URL, data: { full_name } });
      if (error) return json({ error: "The invite couldn't be sent: " + error.message }, 400);
      const uid = data.user.id;
      const { error: pe } = await admin.from("profiles").upsert({ id: uid, full_name, role, phone: String(body.phone || "").trim() || null, job_title: String(body.job_title || "").trim() || null, active: true });
      if (pe) return json({ error: "The invite was sent, but their profile didn't save: " + pe.message }, 500);
      return json({ ok: true, id: uid, email });
    }

    if (body.action === "resend") {
      const { data: u, error } = await admin.auth.admin.getUserById(String(body.id || ""));
      if (error || !u?.user?.email) return json({ error: "Couldn't find their login." }, 404);
      const email = u.user.email;
      if (!u.user.last_sign_in_at) {
        const r = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: APP_URL });
        if (r.error) return json({ error: "The invite couldn't be sent: " + r.error.message }, 400);
        return json({ ok: true, sent: "invite", email });
      }
      const r = await admin.auth.resetPasswordForEmail(email, { redirectTo: APP_URL });
      if (r.error) return json({ error: "The reset email couldn't be sent: " + r.error.message }, 400);
      return json({ ok: true, sent: "reset", email });
    }

    if (body.action === "list") {
      // login email and whether they've signed in yet, for the people page
      const { data: profs } = await admin.from("profiles").select("id");
      const ids = new Set((profs || []).map((p: any) => p.id));
      const out: any[] = [];
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        data.users.filter((u) => ids.has(u.id)).forEach((u) => out.push({ id: u.id, email: u.email, signed_in: !!u.last_sign_in_at, last_sign_in_at: u.last_sign_in_at }));
        if (data.users.length < 200) break;
      }
      return json({ ok: true, users: out });
    }

    if (body.action === "set_role") {
      const role = ["operative", "manager", "admin"].includes(body.role) ? body.role : null;
      if (!role) return json({ error: "Unknown role." }, 400);
      if (me.role !== "admin") return json({ error: "Only an admin can change someone's access." }, 403);
      if (body.id === me.id && role !== "admin") return json({ error: "You can't take admin away from yourself." }, 400);
      const { error } = await admin.from("profiles").update({ role }).eq("id", body.id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
