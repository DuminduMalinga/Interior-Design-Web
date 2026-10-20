# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: **Security > Report a vulnerability** on this repository
(private vulnerability reporting must be switched on in the repository settings: Settings > Code security).

Include what you found, how to reproduce it, and what an attacker could do with it.

We aim to acknowledge a report within 3 working days, keep you informed while it is fixed, and ask that the issue is not
made public until a fix is released.

## Scope

The web app (`frontend/`), the Supabase project (database rules, storage, edge functions in `backend/supabase/`) and the
detector and layout services (`backend/`). Findings about third-party services themselves (Supabase, Vercel, AWS, Resend)
should go to those vendors.

## Our policies

The security policies, hardening config and pre-deploy checklist live in [`backend/security/`](backend/security/README.md).
