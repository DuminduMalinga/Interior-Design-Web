import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Lets an admin delete a customer's account from the Manage Accounts page.
//
// The caller's token is checked here (the function is deployed with
// `--no-verify-jwt`): they must be signed in and have Role = 'Admin'. An admin
// can never delete another admin or themselves, the same rule the database
// policies on public."User" apply to the page's own queries.
//
// What a delete does, in order:
//   1. removes the user's files from the floorplans, designs and avatars buckets
//   2. deletes the auth user (the profile row, floor plans and saved designs go
//      with it through on delete cascade)
//   3. writes a line to public."AdminAuditLog" saying who deleted whom
//
// Browsers may call it only from the site itself and the local dev server.

const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
const ALLOWED_ORIGINS = [SITE_URL || "https://interior-design-web-mu.vercel.app", "http://localhost:5173"];

const corsFor = (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKETS = ["floorplans", "designs", "avatars"];
const PAGE = 1000;

// deno-lint-ignore no-explicit-any
type Admin = any;

/** Every file under a folder of a bucket, at any depth. */
async function listFiles(admin: Admin, bucket: string, folder: string): Promise<string[]> {
  const files: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: PAGE, offset });
    if (error) throw new Error(`Listing ${bucket} failed: ${error.message}`);
    for (const entry of data ?? []) {
      const path = `${folder}/${entry.name}`;
      // folders come back without an id
      if (entry.id) files.push(path);
      else files.push(...(await listFiles(admin, bucket, path)));
    }
    if ((data ?? []).length < PAGE) break;
  }
  return files;
}

/** Removes the user's files from every bucket; returns how many were removed. */
async function removeUserFiles(admin: Admin, userId: string): Promise<number> {
  let removed = 0;
  for (const bucket of BUCKETS) {
    const files = await listFiles(admin, bucket, userId);
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await admin.storage.from(bucket).remove(files.slice(i, i + 100));
      if (error) throw new Error(`Removing files from ${bucket} failed: ${error.message}`);
    }
    removed += files.length;
  }
  return removed;
}

serve(async (req: Request) => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
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

    // 5. Files first: if this fails nothing has been deleted and it can be retried.
    let filesRemoved = 0;
    try {
      filesRemoved = await removeUserFiles(supabaseAdmin, userId);
    } catch (err) {
      console.error("delete-user: removing files failed:", err instanceof Error ? err.message : err);
      return json({ error: "The user's files could not be removed. Nothing was deleted; try again." }, 500);
    }

    // 6. Delete the auth user; the profile and everything they own go with it.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) return json({ error: deleteError.message }, 400);

    // 7. Leave a record. A failure here must not undo or hide the deletion.
    const { error: auditError } = await supabaseAdmin.from("AdminAuditLog").insert({
      ActorID: user.id,
      Action: "delete_user",
      TargetID: userId,
      Detail: { filesRemoved },
    });
    if (auditError) console.error("delete-user: audit log write failed:", auditError.message);

    return json({ success: true });
  } catch (err) {
    console.error("delete-user failed:", err instanceof Error ? err.message : err);
    return json({ error: "Internal server error" }, 500);
  }
});
