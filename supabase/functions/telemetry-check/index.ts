// Aura Solutions – telemetry alarm checker. Runs every 5 minutes (pg_cron) and on demand from the app.
// Looks at every linked station, opens/clears alerts (high level, pump trip, other faults, no contact)
// and sends a phone notification to office users who turned alerts on.
// verify_jwt is off because the scheduled run has no user: it proves itself with the cron key kept in app_secrets;
// every other call must come from a signed-in office user.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("NORTECH_TOKEN") || "";
const BASE = (Deno.env.get("NORTECH_BASE_URL") || "https://www.nortechonline.net/ihost/api").replace(/\/$/, "");
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const OFFLINE_HOURS = 3;
const DEFAULT_EXCLUDE = ["float", "high water", "high level", "low level", "critical alarm transmit", "critial alarm transmit", "station status", "common alarm", "flowmeter failed", "flow meter failed"];

async function secret(name: string) { const { data } = await admin.from("app_secrets").select("value").eq("name", name).maybeSingle(); return data?.value || null; }
async function vapid() {
  let pub = await secret("vapid_public"), priv = await secret("vapid_private");
  if (!pub || !priv) { const k = webpush.generateVAPIDKeys(); await admin.from("app_secrets").upsert([{ name: "vapid_public", value: k.publicKey }, { name: "vapid_private", value: k.privateKey }]); pub = k.publicKey; priv = k.privateKey; }
  webpush.setVapidDetails("mailto:info@aurasolutions.co.uk", pub, priv);
  return pub;
}
async function officeUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token.startsWith("sb_")) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user?.id) return null;
  const { data: p } = await admin.from("profiles").select("id,role,active,full_name").eq("id", data.user.id).maybeSingle();
  return p && p.active !== false && ["admin", "manager"].includes(p.role) ? p : null;
}
async function ih(path: string) {
  const r = await fetch(BASE + path, { headers: { Accept: "application/json", Authorization: "Bearer " + TOKEN } });
  if (!r.ok) throw new Error("iHost: " + r.status);
  return await r.json();
}

// what is wrong at one station right now
async function problemsFor(a: any) {
  const unit = a.telemetry_unit_id;
  const exclude = (a.alarm_exclude && a.alarm_exclude.trim() ? a.alarm_exclude.split(",") : DEFAULT_EXCLUDE).map((x: string) => x.trim().toLowerCase()).filter(Boolean);
  const [bi, ai] = await Promise.all([ih(`/rtus/${unit}/bi`), ih(`/rtus/${unit}/ai`)]);
  const B: any[] = (bi?.Items || []).filter((p: any) => p.Name && p.Enabled !== false && !p.Hidden && !/^binary input|^spare/i.test(p.Name));
  const A: any[] = (ai?.Items || []).filter((p: any) => p.Name && p.Enabled !== false && !p.Hidden);
  const out: { kind: string; point: string; message: string }[] = [];
  const last = A.map((p) => p.Timestamp).filter(Boolean).sort().pop();
  const ageH = last ? (Date.now() - new Date(last).getTime()) / 36e5 : 999;
  if (ageH > OFFLINE_HOURS) { out.push({ kind: "offline", point: "", message: `No contact for ${ageH >= 48 ? Math.round(ageH / 24) + " days" : Math.round(ageH) + " hours"}` }); return out; }
  const nm = (p: any) => [p.Name, p.Name2].filter(Boolean).join(" ");
  // high level: the level reading is in alarm, or a high-level / float switch is
  const lvl = A.find((p) => /well|level|depth|ultrasonic/i.test(p.Name));
  const highFloat = B.find((p) => p.Alarmed && /float|high level|high water|overflow/i.test(nm(p)));
  if ((lvl && (lvl.Alarmed && !/low/i.test(String(lvl.ThresholdZone || lvl.StatusText || "")))) || highFloat) {
    const v = lvl ? (lvl.DisplayValue ?? lvl.Value) : null;
    out.push({ kind: "high_level", point: "", message: `High level${v != null ? " – " + v + " " + (lvl.Units || "m") : ""}${highFloat ? " (" + nm(highFloat) + ")" : ""}` });
  }
  // pump trips, then any other fault that isn't on the station's leave-out list
  for (const p of B.filter((p) => p.Alarmed)) {
    const n = nm(p), t = [n, p.AlarmText].join(" ").toLowerCase();
    if (/^pump\s*\d+$/i.test(p.Name) || /engineer/i.test(n) || /running/i.test(p.AlarmText || "")) continue;
    if (/pump\s*\d+.*(fault|trip|fail)/i.test(n)) { out.push({ kind: "pump_trip", point: n, message: `${n.replace(/\s*fault/i, "")} tripped` }); continue; }
    if (/float|high level|high water|overflow/i.test(n)) continue;
    if (exclude.some((x: string) => t.includes(x))) continue;
    out.push({ kind: "fault", point: n, message: `${n}: ${p.StatusText || p.AlarmText || "alarm"}` });
  }
  return out;
}

async function notify(title: string, body: string, tag: string) {
  const { data: subs } = await admin.from("push_subscriptions").select("id,endpoint,keys,user_id,topics");
  if (!subs?.length) return 0;
  const { data: staff } = await admin.from("profiles").select("id").in("role", ["admin", "manager"]).neq("active", false);
  const ok = new Set((staff || []).map((s: any) => s.id));
  let sent = 0;
  for (const s of subs) {
    if (!ok.has(s.user_id) || !(s.topics || []).includes("telemetry")) continue;
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title, body, tag, url: "./app#telemetry" }), { TTL: 3600, urgency: "high" }); sent++; await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id); }
    catch (e) { const code = (e as any)?.statusCode; if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id); }
  }
  return sent;
}

async function runCheck() {
  await vapid();
  const { data: assets } = await admin.from("site_assets").select("id,name,telemetry_provider,telemetry_unit_id,alarm_exclude,active").eq("telemetry_provider", "nortech").not("telemetry_unit_id", "is", null);
  const now = new Date().toISOString(), report: any[] = [];
  for (const a of (assets || []).filter((x: any) => x.active !== false)) {
    let probs: any[];
    try { probs = await problemsFor(a); } catch (e) { report.push({ asset: a.name, error: String((e as Error).message) }); continue; }
    const { data: open } = await admin.from("telemetry_alerts").select("*").eq("asset_id", a.id).is("cleared_at", null);
    const key = (x: any) => x.kind + "|" + (x.point || "");
    const openBy = new Map((open || []).map((x: any) => [key(x), x]));
    for (const p of probs) {
      const ex = openBy.get(key(p));
      if (ex) { await admin.from("telemetry_alerts").update({ last_seen_at: now, message: p.message }).eq("id", ex.id); openBy.delete(key(p)); continue; }
      // the same alarm came back within 30 minutes of clearing: reopen it rather than raising (and notifying) a new one
      const since = new Date(Date.now() - 30 * 6e4).toISOString();
      const { data: recent } = await admin.from("telemetry_alerts").select("id").eq("asset_id", a.id).eq("kind", p.kind).eq("point", p.point || "").gte("cleared_at", since).order("cleared_at", { ascending: false }).limit(1);
      if (recent?.length) { await admin.from("telemetry_alerts").update({ cleared_at: null, last_seen_at: now, message: p.message }).eq("id", recent[0].id); continue; }
      const { data: ins } = await admin.from("telemetry_alerts").insert({ asset_id: a.id, kind: p.kind, point: p.point || "", message: p.message, started_at: now, last_seen_at: now }).select("id").single();
      const icon = { high_level: "🌊", pump_trip: "⚠️", offline: "📵", fault: "⚠️" }[p.kind as string] || "⚠️";
      const sent = await notify(`${icon} ${a.name}`, p.message, "tel-" + a.id + "-" + p.kind);
      if (ins?.id && sent) await admin.from("telemetry_alerts").update({ notified_at: now }).eq("id", ins.id);
      report.push({ asset: a.name, raised: p.message, sent });
    }
    for (const x of openBy.values()) await admin.from("telemetry_alerts").update({ cleared_at: now }).eq("id", (x as any).id);
  }
  return report;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "vapid_public") return json({ ok: true, key: await vapid() });
    const cronKey = req.headers.get("x-cron-key");
    const isCron = !!cronKey && cronKey === (await secret("telemetry_cron_key"));
    const user = isCron ? null : await officeUser(req);
    if (!isCron && !user) return json({ error: "Not allowed." }, 403);
    if (!TOKEN) return json({ error: "The iHost access token hasn't been added yet." }, 400);
    if (body.action === "check") return json({ ok: true, report: await runCheck() });
    if (body.action === "test_push" && user) {
      await vapid();
      const { data: subs } = await admin.from("push_subscriptions").select("endpoint,keys").eq("user_id", user.id);
      let sent = 0, last = "";
      for (const s of subs || []) { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: "🔔 Aura Solutions", body: "Phone alerts are working. You'll get station alarms here.", tag: "test", url: "./app#telemetry" })); sent++; } catch (e) { last = String((e as any)?.body || (e as Error).message).slice(0, 160); } }
      return json({ ok: true, sent, error: sent ? null : last || "No phone is set up for alerts yet." });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
