# Security

Single home for the security policies and hardening config of the Interior Design Web backend
(Supabase database + edge functions, the FastAPI layout/detector services, and the AWS EC2 / Caddy deployment).

## Policies (`policies/`)

| # | Policy | Covers |
|---|--------|--------|
| 01 | [Access control & authentication](policies/01-access-control-and-authentication.md) | Roles, passwords, sessions, admin actions |
| 02 | [Data protection & privacy](policies/02-data-protection-and-privacy.md) | Personal data, retention, deletion, encryption |
| 03 | [API & network security](policies/03-api-and-network-security.md) | CORS, TLS, rate limits, headers, request limits |
| 04 | [Secrets management](policies/04-secrets-management.md) | Keys, `.env` files, rotation |
| 05 | [File upload](policies/05-file-upload.md) | Floor plan images |
| 06 | [Database & edge functions](policies/06-database-and-edge-functions.md) | RLS, grants, migrations, function rules |
| 07 | [Dependencies & supply chain](policies/07-dependencies-and-supply-chain.md) | Pinning, scanning, containers |
| 08 | [Logging, monitoring & incident response](policies/08-logging-monitoring-incident-response.md) | What to log, how to react to a breach |

## Config (`config/`)

| File | Use |
|------|-----|
| [Caddyfile.security](config/Caddyfile.security) | Security headers, body-size limit and rate-limit notes to merge into `backend/deploy/Caddyfile` |
| [vercel.security.json](config/vercel.security.json) | Security headers + a report-only CSP to merge into `frontend/vercel.json` |
| [docker-hardening.yml](config/docker-hardening.yml) | Compose overrides: read-only FS, dropped capabilities, resource limits (test the detector first) |

[CHECKLIST.md](CHECKLIST.md) is the pre-deploy checklist. Work through it before every production deploy.

## Status

Last checked against the code, the live database and the live site. Update this table when something changes.

### In place and verified
- Row-level security on every table; a customer cannot change their own `Role`, edit or read other users' rows, or read the email log (tested with a rolled-back transaction).
- `anon` has no table grants; the trigger function cannot be called over the API.
- `floorplans` bucket limited to PNG/JPEG at 10 MB.
- Route guards in the web app (`RequireAuth`), backed by the database rules.
- `delete-user`: checks the caller is an admin, refuses admins and self, removes the user's files first, writes `AdminAuditLog`, CORS limited to the site.
- `username-login` and `send-notification`: CORS limited to the site.
- No secrets in git history (scanned for service-role and secret keys).
- Only ports 80/443 are published by Docker Compose; all Python dependencies are pinned.

### Written, waiting for you to deploy
| What | Where | Order |
|------|-------|-------|
| Layout and detector APIs require a signed-in user, `/docs` and `/openapi.json` off | `backend/*/supabase_auth.py`, each `api.py`, `wall_detector/main.py`, `docker-compose.yml` | 1. deploy the web app, 2. add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `backend/deploy/.env`, 3. `docker compose up -d --build`, 4. run `check-services.sh` |
| Floor plan images private, opened by short-lived signed links | web app + `migrations/20261020100000_private_floorplans_bucket.sql` | deploy the web app **first**, then run the migration |

### Still open (priority order)
1. **Rate limiting** on `username-login`, `/detect` and `/generate*` (Caddy module or `slowapi`).
2. **Upload validation** in `wall_detector/main.py`: it reads the whole body before checking size, has no real-image check, no pixel cap (decompression bomb), no dimension limits, no re-encode (policy 05).
3. **Security headers / CSP** on Vercel: `config/vercel.security.json` is ready; apply it in report-only mode first.
4. **Containers run as root** (`Dockerfile.layout` has no `USER`); apply `config/docker-hardening.yml` after testing.
5. **CAPTCHA** is off for sign-up, sign-in and password reset (Supabase, Authentication, Attack Protection).
6. **Passwords:** the form asks for 8 characters, in the browser only. Set the minimum in Supabase (Authentication, Sign In / Providers) to match policy 01. Leaked-password protection needs the Pro plan.
7. **Admin MFA** is not enabled.
8. **Dependencies are unscanned:** add `pip-audit` / `npm audit` to CI, Dependabot, and pin the Deno imports (`std@0.168.0`, `esm.sh/@supabase/supabase-js@2` is a floating major).
9. **Backups:** no documented backup or restore test for the database and buckets; the Free plan has no automatic backups.
10. **Repository protections:** no `.github/` folder (CI, Dependabot), no branch protection, no GitHub secret scanning.
11. **`repo/`** at the repository root is a full duplicate of the project; delete it.
12. **Privacy:** the site has no privacy policy or terms page, though it stores names, emails, phone, location and floor plans.
13. **Supabase redirect list** still has wildcard entries for the old `interior-hash-tag` project; remove them once that project is gone.
14. **Client-side sign-in lockout** (SignIn page) lives in browser state and resets on refresh; do not count on it. Rely on Supabase rate limits and CAPTCHA.

Report a vulnerability: see [`/SECURITY.md`](../../SECURITY.md).
