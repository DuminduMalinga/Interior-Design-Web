# 05 File upload (floor plan images)

Untrusted images are the main attack surface of the detector (`/detect`) and the `floorplans` bucket.

## Required checks (server side, in this order)
1. **Size:** reject over 10 MB before reading the whole body (check `Content-Length`, and enforce a hard cap while reading).
2. **Type:** accept PNG and JPEG only. Check the **magic bytes** (`\x89PNG\r\n\x1a\n`, `\xff\xd8\xff`), not the filename or `Content-Type`.
3. **Decode safely:** open with Pillow, call `verify()`, then re-open. Set `Image.MAX_IMAGE_PIXELS` (e.g. 40 million) to stop decompression bombs.
4. **Dimensions:** reject images under 200 px or over 8000 px on a side.
5. **Re-encode** the image before storing or passing it on; this drops metadata (EXIF GPS) and any polyglot payload.
6. **Filename:** never use the client filename on disk. Generate a UUID and store under `<user_id>/<uuid>.<ext>`.

## Status
The 10 MB limit and a size check exist in the detector (it reads the whole body first). **Not yet implemented:** the magic-byte check,
`verify()`, the pixel cap, dimension limits and re-encoding (checks 1-5 above). Until they are, treat the detector as exposed to hostile images.

## Storage
- Bucket `floorplans` is limited to `image/png` and `image/jpeg`, 10 MB (migration `20261020080000_security_hardening.sql`)
  and is made private by `20261020100000_private_floorplans_bucket.sql` (run it after the web app that signs links is live).
- Storage RLS: a user can read/write/delete only objects whose path starts with their own `auth.uid()`.
- Uploaded files are never served from the app origin with an executable content type.

## Processing
- Run the detector with CPU/memory limits and a per-request timeout.
- Do not write uploads to a web-served directory. Delete temp files after the request.
- Antivirus scanning (ClamAV) is optional for this image-only flow; revisit if other file types are ever allowed.
