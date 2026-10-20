# InteriorAI

Upload a 2D floor plan, let the site find every room, compare scored furniture layouts for the room you pick, and walk through the result in 3D.

The project has three parts:

| Part | What it is | Where |
|------|------------|-------|
| **Web app** | React + TypeScript single-page app (Vite) | `frontend/` |
| **Layout and detection services** | Seven small Python (FastAPI) services | `backend/` |
| **Accounts, data and files** | Supabase: Postgres with row-level security, Auth, Storage and Edge Functions | `backend/supabase/` |

There is no Node/Express server. The browser talks to Supabase directly and to the Python services over HTTP.

---

## How it works

```
Upload floor plan ──► Wall detector (YOLO + OCR) ──► Select a room
        │                                                 │
        ▼                                                 ▼
 Supabase Storage + FloorPlan row            Room-type layout service
                                              (rule-based, scores layouts)
                                                          │
                                                          ▼
                                       Compare layouts ──► 3D view ──► Save / export
```

1. **Upload** (`/upload`): the image goes to the `floorplans` storage bucket and a `FloorPlan` row is created.
2. **Detect** (`/processing`): the wall detector finds walls, rooms, doors and windows and reads each room's printed label. The result is saved in `FloorPlanAnalysis`, and the rooms, doors and windows are copied into the `Room` and `StructuralElement` tables.
3. **Select a room** (`/select-room`).
4. **Layouts** (`/view-layouts`): the service for that room type (living room, bedroom, master bedroom, kitchen, bathroom, dining) returns several furniture arrangements, each scored against its design rules.
5. **3D view** (`/room-view-3d`): the chosen layout as a real-size three.js room. Orbit and zoom, click furniture, export a PNG or a GLB model, and save the design to your account (`SavedDesign` table and the private `designs` bucket).

Other pages: landing page, About, sign up, sign in, forgot and reset password, a dashboard (your designs, profile with picture, password, notifications) and an admin page for managing accounts.

---

## Features

- **Accounts:** sign up, sign in with email and password or with Google, password reset, profile with picture, notification choices, delete your own account.
- **Roles:** `Customer` and `Admin`. Signed-out visitors are sent to the sign-in page, and customers cannot open the admin page. Admins can manage customer accounts but cannot edit or delete other admins.
- **Floor plan analysis:** room, wall, door and window detection with room-name OCR.
- **Layout engines:** rule-based and deterministic (no ML), one per room type, each with its own unit tests.
- **3D viewer:** three.js scene, PNG and GLB export, saved designs.
- **Email notifications:** "plan ready" and "design saved" emails, plus admin product news, sent by an edge function through Resend. Users can switch each kind off on their profile.
- **Light and dark theme.**

---

## Tech stack

| Area | Technology |
|------|-----------|
| Web app | React 18, TypeScript, Vite 6, React Router 7, Tailwind CSS 4, Radix UI (shadcn/ui), Motion, GSAP, three.js, React Hook Form |
| Services | Python, FastAPI, YOLO (Ultralytics) and EasyOCR for detection |
| Data and auth | Supabase (Postgres, Auth, Storage, Edge Functions on Deno) |
| Email | Resend (from the `send-notification` edge function) |
| Hosting | Vercel for the web app; Docker Compose + Caddy (AWS EC2) or a Hugging Face Space for the services |

---

## Repository layout

```
frontend/                    React web app
  src/app/pages/             one file per page
  src/app/components/        shared UI (RequireAuth, PublicOnlyRoute, SiteNavbar, ...)
  src/app/context/           UserContext (auth + profile), ThemeContext
  src/app/lib/               Supabase client, service clients, 3D scene code
backend/
  wall_detector/             floor plan detection + room-name OCR      (port 8000)
  living_room_layout/        living-room layouts                       (port 8100)
  bedroom_layout/            bedroom layouts                           (port 8200)
  kitchen_layout/            kitchen layouts                           (port 8300)
  bathroom_layout/           bathroom layouts                          (port 8400)
  dining_layout/             dining-area layouts                       (port 8500)
  master_bedroom_layout/     master-bedroom layouts                    (port 8600)
  deploy/                    Docker Compose, Caddy, Hugging Face Space bundle
  supabase/
    migrations/              the whole database, in order
    functions/               edge functions: send-notification, delete-user, username-login
  Layout_Engine/             early prototype with mock data (not used by the app)
```

---

## Running it locally

**Prerequisites:** Node.js 18+, Python 3.10+, and a Supabase project.

### 1. Database

Create a Supabase project and apply every file in `backend/supabase/migrations/` in name order (the Supabase CLI does this with `supabase db push`, or paste them into the SQL editor one by one). The first file, `20260701000000_baseline_schema.sql`, creates the core tables, policies and the sign-up trigger.

Deploy the edge functions from `backend/supabase/functions/`:

| Function | Purpose | JWT check at the gateway |
|----------|---------|--------------------------|
| `send-notification` | emails (needs the `RESEND_API_KEY` secret; optional `MAIL_FROM`, `SITE_URL`) | on |
| `delete-user` | an admin deletes a customer; the function checks the caller is an admin | off (checks itself) |
| `username-login` | sign in with a username instead of an email (deployed, but the current sign-in form does not call it) | off (public by design) |

In the Supabase dashboard, also turn on **leaked password protection** (Authentication settings) and make the first admin by setting `Role` to `Admin` on one row of the `User` table.

### 2. Web app

```bash
npm install                      # root install also installs frontend/
cp frontend/.env.example frontend/.env   # then fill in the values
npm run dev                      # http://localhost:5173
```

### 3. Python services

Every service answers only signed-in users: it asks Supabase whether the visitor's token is valid, so it needs the same two public values the web app uses. Copy each service's `.env.example` to `.env` and fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`. For local development you can set `REQUIRE_AUTH=false` instead; never do that on a server. With neither, the service refuses requests with 503. The interactive `/docs` page is off unless you set `ENABLE_DOCS=true`.

Each service has its own folder, `requirements.txt` and README. For example:

```bash
cd backend/living_room_layout
python -m venv venv
source venv/Scripts/activate      # Git Bash; venv\Scripts\activate in PowerShell
pip install -r requirements.txt
uvicorn api:app --port 8100
```

| Service | Command | Port |
|---------|---------|------|
| wall_detector | `uvicorn main:app --port 8000` (needs `models/best.pt`, which is git-ignored) | 8000 |
| living_room_layout | `uvicorn api:app --port 8100` | 8100 |
| bedroom_layout | `uvicorn api:app --port 8200` | 8200 |
| kitchen_layout | `uvicorn api:app --port 8300` | 8300 |
| bathroom_layout | `uvicorn api:app --port 8400` | 8400 |
| dining_layout | `uvicorn api:app --port 8500` | 8500 |
| master_bedroom_layout | `uvicorn api:app --port 8600` | 8600 |

---

## Configuration

### Web app (`frontend/.env`, see `frontend/.env.example`)

| Variable | Meaning | Default |
|----------|---------|---------|
| `VITE_SUPABASE_URL` | your Supabase project URL | required |
| `VITE_SUPABASE_ANON_KEY` | the project's public (anon / publishable) key | required |
| `VITE_DETECTOR_URL` | wall detector | `http://localhost:8000` |
| `VITE_LIVING_ROOM_LAYOUT_URL` | living-room service | `http://localhost:8100` |
| `VITE_BEDROOM_LAYOUT_URL` | bedroom service | `http://localhost:8200` |
| `VITE_KITCHEN_LAYOUT_URL` | kitchen service | `http://localhost:8300` |
| `VITE_BATHROOM_LAYOUT_URL` | bathroom service | `http://localhost:8400` |
| `VITE_DINING_LAYOUT_URL` | dining service | `http://localhost:8500` |
| `VITE_MASTER_BEDROOM_LAYOUT_URL` | master-bedroom service | `http://localhost:8600` |

Never put a Supabase service-role / secret key in the web app.

### Python services

Each service reads `ALLOWED_ORIGINS` (comma-separated browser origins that may call it; default is the local dev server), `SUPABASE_URL` and `SUPABASE_ANON_KEY` (for the sign-in check), and optionally `REQUIRE_AUTH` and `ENABLE_DOCS`. See each service's `.env.example`.

---

## Deploying

1. **Services:** follow `backend/deploy/README.md` (one EC2 instance, Docker Compose, Caddy for HTTPS), or use the Hugging Face Space bundle in `backend/deploy/huggingface-space/`. Set `ALLOWED_ORIGINS` to the exact address of your deployed web app.
2. **Web app on Vercel:** set the two `VITE_SUPABASE_*` variables and the seven `VITE_*_URL` variables to the public service addresses, then redeploy. The build command is `npm run build:frontend`; `frontend/vercel.json` rewrites every path to `index.html`.
3. **Supabase:** in Authentication, set the Site URL and redirect URLs to the deployed web app so email links and password resets come back to it.
4. Run `backend/deploy/check-services.sh https://SITE https://your-app.vercel.app` to confirm every service is up and allows your web app.
5. Check on the live site: sign up, upload a floor plan, pick a room, open a layout in 3D, save it, and sign in as an admin.

---

## Security model

- Every table has row-level security. Users can read and change only their own floor plans, rooms, layouts and saved designs. Admins can read everything.
- Users can update only their own profile fields (name, username, phone, location, bio, picture, notification choices). The `Role` column cannot be changed from the app.
- The browser only holds the public key. Admin-only actions (deleting another user) go through an edge function that checks the caller's role, removes the user's files and writes an audit-log line.
- The detector and layout services refuse anonymous requests (401) and hide their API docs.
- Storage: `floorplans` and `designs` are private (the app opens floor plans through short-lived signed links); `avatars` is public-read because the picture is shown in the navbar, with owner-only upload and delete.
- Policies, hardening config and the pre-deploy checklist are in [`backend/security/`](backend/security/README.md); report vulnerabilities as described in [`SECURITY.md`](SECURITY.md).
- Page guards in the app (`RequireAuth`) keep signed-out visitors and customers away from pages they cannot use; the database enforces the same rules.

---

## Testing

```bash
# layout engines (run inside each service folder; no pytest needed)
cd backend/living_room_layout && python -m unittest living_room_layout.tests.test_engine -v
# wall detector smoke test (needs the model file)
cd backend/wall_detector && python smoke_test.py
# web app production build
npm run build:frontend
```

---

## Credits

UI primitives from [shadcn/ui](https://ui.shadcn.com/) (MIT). Photos from [Unsplash](https://unsplash.com). See `ATTRIBUTIONS.md`.
