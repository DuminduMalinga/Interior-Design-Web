import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Signs a user in by username + password (SRS: "username/email and password").
//
// The username is resolved to an email and the password checked entirely
// server-side, so the caller never learns anyone's email address, and an
// unknown username is indistinguishable from a wrong password. On success the
// session tokens are returned for the client to adopt with `setSession`.
//
// This is a public login endpoint by design, so it is deployed with
// `--no-verify-jwt` (the app's publishable key is not a JWT).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const INVALID = "Invalid login credentials";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => null)) as
      | { username?: unknown; password?: unknown }
      | null;
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    // Same character rule the sign-up form enforces; also keeps wildcard
    // characters out of the lookup below.
    if (!username || !password || username.length > 64 || password.length > 256 ||
        !/^[A-Za-z0-9_]+$/.test(username)) {
      return json({ error: INVALID }, 400);
    }

    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const secretKey = secretKeys["default"];
    if (!secretKey) return json({ error: "Server is not configured" }, 500);

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Usernames are unique case-insensitively (see check_username_available).
    // `_` is a single-character wildcard in LIKE, so escape it.
    const { data: row, error: lookupError } = await admin
      .from("User")
      .select("Email")
      .ilike("UserName", username.replace(/_/g, "\\_"))
      .limit(1)
      .maybeSingle();

    if (lookupError) return json({ error: "Sign in failed. Please try again." }, 500);
    if (!row?.Email) return json({ error: INVALID }, 400);

    const anon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data, error } = await anon.auth.signInWithPassword({
      email: row.Email,
      password,
    });

    if (error || !data.session) {
      // Do not reveal which part was wrong, or whether the account exists.
      const generic = !error || error.code === "invalid_credentials" || error.status === 400;
      return json({ error: generic ? INVALID : error!.message }, 400);
    }

    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (_err) {
    return json({ error: "Sign in failed. Please try again." }, 500);
  }
});
