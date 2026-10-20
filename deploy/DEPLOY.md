# Deploy — HCMUS Physics CMS on the CentOS 7.9 sandbox

Target: `103.88.122.23`, SSH port `63379`, user `vlkt`. Specs: 4 vCPU / 4 GB / 50 GB.

> **Before anything**: the server was unreachable (`ping` → *Destination host
> unreachable*) from both this tool and the user's own machine. Confirm you can
> reach it first — likely you must be on the campus network / school VPN, or ask
> cô to open the firewall for your public IP. Nothing below works until
> `ssh -p 63379 vlkt@103.88.122.23` connects.

## Why Docker (not native)

CentOS 7.9 ships **glibc 2.17**; this project runs on **Node 24 (needs glibc ≥ 2.28)**.
Node won't run natively → the whole stack runs in **Docker**. CentOS 7 is EOL, so
`deploy.sh` repairs the dead yum mirrors (→ `vault.centos.org`) before installing Docker.

## What gets deployed

`docker-compose.sandbox.yml` (repo root) brings up a **self-contained** stack:

| Service | Port | Notes |
|---|---|---|
| `db` (postgres 16) | internal | local DB, volume `pgdata` |
| `redis` | internal | local cache (replaces the dev Redis Cloud) |
| `db-setup` | — | runs `prisma db push` + `db:seed-all` once |
| `backend` (NestJS) | 3001 | |
| `admin` (Next) | 3000 | CMS editor |
| `public` (Next) | 3002 | the main site |

## Step-by-step

### 1. Get the code onto the server
From your machine (that can reach the box):
```bash
# option A — rsync (excludes the big uploads/dump/node_modules)
rsync -az -e "ssh -p 63379" --exclude node_modules --exclude .next \
  --exclude backend/uploads --exclude 'backend/initialScript/migrate-legacy/dump' \
  ./ vlkt@103.88.122.23:~/hcmus-cms/
# option B — git clone on the box (if the repo is reachable/authorized)
```
Legacy media (`backend/uploads/legacy`, ~3.9 GB) is excluded above. Body images
resolve via the API host, so copy it separately later if you want them served
locally: `rsync -az -e "ssh -p 63379" backend/uploads/ vlkt@...:~/hcmus-cms/backend/uploads/`.

### 2. Create env files (on the box, in `~/hcmus-cms`)
```bash
cp deploy/.env.prod.example .env
nano .env            # set POSTGRES_PASSWORD + NEXT_PUBLIC_API_URL=http://103.88.122.23:3001
```
`backend/.env` (app secrets) — start from the dev one but **override** these for the box:
```
NODE_ENV=production
REDIS_URL=redis://redis:6379
# DATABASE_URL is overridden by compose (points at the db service) — value here is ignored
FRONTEND_URL=http://103.88.122.23:3002
FRONTEND_URLS=http://103.88.122.23:3002,http://103.88.122.23:3000
PUBLIC_REVALIDATE_URL=http://public:3002
REVALIDATE_TOKEN=<same token as frontend-public uses>
ADMIN_EMAIL=...        # seeded super-admin login
ADMIN_PASSWORD=...
ACCESS_TOKEN_SECRET=...   REFRESH_TOKEN_SECRET=...   BETTER_AUTH_SECRET=...
# AWS SES / Google OAuth / Sentry are optional — leave dev values or blanks;
# email + Google login just won't work, the CMS otherwise runs fine.
```
`frontend-public/.env` isn't used by the container (env comes from compose), but keep
`REVALIDATE_TOKEN` matching the backend's.

### 3. Run the deploy
```bash
sudo bash deploy/deploy.sh
```
It sets up swap + Docker + firewall, then builds and starts everything. First build
is slow (~10–20 min on 4 GB; swap prevents OOM).

### 4. Verify
```
http://103.88.122.23:3002/vi     # public site
http://103.88.122.23:3000        # admin (login with ADMIN_EMAIL/PASSWORD)
http://103.88.122.23:3001/page-layouts/slug/trang-chu   # API
```

## ⚠️ Known risk — the `public` image build

`frontend-public` imports `frontend/src` (via the `@admin` alias), so its image is
built from the **repo root** (`frontend-public/Dockerfile`, `context: .`) with a full
pnpm workspace install. I could **not** test this build (no server access). If it fails:

- **Missing module** from a `frontend/src` component → add it to `frontend-public/package.json` and rebuild.
- **Standalone entry path** — for a monorepo, Next may emit the server at a different
  relative path. Check with:
  `docker compose -f docker-compose.sandbox.yml run --rm public sh -c "ls -R /app | grep server.js"`
  and adjust the `CMD` in `frontend-public/Dockerfile`.
- **Fallback**: deploy `backend` + `admin` first (proven Dockerfiles) —
  `docker compose -f docker-compose.sandbox.yml up -d db redis backend admin` — then iterate on `public`.
- Consider **building the `public` image on your local machine** (more RAM), then
  `docker save | ssh … docker load` to avoid slow/OOM builds on the box.

## Troubleshooting (CentOS 7 specifics)

- **yum can't find packages**: EOL mirrors. `deploy.sh` repoints to `vault.centos.org`;
  if a repo still fails, disable it: `yum-config-manager --disable <repo>`.
- **Docker won't install**: newest `docker-ce` may drop CentOS 7. Pin the last supported:
  `yum install -y docker-ce-24.0.9 docker-ce-cli-24.0.9 containerd.io docker-compose-plugin`.
- **SELinux denies volume/.env reads**: CentOS 7 defaults to enforcing. Either
  `sudo setenforce 0` (temporary) or add `:Z` to bind mounts. The prod compose uses
  named volumes + build-time copies, so this mainly affects any `.env` bind mounts you add.
- **Build OOM (Killed)**: confirm swap is on (`swapon --show`); build one image at a time:
  `docker compose -f docker-compose.sandbox.yml build backend && … admin && … public`.
- **Ports blocked**: open in firewalld (deploy.sh does) **and** in the cloud/provider
  security group. Ask cô if inbound 3000–3002 are allowed.
- **CORS errors in the browser**: `FRONTEND_URLS` in `backend/.env` must list the
  public + admin origins.

## Optional — front with nginx (expose only :80)
Put nginx in front so users hit `http://103.88.122.23/` (proxy `/` → public:3002,
`/admin` → admin:3000, `/api` → backend:3001). Not required for a sandbox demo.
