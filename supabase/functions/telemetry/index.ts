// Aura Solutions – telemetry link (Nortech iHost). Office users only.
// Secret needed (Supabase → Edge Functions → Secrets): NORTECH_TOKEN (an iHost user access token).
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("NORTECH_TOKEN") || "";
const BASE = (Deno.env.get("NORTECH_BASE_URL") || "https://www.nortechonline.net/ihost/api").replace(/\/$/, "");
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function officeUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user?.id) return null;
  const { data: p } = await admin.from("profiles").select("id,role,active").eq("id", data.user.id).maybeSingle();
  return p && p.active !== false && ["admin", "manager"].includes(p.role) ? p : null;
}

// iHost accepts the access token in the Authorization header; try the usual forms once and remember which works
let authForm = -1;
const forms = [(t: string) => "Bearer " + t, (t: string) => t, (t: string) => "Token " + t];
async function ih(path: string) {
  const order = authForm >= 0 ? [authForm] : [0, 1, 2];
  let last = "";
  for (const i of order) {
    const r = await fetch(BASE + path, { headers: { Accept: "application/json", Authorization: forms[i](TOKEN) } });
    if (r.status === 401 || r.status === 403) { last = "iHost refused the access token (" + r.status + ")."; continue; }
    if (!r.ok) throw new Error("iHost: " + r.status + " " + (await r.text()).slice(0, 200));
    authForm = i;
    return await r.json();
  }
  throw new Error(last || "iHost refused the access token.");
}
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
const dayKey = (t: string) => t.slice(0, 10);

async function series(unit: string, io: number, from: Date, to: Date) {
  const r = await ih(`/rtus/${unit}/timeseries/series?startTime=${iso(from)}&endTime=${iso(to)}&ioReferences=${io}`);
  return (r?.Values || []).filter((v: any) => v && v.Value != null) as { Timestamp: string; Value: number }[];
}
async function allPages(path: string) {
  // archived event lists only allow page 0, so ask for the maximum in one go
  const r = await ih(path + (path.includes("?") ? "&" : "?") + "page=0&pageSize=50000");
  return r?.Items || [];
}

// alarms left out of reports by default: level alarms (the level graph shows these), the alarm-transmit / status relays,
// and flowmeter failed (it triggers whenever the pumps stop)
const DEFAULT_EXCLUDE = ["float", "high water", "high level", "low level", "critical alarm transmit", "critial alarm transmit", "station status", "common alarm", "flowmeter failed", "flow meter failed"];
async function rangeFor(unit: string, from: Date, to: Date, excludeText?: string | null) {
  const exclude = (excludeText && excludeText.trim() ? excludeText.split(",") : DEFAULT_EXCLUDE).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const leftOut = (p: any) => { const t = [p.Name, p.Name2, p.AlarmText].filter(Boolean).join(" ").toLowerCase(); return exclude.some((x) => t.includes(x)); };
  const end = to > new Date() ? new Date() : to;
  const short = end.getTime() - from.getTime() <= 8 * 864e5;
  const [bi, ai, ci] = await Promise.all([ih(`/rtus/${unit}/bi`), ih(`/rtus/${unit}/ai`), ih(`/rtus/${unit}/ci`)]);
  const biItems: any[] = bi?.Items || [], aiItems: any[] = ai?.Items || [], ciItems: any[] = ci?.Items || [];
  const nameOf: Record<number, any> = {}; biItems.forEach((p) => (nameOf[p.IOReference] = p));

  // alarms: from the archived event log. Binary inputs log 17 = contact closed, 18 = contact open;
  // a point is in alarm when its contact is away from its normal state. Pump run status and engineer-on-site aren't alarms.
  const watch = biItems.filter((p) => p.Enabled !== false && !p.Hidden && p.Name && !/^binary input|^spare/i.test(p.Name) && !/^pump\s*\d+$/i.test(p.Name) && !/engineer/i.test(p.Name) && !/running/i.test(p.AlarmText || "") && !leftOut(p));
  const ev = watch.length ? (await allPages(`/rtus/${unit}/events?from=${iso(from)}&to=${iso(end)}&` + watch.map((p) => "ioReferences=" + p.IOReference).join("&"))).filter((e) => e.EventTypeId === 17 || e.EventTypeId === 18).sort((a, b) => String(a.Timestamp).localeCompare(String(b.Timestamp))) : [];
  const open: Record<number, any> = {}, alarms: any[] = [];
  for (const e of ev) {
    const p = nameOf[e.IOReference] || {}, name = [p.Name, p.Name2].filter(Boolean).join(" ") || "Input " + e.IOReference;
    const closed = e.EventTypeId === 17, alarmed = p.NormallyOpen ? closed : !closed;
    if (alarmed && !open[e.IOReference]) { open[e.IOReference] = { point: name, alarm_text: p.AlarmText || "Alarm", start: e.Timestamp, end: null }; alarms.push(open[e.IOReference]); }
    else if (!alarmed && open[e.IOReference]) { open[e.IOReference].end = e.Timestamp; delete open[e.IOReference]; }
  }
  const stillAlarmed = watch.filter((p) => p.Alarmed).map((p) => [p.Name, p.Name2].filter(Boolean).join(" ") + ": " + (p.StatusText || p.AlarmText || "Alarm"));
  // one line per alarm type: how many times, and how long in total
  const sumBy: Record<string, any> = {};
  alarms.forEach((a) => { const x = sumBy[a.point] = sumBy[a.point] || { point: a.point, alarm_text: a.alarm_text, count: 0, minutes: 0, first: a.start, last: a.start, open: false };
    x.count++; x.last = a.start; if (a.end) x.minutes += (new Date(a.end).getTime() - new Date(a.start).getTime()) / 6e4; else { x.open = true; x.minutes += (end.getTime() - new Date(a.start).getTime()) / 6e4; } });
  const alarm_summary = Object.values(sumBy).map((x: any) => ({ ...x, minutes: Math.round(x.minutes) })).sort((a: any, b: any) => b.count - a.count);

  // levels and flow: daily low / average / high
  const daily = (vals: { Timestamp: string; Value: number }[]) => {
    const by: Record<string, number[]> = {};
    vals.forEach((v) => (by[dayKey(v.Timestamp)] = by[dayKey(v.Timestamp)] || []).push(Number(v.Value)));
    return Object.keys(by).sort().map((d) => { const a = by[d]; return { d, min: Math.min(...a), avg: Math.round(a.reduce((x, y) => x + y, 0) / a.length * 1000) / 1000, max: Math.max(...a) }; });
  };
  const pickAi = (re: RegExp) => aiItems.find((p) => re.test(String(p.Name || "")));
  const unitOf = (p: any) => p?.Units || p?.Unit || p?.EngineeringUnits || p?.ScaleUnits || "";
  const lvlP = pickAi(/well|level|depth|ultrasonic/i), flowP = pickAi(/flow/i);
  const lvlVals = lvlP ? await series(unit, lvlP.IOReference, from, end) : [];
  const flowVals = flowP ? await series(unit, flowP.IOReference, from, end) : [];

  // gaps in reporting (comms): any gap over 3 hours in the level readings
  const ts = lvlVals.map((v) => new Date(v.Timestamp).getTime());
  let gaps = 0, worst = 0;
  for (let i = 1; i < ts.length; i++) { const g = (ts[i] - ts[i - 1]) / 36e5; if (g > 3) { gaps++; worst = Math.max(worst, g); } }

  // pump run hours from the hour counters
  const pumps: any[] = [];
  for (const c of ciItems.filter((p) => /pump/i.test(String(p.Name || "")))) {
    const v = await series(unit, c.IOReference, from, end);
    if (!v.length) { pumps.push({ name: c.Name, hours: null, days: [] }); continue; }
    const byDay: Record<string, { first: number; last: number }> = {};
    v.forEach((x) => { const k = dayKey(x.Timestamp); byDay[k] = byDay[k] ? { first: byDay[k].first, last: Number(x.Value) } : { first: Number(x.Value), last: Number(x.Value) }; });
    const days = Object.keys(byDay).sort(); let prev: number | null = null;
    const per = days.map((d) => { const h = prev == null ? byDay[d].last - byDay[d].first : byDay[d].last - prev; prev = byDay[d].last; return { d, h: Math.max(0, Math.round(h * 100) / 100) }; });
    pumps.push({ name: c.Name, hours: Math.max(0, Math.round((v[v.length - 1].Value - v[0].Value) * 100) / 100), total: Math.round(v[v.length - 1].Value * 100) / 100, days: per });
  }
  return {
    unit, from: from.toISOString(), to: end.toISOString(), pulled_at: new Date().toISOString(),
    alarms: alarms.slice(0, 300), alarm_count: alarms.length, alarm_summary, still_alarmed: stillAlarmed,
    level: lvlP ? { name: lvlP.Name, unit: unitOf(lvlP) || "m", days: daily(lvlVals), points: short ? lvlVals.map((v) => ({ t: v.Timestamp, v: v.Value })) : undefined } : null,
    flow: flowP ? { name: flowP.Name, unit: unitOf(flowP) || "L/s", days: daily(flowVals), points: short ? flowVals.map((v) => ({ t: v.Timestamp, v: v.Value })) : undefined } : null,
    left_out: exclude, pumps, gaps, worst_gap_hours: Math.round(worst * 10) / 10, readings: lvlVals.length, events_seen: ev.length,
  };
}

// right now: every input's state, the latest readings and when the unit last called in
async function liveFor(unit: string, excludeText?: string | null) {
  const exclude = (excludeText && excludeText.trim() ? excludeText.split(",") : DEFAULT_EXCLUDE).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const [rtu, bi, ai, ci] = await Promise.all([ih(`/rtus/${unit}`).catch(() => null), ih(`/rtus/${unit}/bi`), ih(`/rtus/${unit}/ai`), ih(`/rtus/${unit}/ci`)]);
  const named = (p: any) => p.Name && p.Enabled !== false && !p.Hidden && !/^binary input|^spare|^analogue input|^counter input/i.test(p.Name);
  const pick: any = {};
  if (rtu && typeof rtu === "object") for (const [k, v] of Object.entries(rtu)) if (/comm|call|signal|status|power|online|name|serial|type|maintenance|parked/i.test(k) && (typeof v !== "object" || v === null)) pick[k] = v;
  const biL = (bi?.Items || []).filter(named).map((p: any) => ({ name: [p.Name, p.Name2].filter(Boolean).join(" "), status: p.StatusText, alarmed: !!p.Alarmed, since: p.LastChanged, fault: p.Alarmed && !/^pump\s*\d+$/i.test(p.Name) && !/engineer/i.test(p.Name) && !/running/i.test(p.AlarmText || "") && !exclude.some((x) => [p.Name, p.Name2, p.AlarmText].join(" ").toLowerCase().includes(x)) }));
  const val = (p: any) => p.DisplayValue ?? p.ScaledValue ?? p.EngineeringValue ?? p.Value ?? p.CurrentValue ?? p.LastValue ?? null;
  const aiL = (ai?.Items || []).filter(named).map((p: any) => ({ name: p.Name, io: p.IOReference, value: val(p), unit: p.Units || p.Unit || p.EngineeringUnits || "", at: p.Timestamp, alarmed: !!p.Alarmed, status: p.StatusText, pct: p.PercentValue ?? null, zone: p.ThresholdZone ?? null, scale: p.Scale ?? null, thresholds: p.Thresholds ?? null }));
  // the wet well level over the last 24 hours, for the trend line on the station picture
  const lvl = aiL.find((x: any) => /well|level|depth|ultrasonic/i.test(x.name));
  let trend: any[] = [];
  if (lvl) { try { const now = new Date(); trend = (await series(unit, lvl.io, new Date(now.getTime() - 864e5), now)).map((v) => ({ t: v.Timestamp, v: v.Value })); } catch (_) { /* trend is optional */ } }
  const ciL = (ci?.Items || []).filter(named).map((p: any) => ({ name: p.Name, value: val(p), unit: p.Units || p.Unit || "", at: p.Timestamp }));
  return { unit, rtu: pick, binary: biL, analogue: aiL, counters: ciL, faults: biL.filter((x: any) => x.fault).map((x: any) => x.name + ": " + x.status), level_trend: trend, last_comms: (ai?.Items || []).map((p: any) => p.Timestamp).filter(Boolean).sort().pop() || null, read_at: new Date().toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!(await officeUser(req))) return json({ error: "Only office users can pull telemetry." }, 403);
    const body = await req.json().catch(() => ({}));
    if (body.action === "status") return json({ configured: !!TOKEN });
    if (!TOKEN) return json({ error: "The iHost access token hasn't been added yet. Add it in Supabase → Edge Functions → Secrets as NORTECH_TOKEN." }, 400);
    if (body.action === "raw") {
      // read-only look at an iHost reading/event list (office users), used when checking the link
      const path = String(body.path || "");
      if (!/^\/rtus\/\d+\/[a-z\/]+(\?[^#]*)?$/i.test(path)) return json({ error: "Not allowed." }, 400);
      return json({ ok: true, data: await ih(path) });
    }
    if (["month", "range", "live"].includes(body.action)) {
      const { data: a } = await admin.from("site_assets").select("id,name,telemetry_provider,telemetry_unit_id,alarm_exclude").eq("id", body.asset_id).maybeSingle();
      if (!a?.telemetry_unit_id || a.telemetry_provider !== "nortech") return json({ error: "That station isn't linked to an iHost unit." }, 400);
      if (body.action === "live") return json({ ok: true, asset: a.name, data: await liveFor(a.telemetry_unit_id, a.alarm_exclude) });
      let from: Date, to: Date;
      if (body.action === "month") {
        const m = String(body.month || "").slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(m)) return json({ error: "Month needed." }, 400);
        from = new Date(m + "-01T00:00:00Z"); to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
      } else {
        from = new Date(body.from); to = new Date(body.to);
        if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > 93 * 864e5) return json({ error: "Choose a period of up to three months." }, 400);
      }
      return json({ ok: true, asset: a.name, data: await rangeFor(a.telemetry_unit_id, from, to, a.alarm_exclude) });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
