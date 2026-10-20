# 04 Secrets management

## What is a secret
Supabase `service_role` key, JWT secret, `RESEND_API_KEY`, any `API_KEY`, database password, AWS credentials, SSH keys.
The Supabase **anon/publishable key and project URL are public by design**; their safety rests on RLS.

## Rules
1. Secrets never go in git. `.gitignore` already excludes `.env` and `*.env`; only `.env.example` files with placeholders are committed.
2. Edge function secrets live in Supabase (`supabase secrets set NAME=value`). Server secrets live in `backend/deploy/.env` on the host (mode `600`).
3. `service_role` is used only server-side and must never appear in `frontend/`.
4. One secret per purpose and per environment (dev and prod use different keys).
5. **Rotate** every 90 days, immediately on suspected leak, and when a person with access leaves.
6. Enable GitHub secret scanning and push protection; run `gitleaks detect` before releases.
7. If a secret was committed: rotate first, then clean history. Deleting the commit alone is not enough.
8. Do not paste secrets into issues, chat, screenshots or AI tools.
9. AWS: use an IAM role on the EC2 instance instead of long-lived access keys; enable MFA on root and admin accounts.

## Inventory (keep current)
| Secret | Stored in | Owner | Last rotated |
|--------|-----------|-------|--------------|
| `RESEND_API_KEY` | Supabase function secrets | | |
| Supabase service key | Supabase function secrets (auto-provided) | | |
| `API_KEY` (layout services, if added) | `backend/deploy/.env` | | |
