# Pre-deploy security checklist

## Secrets
- [ ] No `.env`, key, token or `service_role` key in git (`git log -p -S"service_role"` is clean)
- [ ] Frontend contains only the Supabase **anon/publishable** key
- [ ] The Python services get only `SUPABASE_URL` and the **anon** key (never the service-role key)
- [ ] `RESEND_API_KEY` and any service keys are set as Supabase function secrets, not in code
- [ ] Keys rotated if anyone who had them left the project

## Database
- [ ] RLS enabled on every table in `public`
      (`select tablename from pg_tables where schemaname='public' and not rowsecurity;` returns nothing)
- [ ] Supabase security advisor reviewed. Expected leftovers: the intentionally callable functions (policy 06),
      `EmailLog` with no policies (written only by the email function), leaked-password protection on the Free plan
- [ ] `anon` has no table grants (`select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon'` is 0)
- [ ] Two-account test passes: a customer cannot set their own `Role`, edit or read another user's profile, floor plans or saved designs
- [ ] Storage: `floorplans` and `designs` private; `avatars` public by design; every bucket has size + MIME limits
- [ ] Every migration in `backend/supabase/migrations/` is applied, and nothing was changed in the dashboard without a migration file

## Edge functions
- [ ] CORS limited to `SITE_URL` (+ localhost in dev) on `send-notification`, `delete-user`, `username-login`
- [ ] JWT verified and role checked inside every privileged function; admin actions write `AdminAuditLog`
- [ ] The deployed version matches `backend/supabase/functions/` (compare the version after each deploy)
- [ ] Input validated; errors do not leak internals

## API / network
- [ ] HTTPS only; HTTP redirects (Caddy default)
- [ ] `ALLOWED_ORIGINS` is the real Vercel URL, not `*`
- [ ] `backend/deploy/.env` has `SUPABASE_URL` and `SUPABASE_ANON_KEY`; `REQUIRE_AUTH` is **not** set to false on the server
- [ ] `./backend/deploy/check-services.sh https://SITE https://your-app.vercel.app` passes
- [ ] An anonymous call to `/living-room/generate-all` returns 401, and `/living-room/docs` returns 404
- [ ] Security headers from `config/` applied; the report-only CSP shows no violations on every page before it is enforced
- [ ] Request body limit and rate limits active
- [ ] Only ports 80/443 (and SSH from your IP) open in the EC2 security group

## Containers / dependencies
- [ ] Containers non-root, read-only FS where possible (test the detector first)
- [ ] `pip-audit -r requirements.txt` and `npm audit --omit=dev` reviewed
- [ ] Base images pinned and rebuilt in the last 30 days

## Operations
- [ ] Admin accounts have MFA
- [ ] Backups exist and a restore was tested this quarter
- [ ] Incident contact list current (policy 08)
- [ ] GitHub private vulnerability reporting is switched on (Settings > Code security) so `SECURITY.md` works
