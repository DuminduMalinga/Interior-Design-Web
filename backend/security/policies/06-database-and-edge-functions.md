# 06 Database & edge functions

## Database
- **RLS on every table** in `public`. A table without RLS blocks the release.
- Policies are written per operation (`select`, `insert`, `update`, `delete`), with both `USING` and `WITH CHECK` on writes.
- Users cannot change their own `Role`, `UserID` or ownership columns (column-level check or trigger).
- `anon` has no table privileges. `authenticated` gets only what policies then narrow.
- `SECURITY DEFINER` functions: pin `search_path` (empty, or `public` where the function is written against `public`, as `is_admin`,
  `get_site_stats` and `delete_my_account` are), schema-qualify objects where the path is empty, and `revoke execute ... from public, anon`
  unless intentionally public. The intentionally callable ones are `check_username_available` and `get_site_stats` (signed-out),
  `is_admin` (used inside policies) and `delete_my_account` (signed-in, refuses admins). The security advisor will keep listing them;
  that is expected. They return only a yes/no or totals. *Not yet rate limited;* put Supabase or Caddy limits in front if abuse appears.
- Migrations are the only way to change the schema and are reviewed in PRs. No ad-hoc SQL in production.
- Run the Supabase security advisor after each migration.
- Backups: daily (point-in-time recovery on a paid plan). Restore test every quarter.

## Edge functions
- Deploy with `--no-verify-jwt` only when the function verifies the token itself (as `delete-user` does) or must be public (`username-login`).
  Keep the function source in `backend/supabase/functions/` and deploy from there, so the repo and the live function never differ.
- Every admin function writes to `public."AdminAuditLog"`.
- Read secrets from `Deno.env`; fail closed (503) when missing.
- Validate every body field (type, length, format). Reject unknown shapes with 400.
- Escape any user text placed in HTML (see `escapeHtml` in `send-notification`).
- Per-user / per-IP limits for anything that sends email or can enumerate users.
- Pin imports to exact versions (`@supabase/supabase-js@2.x.y`, `std@0.x.y`).
- Return generic errors; log details with a request id.
