// Aura Solutions – Xero sign-in return address. Exchanges the one-time code for tokens and stores them server-side.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CLIENT_ID = Deno.env.get("XERO_CLIENT_ID") || "CB78FE23415F4FE4A593617287A93E4E";
const CLIENT_SECRET = Deno.env.get("XERO_CLIENT_SECRET") || "";
const REDIRECT = `${SUPABASE_URL}/functions/v1/xero-callback`;
const APP = "https://app.aurasolutions.co.uk/app";
const back = (hash: string) => new Response(null, { status: 302, headers: { Location: `${APP}#${hash}` } });

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const code = u.searchParams.get("code"), state = u.searchParams.get("state");
  if (u.searchParams.get("error")) return back("xero-cancelled");
  if (!code || !state) return back("xero-error");
  const { data: st } = await admin.from("xero_oauth_state").select("*").eq("state", state).maybeSingle();
  await admin.from("xero_oauth_state").delete().eq("state", state);
  if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60_000) return back("xero-expired");
  const r = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`) },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT }),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) return back("xero-error");
  const cr = await fetch("https://api.xero.com/connections", { headers: { Authorization: "Bearer " + t.access_token } });
  const conns = await cr.json();
  const org = Array.isArray(conns) ? conns.find((c: any) => c.tenantType === "ORGANISATION") || conns[0] : null;
  if (!org) return back("xero-noorg");
  const { data: existing } = await admin.from("xero_connection").select("settings").eq("id", 1).maybeSingle();
  await admin.from("xero_connection").upsert({
    id: 1, tenant_id: org.tenantId, tenant_name: org.tenantName, access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in || 1800) * 1000).toISOString(), connected_by_name: st.user_name, connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), settings: existing?.settings || {},
  });
  await admin.from("xero_oauth_state").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());
  return back("xero-connected");
});
