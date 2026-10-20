# 01 Access control & authentication

## Principles
- **Least privilege.** Users reach only their own rows; admins reach only what the admin pages need.
- **Server decides.** Route guards in the frontend are UX only. Every rule must also be enforced by RLS or an edge function.
- **Deny by default.** New tables, buckets and functions start with no access and are opened deliberately.

## Roles
| Role | Can |
|------|-----|
| Signed-out | Call `check_username_available` and `get_site_stats`, sign up, sign in. Nothing else. |
| User | Read/write own profile, floor plans, saved designs, notifications. |
| Admin (`public."User".Role = 'Admin'`) | Manage customer accounts, send announcements. Cannot delete other admins or self. |

The Admin role is assigned only in the database by the project owner or an existing admin working in the Supabase dashboard.
It must never be settable from a client request. This is enforced by **column-level grants**, not by a row policy:
signed-in users hold `UPDATE` only on `FullName`, `UserName`, `Phone`, `Location`, `Bio`, `LastSignIn`, `NotificationPrefs`
and `AvatarUrl` of `public."User"`. Never grant `UPDATE` on the whole table or on `Role`/`Email`/`UserID`. Re-run the
two-account test (a customer tries to set their own `Role` and to edit another user) after every change to `User`.

## Authentication
- Supabase Auth only; no custom password storage.
- Minimum password length 10 and email confirmation required, set in Supabase (Authentication, Sign In / Providers) and mirrored in the
  sign-up form. Leaked-password protection ON where the plan allows it (Pro plan).
  *Today:* the form asks for 8 characters, in the browser only, so set the Supabase minimum to match.
- CAPTCHA (Turnstile or hCaptcha) on sign-up, sign-in and password reset. *Today: off.*
- The sign-in page's lockout after 3 failures lives in browser state and is only a courtesy; the real limits are Supabase's rate limits and CAPTCHA.
- Admin accounts must use MFA (TOTP).
- Short-lived access token (default 1 h), refresh-token rotation ON. Sign-out revokes the session.
- `username-login` returns the same response and timing for "unknown user" and "wrong password", and is rate limited
  (suggested 5 attempts / 15 min per IP and per username).

## Privileged actions
- Every edge function acting for an admin must: (1) require `Authorization`, (2) call `auth.getUser()`,
  (3) re-read the role from the database, (4) validate input, (5) log the action (who, what, when) to `public."AdminAuditLog"`.
  `delete-user` does all five; copy it for any new admin function.
- A `service_role` client is created only after steps 1-3 pass and is never exposed to the browser.

## Review
Review the admin list quarterly; remove admins who no longer need access.
