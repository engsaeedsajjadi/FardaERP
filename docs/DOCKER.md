# FardaERP — Docker Production Stack (§26)

> **STATUS: IMPLEMENTED-BUT-UNVERIFIED (build/run = BLOCKED-ENV in this sandbox).**
> The compose file validates against the official `compose-spec` schema, and the
> entrypoint's config/wait phases were executed against the real Frappe v16 CLI
> (see §9 evidence). `docker build` / `docker compose up` have NOT been executed —
> this sandbox has no Docker daemon. Run the §7 MariaDB gate in any Docker-capable
> environment before calling the stack production-ready.

## 1) Architecture

| Service | Image (target) | Port | Role | Healthcheck |
|---|---|---|---|---|
| `mariadb` | `mariadb:10.6` | internal | DB (utf8mb4 cnf mounted) | `healthcheck.sh --connect --innodb_initialized` |
| `redis-cache` | `redis:7.4.1-alpine` | internal | cache (`allkeys-lru`, no persistence) | `redis-cli ping` |
| `redis-queue` | `redis:7.4.1-alpine` | internal | RQ jobs (`--appendonly yes`) | `redis-cli ping` |
| `backend` | `fardaerp:16.34.2` (final) | 8000 | gunicorn `frappe.app:application` (2 workers × 4 threads) | `curl /api/method/ping` |
| `workers` | `fardaerp:16.34.2` (final) | — | `bench worker --queue short,default,long` | `pgrep -f "bench worker"` |
| `scheduler` | `fardaerp:16.34.2` (final) | — | `bench schedule` | `pgrep -f "bench schedule"` |
| `websocket` | `fardaerp:16.34.2` (final) | 9000 | `node apps/frappe/socketio.js` | socket.io polling handshake |
| `frontend` | `fardaerp-frontend:16.34.2` (frontend) | **80:8080** | nginx: baked assets + `/files` from shared volume + proxy + socket.io upgrade | `wget /api/method/ping` |

Shared named volume `sites` is mounted at `/home/frappe/frappe-bench/sites` (backend,
workers, scheduler, websocket) and `/var/www/sites` (frontend, for `/files`).
Multi-site by Host header (`FRAPPE_SITE_NAME_HEADER=$host`).

## 2) Prerequisites

- Docker Engine 24+, Compose v2.24+ (healthcheck `depends_on` conditions).
- ≥ 4 GB RAM for the stack; 20 GB disk.
- Ports: 80 (or remap `ports:` in docker-compose.yml).

## 3) First deployment

```bash
cp .env.example .env          # FILL: SITE_NAME, DB_ROOT_PASSWORD, DB_PASSWORD
chmod 600 .env                # secrets never leave this file / the volume
docker compose build          # pins: ERPNext v16.34.2 · Frappe v16.33.1 · HRMS v16.18.1
docker compose up -d mariadb redis-cache redis-queue
docker compose up -d          # backend waits for healthy DB/redis (entrypoint)
```

Create the first site:

```bash
docker compose exec backend bash -lc \
  'bench new-site "$SITE_NAME" \
     --mariadb-root-password "$DB_ROOT_PASSWORD" \
     --db-password "$DB_PASSWORD" \
     --admin-password "CHANGE-ME-ADMIN" \
     --install-app erpnext --install-app hrms --no-devsite'
# farda_iran setup (fixtures, VAT settings, dashboards, custom fields) runs
# automatically in erpnext after_install/migrate hooks.
```

Then restart `frontend` so nginx serves the new Host, and verify:

```bash
docker compose restart frontend
curl -fsS http://localhost/api/method/ping          # -> "pong"
curl -fsS "http://localhost/api/method/farda_iran.api.search.search_party?q=test" # authed 403 for guest = OK
```

## 4) Migrations (version upgrades)

- Preferred (one-shot): `docker compose run --rm -e RUN_MIGRATIONS=1 backend` — entrypoint runs
  `bench --site $SITE_NAME migrate` + `clear-cache`, then exits.
- Manual: `docker compose exec backend bench --site "$SITE_NAME" migrate`.
- **Rule (runbook): always run `scripts/backup.sh` immediately before migrate** — see §6.

## 5) Rolling update of the app image

```bash
docker compose build backend frontend workers scheduler websocket
docker compose run --rm -e RUN_MIGRATIONS=1 backend   # migrate BEFORE switching
docker compose up -d                                   # swap containers in place
```

## 6) Backup / restore (§25 scripts inside the stack)

```bash
# nightly (host cron 02:30):
0 2 * * * cd /srv/fardaerp && docker compose exec -T \
  -e FARDA_BENCH_DIR=/home/frappe/frappe-bench \
  -e FARDA_VENV=/home/frappe/frappe-bench/env \
  backend bash apps/erpnext/scripts/backup.sh >> sites/logs/farda-backup.log 2>&1

# restore verification (same gate as docs/BACKUP-RESTORE.md §6):
docker compose exec \
  -e FARDA_BENCH_DIR=/home/frappe/frappe-bench \
  -e FARDA_VENV=/home/frappe/frappe-bench/env \
  -e FARDA_DB_ROOT_USER=root -e FARDA_DB_ROOT_PASS="$DB_ROOT_PASSWORD" \
  backend bash apps/erpnext/scripts/restore.sh <site> <db.sql.gz> <files.tar> <private.tar>
```

Notes:
- The image ships the real `file(1)` binary, so `restore.sh` skips its shim
  (`command -v file` guard) — same script, sandbox and Docker.
- Artifacts land in the `sites` volume at `sites/backups/<site>/<ts>/`; mount an
  off-volume directory (e.g. `- /srv/farda-backups:/home/frappe/frappe-bench/backups`)
  so backups survive volume recreation. Copy off-site regardless (RPO 24h).

## 7) MariaDB validation gate (BLOCKED-ENV here — run in any Docker-capable env)

Sandbox has no Docker daemon; PostgreSQL-16.2 was the runtime evidence for all
feature gates (documented deviation). The MariaDB production gate is:

| # | Check | PASS criterion |
|---|---|---|
| G-MDB-1 | `docker compose up -d` | all services healthy (`docker compose ps`) |
| G-MDB-2 | first site create + `--install-app` | `bench --site $SITE_NAME list-apps` = frappe, erpnext, hrms |
| G-MDB-3 | `RUN_MIGRATIONS=1` run | `bench --site $SITE_NAME migrate` exit 0, no SQL errors |
| G-MDB-4 | VAT invoice on MariaDB | SI with 10% VAT → GL rows identical to PostgreSQL run (§7 R8 asserts via `farda_iran/tests`) |
| G-MDB-5 | backup → restore into `verify.<site>` | restore.sh exits 0 + R13-style data identity checks |

Record results in docs/VERSIONS.md + this file (honest vocabulary only).

## 8) Pinning & provenance

- Build args: `FRAPPE_VERSION=v16.33.1`, `ERPNEXT_VERSION=v16.34.2`, `HRMS_VERSION=v16.18.1`,
  `BENCH_VERSION=5.31.0` (all in docker/Dockerfile; tags mirror docs/VERSIONS.md).
- Base images pinned by tag today — **upgrade to digest pins (`@sha256:…`) at deploy**
  after verifying in your registry mirror.
- Known pin conflict (verified): `frappe-bench==5.31.0` declares `click~=8.2.0` while
  Frappe v16.33.1 requires `click~=8.4.1`. The Dockerfile installs bench then re-pins
  `click==8.4.1` (verified working: bench loads frappe commands under 8.4).

## 9) In-sandbox validation evidence (no daemon)

- `docker-compose.yml` → **validates against official compose-spec schema**
  (compose-spec master `schema/compose-spec.json`, jsonschema check) with `.env`
  interpolation emulated; 8 services + 3 volumes.
- `docker/entrypoint.sh` config phase executed against the REAL bench CLI 5.31.0 +
  Frappe v16.33.1 on a fresh bench skeleton: `{}` bootstrap → 6 keys written exactly
  (strings without `-p`, ints with `-p`); `wait_tcp` proven against live PG/Redis.
- Two real bugs found & fixed by that execution: (1) `bench set-config -g` writes
  `./common_site_config.json` **relative to cwd** → must run from `sites/`; (2) it does
  **not create** the file → entrypoint bootstraps `{}`; (3) bench's
  `is_bench_directory()` needs `config/pids` + `logs` → entrypoint creates them.
- `bash -n` on all shell files; Dockerfile static checks (no `latest`, every `FROM`
  pinned, all context COPY paths exist).

## 10) Security notes

- Secrets only via `.env` (git-ignored) → container env; nothing baked into images.
- `DB_ROOT_PASSWORD` never placed in image layers or logs.
- Frontend container is the only one publishing a port; backend/redis/db are
  internal-network only.
- Run TLS termination on an upstream proxy (or extend the nginx template with certs).
- `.dockerignore` keeps tests/docs/CI residue out of the image; LICENSE ships.

## 2026-09-17 — Real-user run addendum (Windows/Docker Desktop) — fixed packaging bug + exact retry

First real `docker compose up` reached builder step 9/12 and exposed CORE-009 (`.dockerignore`
stripped `README.md` → flit ConfigError). Fixed via `!README.md`; `FRAPPE_SITE_NAME_HEADER`
now hard-defaults to `$$host` (warning-free on all compose versions; override via
`docker-compose.override.yml`). Both proven by pruned-context flit simulation (see CORE-CHANGES).

### Exact retry sequence (PowerShell)

```powershell
git pull origin arena/01a0a51f-fardaerp     # or re-download the branch zip
copy .env.example .env                      # if not already done — FILL SITE_NAME, DB_ROOT_PASSWORD, DB_PASSWORD
docker compose build                        # builds backend/workers/scheduler/websocket + frontend
docker compose up -d mariadb redis-cache redis-queue
docker compose up -d                        # entrypoint waits for DB/Redis, then starts all

# one-time site creation (the entrypoint does NOT create the site).
# SITE NAME = the hostname the browser will use: nginx resolves the site by
# Host header (FRAPPE_SITE_NAME_HEADER=$host). For plain local testing name
# it "localhost"; any other name needs a hosts-file entry or a
# FRAPPE_SITE_NAME_HEADER override in docker-compose.override.yml.
docker compose exec backend bench new-site localhost `
  --mariadb-root-password $env:DB_ROOT_PASSWORD `
  --admin-password admin123 --install-app erpnext --install-app hrms

# afterwards (or for upgrades):
docker compose down; $env:RUN_MIGRATIONS="1"; docker compose up -d   # RUN_MIGRATIONS needs SITE_NAME in .env
```

Then open `http://localhost` **if the site is named `localhost`** (see above — name must match
the browser hostname). Login `Administrator` / the admin password; setup wizard: Country=Iran,
Currency=IRR. Health probe: `curl http://localhost/api/method/health` (may 404 until the site
exists — probe the backend container directly for `/health`).

### Updating an existing local copy (stale/mixed state — Windows)

The download-zip flow can leave a MIXED folder (new .dockerignore + old Dockerfile —
seen live 2026-09-17). Before building, verify the tree matches the branch tip:

```powershell
cd D:\Downloads\FardaERP-arena-01a0a51f-fardaerp\FardaERP-arena-01a0a51f-fardaerp

# A) git checkout? → update in place
Test-Path .git          # True/False
# if True:
git fetch origin arena/01a0a51f-fardaerp
git status --short                                   # local edits? stash if you need them
git checkout origin/arena/01a0a51f-fardaerp -- docker docker-compose.yml .dockerignore docs README.md

# B) zip extract (Test-Path .git = False)? → re-download fresh zip into a NEW folder
#    https://github.com/engsaeedsajjadi/FardaERP/archive/refs/heads/arena/01a0a51f-fardaerp.zip
#    then copy your filled .env into it.

# self-check BEFORE building (must match):
Select-String -Path docker\Dockerfile -Pattern "corepack"                       # → EMPTY (no output)
Select-String -Path docker\Dockerfile -Pattern "npm install -g --silent yarn"   # → 1 hit (yarn fix)
Select-String -Path .dockerignore  -Pattern "!README.md"                         # → 1 hit
```
