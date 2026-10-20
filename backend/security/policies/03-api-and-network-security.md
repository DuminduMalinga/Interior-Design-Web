# 03 API & network security

Applies to the FastAPI services (`/detect`, `/generate`, `/generate-all`), Caddy and the Supabase edge functions.

## Transport
- HTTPS only. Caddy issues and renews certificates and redirects HTTP to HTTPS. Never expose service port 8000 directly.
- Services listen inside the Docker network; only Caddy publishes 80/443.

## CORS
- `ALLOWED_ORIGINS` lists exact origins. Never `*` on anything that changes data.
- Edge functions: reflect the origin only if it is in the allow-list (`SITE_URL` secret, the live site, and `http://localhost:5173`).
  `send-notification`, `delete-user` and `username-login` all do this.
- Allow only the methods and headers actually used.

## Authentication of service calls
- The layout and detector APIs are not anonymous. The browser sends its Supabase access token
  (`frontend/src/app/lib/serviceAuth.ts`) and each service asks Supabase whether it is valid
  (`backend/*/supabase_auth.py`; accepted tokens are cached for 60 s). Everything except `/health` returns 401 without a
  valid token, and 503 if the check is not configured (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) or Supabase is unreachable.
  `REQUIRE_AUTH=false` exists for local development only and must never be set on a server.
- The same file lives in every service folder (the images are built separately); change them together.
- `/docs`, `/redoc` and `/openapi.json` are off unless `ENABLE_DOCS=true`.

## Limits
- **Body size:** images up to 10 MB (matches the bucket and the upload page); JSON payloads up to 1 MB. Caddy allows 11 MB to cover the
  multipart envelope; set `MAX_IMAGE_BYTES=10485760` on the detector (its default is 12 MB).
- **Rate limit:** 30 req/min/IP for `/generate*`, 6 req/min/IP for `/detect`, 5 attempts/15 min for login.
  Use a Caddy rate-limit module or `slowapi` in FastAPI.
- **Timeouts:** server-side timeouts on heavy endpoints so a slow request cannot hold a worker forever.
- **Input validation:** typed Pydantic models instead of `Dict[str, Any]` where practical; bound every number (room size, counts, list lengths).

## Headers (see `config/`)
`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and a CSP that allows only the site, Supabase and the backend host.
Remove the `Server` header.

## Errors
Return generic messages to clients; log details server-side. No stack traces, file paths or SQL in responses.
Disable FastAPI docs in production: `FastAPI(docs_url=None, redoc_url=None, openapi_url=None)`.

## Firewall (AWS)
Security group: 80/443 from anywhere, 22 only from the admin's IP (or use SSM and close 22). No other inbound ports.
