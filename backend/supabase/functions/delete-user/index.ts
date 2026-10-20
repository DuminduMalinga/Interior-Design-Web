import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Lets an admin delete a customer's account from the Manage Accounts page.
//
// The caller's token is checked here (the function is deployed with
// `--no-verify-jwt`): they must be signed in and have Role = 'Admin'. An admin
// can never delete another admin or themselves, the same rule the database
// policies on public."User" apply to the page's own queries. Deleting the
// auth user removes the profile row, floor plans and designs with it
// (on delete cascade).

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);

    // 1. The caller must be a signed-in admin.
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: callerProfile } = await supabaseUser
      .from("User")
      .select("Role")
      .eq("UserID", user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.Role?.toLowerCase() !== "admin") {
      return json({ error: "Forbidden: admin access required" }, 403);
    }

    // 2. Which account.
    const body = (await req.json().catch(() => null)) as { userId?: unknown } | null;
    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!UUID.test(userId)) return json({ error: "A valid userId is required" }, 400);
    if (userId === user.id) return json({ error: "You cannot delete your own account here" }, 400);

    // 3. The admin client.
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const secretKey = secretKeys["default"];
    if (!secretKey) return json({ error: "Supabase secret key is not configured" }, 500);

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 4. Admin accounts are protected.
    const { data: target } = await supabaseAdmin
      .from("User")
      .select("Role")
      .eq("UserID", userId)
      .maybeSingle();
    if (target?.Role?.toLowerCase() === "admin") {
      return json({ error: "Admin accounts cannot be deleted" }, 403);
    }

    // 5. Delete the auth user; the profile and everything they own go with it.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) return json({ error: deleteError.message }, 400);

    return json({ success: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
