# Deploying the backend on AWS (one EC2 instance + Docker Compose + HTTPS)

All seven services run on one instance behind Caddy, which serves HTTPS on one hostname with a path per service.

## 1. Launch the instance (AWS Console)
- EC2 > Launch instance: **Ubuntu 24.04**, **t3.large** (8 GB RAM; torch + EasyOCR need it), 30 GB gp3 disk.
- Security group inbound: **22** (My IP only), **80** and **443** (anywhere).
- Allocate an **Elastic IP** and attach it (so the address survives reboots).
- Hostname: your own domain (A record -> Elastic IP) or `<ip-with-dashes>.nip.io`, e.g. `3-110-20-5.nip.io`.

## 2. Install Docker on the instance
```bash
ssh -i key.pem ubuntu@<elastic-ip>
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ubuntu && exit   # reconnect after
```

## 3. Get the code and model
```bash
git clone https://github.com/DuminduMalinga/Interior-Design-Web.git
mkdir -p Interior-Design-Web/backend/deploy/models
```
From your PC (best.pt is gitignored):
```powershell
scp -i key.pem backend\wall_detector\models\best.pt ubuntu@<elastic-ip>:~/Interior-Design-Web/backend/deploy/models/
```

## 4. Configure and start
```bash
cd ~/Interior-Design-Web/backend/deploy
cp .env.example .env && nano .env      # SITE_ADDRESS, your Vercel URL, SUPABASE_URL and SUPABASE_ANON_KEY (the public anon key only)
docker compose up -d --build           # first build takes several minutes
curl https://<SITE_ADDRESS>/detector/health
```

## 5. Point Vercel at it
Vercel > Project > Settings > Environment Variables, then **redeploy** the frontend:

| Variable | Value |
|---|---|
| VITE_DETECTOR_URL | https://SITE/detector |
| VITE_LIVING_ROOM_LAYOUT_URL | https://SITE/living-room |
| VITE_BEDROOM_LAYOUT_URL | https://SITE/bedroom |
| VITE_KITCHEN_LAYOUT_URL | https://SITE/kitchen |
| VITE_BATHROOM_LAYOUT_URL | https://SITE/bathroom |
| VITE_DINING_LAYOUT_URL | https://SITE/dining |
| VITE_MASTER_BEDROOM_LAYOUT_URL | https://SITE/master-bedroom |

(`VITE_SUPABASE_*` stay as they are; Supabase is not part of this.)

## 6. Check it from outside
From any machine with `curl`, run the check with your services address and your Vercel address. It confirms every service answers `/health` and that each one allows your web app's address (CORS):
```bash
./check-services.sh https://SITE https://your-app.vercel.app
```
Then try the whole flow on the live site: sign in, upload a floor plan, pick a room, open a layout in 3D, save it. If the browser console shows a CORS error, the web app's exact address is missing from `ALLOWED_ORIGINS` in `.env` (then `docker compose up -d`).

## Updating
`git pull && docker compose up -d --build`. Logs: `docker compose logs -f detector`.

## Running the detector on a 1 GB t3.micro (free plan)
It works but is memory-bound (about 30 s per floor plan; most of it is OCR). What was done on the server to get there:
- 2 GB swap file plus **zram** compressed swap (`sudo apt install zram-tools`, `/etc/default/zramswap`: `ALGO=zstd`, `PERCENT=100`, `PRIORITY=100`) and `vm.swappiness=100`.
- Disabled unused services (snapd, ssm-agent, ModemManager, udisks2, packagekit, fwupd, multipathd).
- Start the detector with `docker compose --profile detector up -d`. A larger instance (4 GB+) makes it several times faster.
