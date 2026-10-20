# 08 Logging, monitoring & incident response

## Logging
Log: sign-in failures, admin actions (delete user, send announcement), 401/403/429 responses, upload rejections, function errors.
Do **not** log: passwords, tokens, API keys, image contents, full request bodies.
Each entry carries a UTC timestamp, request id, user id (if known), action, result and source IP.
Keep 90 days. Sources: Supabase logs, Caddy access logs (`log` directive), `docker compose logs`.

## Monitoring & alerts
- Uptime check on `https://<SITE_ADDRESS>/health`.
- Alert on: spikes of 401/403/429 or 5xx, disk over 80 %, CPU pinned for 10+ minutes, a new admin created, Supabase advisor warnings.
- Review the Supabase security advisor and Dependabot alerts weekly.

## Incident response
| Step | Action |
|------|--------|
| 1. Detect & triage | Confirm it is real; assign an incident lead; note the start time. Severity: **S1** data exposure or account takeover, **S2** service abuse, **S3** minor. |
| 2. Contain | Rotate exposed keys; disable the affected function/endpoint; revoke sessions; block abusive IPs in the security group or Caddy. |
| 3. Eradicate | Patch the root cause; review recent migrations and commits; check for new admin users or changed policies. |
| 4. Recover | Redeploy from a clean commit; restore from backup if data was altered; watch logs closely for 48 h. |
| 5. Notify | Affected users and any regulator within the legal window (72 h under GDPR for personal-data breaches). |
| 6. Review | Blameless post-mortem within 5 working days; add a checklist item or test so it cannot recur. |

## Reporting a vulnerability
[`/SECURITY.md`](../../SECURITY.md) at the repo root points reporters to GitHub private vulnerability reporting (switch it on under
Settings > Code security). Acknowledge within 3 working days; no public disclosure until fixed.

## Contacts (fill in)
Incident lead: ____  Backup: ____  Supabase support: ____  AWS support: ____
