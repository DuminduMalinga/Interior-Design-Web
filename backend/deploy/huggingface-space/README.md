---
title: Interior Design Wall Detector
emoji: 🏠
colorFrom: purple
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

YOLO floor-plan detector API (`/health`, `/detect`) for the Interior Design app.

Every route except `/health` needs a signed-in user. In the Space settings add the variables
`SUPABASE_URL` and `SUPABASE_ANON_KEY` (the public anon key, never the service-role key), and set
`ALLOWED_ORIGINS` to the web app's address. Without them the detector refuses requests with 503.
