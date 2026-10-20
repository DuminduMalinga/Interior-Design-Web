// Sends the site's emails through Resend.
//
//   kind "plan_ready"   -> the signed-in user, when their floor plan has been read
//   kind "design_saved" -> the signed-in user, when they save a 3D design
//   kind "news"         -> every user who turned on "Product news"; admins only
//
// The two personal kinds go only to the caller's own address and only when
// their "Email" switch is on. Each user is limited to DAILY_LIMIT emails a day.
//
// Secrets (Supabase dashboard > Edge Functions > Secrets):
//   RESEND_API_KEY  required
//   MAIL_FROM       e.g. "Interior Design <hello@yourdomain.com>"
//   SITE_URL        e.g. "https://your-site.vercel.app" (adds a link to the emails)
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Interior Design <onboarding@resend.dev>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
const DAILY_LIMIT = 20;
const BATCH_SIZE = 100;

// Browsers may call this only from the site itself and the local dev server.
const ALLOWED_ORIGINS = [SITE_URL || "https://interior-design-web-mu.vercel.app", "http://localhost:5173"];

const corsFor = (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const clip = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

type Mail = { subject: string; text: string };

/** The wording of each personal email. Only short, clipped values from the caller are used. */
function personalMail(kind: string, params: Record<string, unknown>, name: string): Mail | null {
  const hello = `Hi ${name || "there"},`;
  if (kind === "plan_ready") {
    const rooms = Math.max(0, Math.min(99, Number(params.rooms) || 0));
    return {
      subject: "Your floor plan is ready",
      text: `${hello}\n\nWe finished reading your floor plan${rooms ? ` and found ${rooms} ${rooms === 1 ? "room" : "rooms"}` : ""}. Pick a room to see furniture layouts for it.`,
    };
  }
  if (kind === "design_saved") {
    const room = clip(params.room, 80) || "your room";
    const layout = clip(params.layout, 120);
    return {
      subject: `Your ${room} design is saved`,
      text: `${hello}\n\nYour design for ${room}${layout ? ` (${layout})` : ""} is saved. You can open it again, in 3D, from your dashboard.`,
    };
  }
  return null;
}

function render(mail: Mail) {
  const footer = `You get this because email notifications are on for your account. Turn them off under Profile > Notifications${SITE_URL ? ` at ${SITE_URL}` : ""}.`;
  const text = `${mail.text}\n\n${SITE_URL ? `${SITE_URL}\n\n` : ""}${footer}`;
  const paragraphs = mail.text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:16px;line-height:1.55;color:#1c1b22;max-width:520px;margin:0 auto;padding:24px">${paragraphs}${
    SITE_URL ? `<p style="margin:24px 0"><a href="${escapeHtml(SITE_URL)}" style="background:#26223f;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none">Open the site</a></p>` : ""
  }<p style="margin:24px 0 0;font-size:13px;color:#6b6a75">${escapeHtml(footer)}</p></div>`;
  return { subject: mail.subject, html, text };
}

/** Resend only delivers to the account owner while mail goes out from its shared test address. */
const usingTestSender = /@resend\.dev>?\s*$/i.test(MAIL_FROM);

class ProviderError extends Error {
  constructor(public status: number, detail: string) {
    super(`Resend answered ${status}: ${detail}`);
  }
}

async function resend(path: string, payload: unknown) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new ProviderError(res.status, (await res.text()).slice(0, 300));
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!RESEND_API_KEY) return json({ sent: false, reason: "not_configured" }, 503);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await asCaller.auth.getUser();
  if (authError || !user) return json({ error: "Sign in first." }, 401);

  let body: { kind?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send JSON." }, 400);
  }
  const kind = String(body.kind ?? "");
  const params = body.params ?? {};

  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: me } = await db.from("User").select("FullName, Email, Role, NotificationPrefs").eq("UserID", user.id).maybeSingle();
  if (!me) return json({ error: "No profile." }, 403);

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from("EmailLog").select("EmailLogID", { count: "exact", head: true }).eq("UserID", user.id).gte("SentAt", since);
  if ((count ?? 0) >= DAILY_LIMIT) return json({ sent: false, reason: "limit" }, 429);

  try {
    if (kind === "news") {
      if (String(me.Role).toLowerCase() !== "admin") return json({ error: "Admins only." }, 403);
      const subject = clip(params.subject, 150);
      const message = clip(params.message, 5000);
      if (!subject || !message) return json({ error: "A subject and a message are needed." }, 400);

      // A test goes to the admin's own address only.
      let addresses: string[];
      if (params.testOnly === true) {
        if (!me.Email) return json({ sent: false, reason: "no_address" });
        addresses = [String(me.Email).trim()];
      } else {
        const { data: readers } = await db.from("User").select("Email").filter("NotificationPrefs->>updates", "eq", "true").not("Email", "is", null);
        addresses = [...new Set((readers ?? []).map((r) => String(r.Email).trim()).filter(Boolean))];
      }
      const { subject: s, html, text } = render({ subject, text: message });
      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        await resend("/emails/batch", addresses.slice(i, i + BATCH_SIZE).map((to) => ({ from: MAIL_FROM, to: [to], subject: s, html, text })));
      }
      await db.from("EmailLog").insert({ UserID: user.id, Kind: params.testOnly === true ? "news_test" : "news", Recipients: addresses.length });
      return json({ sent: true, recipients: addresses.length });
    }

    const mail = personalMail(kind, params, String(me.FullName ?? "").split(/\s+/)[0]);
    if (!mail) return json({ error: "Unknown kind." }, 400);
    if (me.NotificationPrefs?.email === false) return json({ sent: false, reason: "off" });
    if (!me.Email) return json({ sent: false, reason: "no_address" });

    const { subject, html, text } = render(mail);
    await resend("/emails", { from: MAIL_FROM, to: [me.Email], subject, html, text });
    await db.from("EmailLog").insert({ UserID: user.id, Kind: kind, Recipients: 1 });
    return json({ sent: true });
  } catch (err) {
    console.error("send-notification failed:", err instanceof Error ? err.message : err);
    if (err instanceof ProviderError && usingTestSender && (err.status === 403 || err.status === 422)) {
      return json({ sent: false, reason: "domain_not_verified" }, 502);
    }
    return json({ sent: false, reason: "provider_error" }, 502);
  }
});
