# FaceSys Enterprise — Installation & Operations (Kali Linux)

This guide installs FaceSys Enterprise on a **single Kali/Debian server** on the
clinic LAN. It covers the automated installer, the equivalent manual steps,
HTTPS, the backup disk, upgrades, auto-start verification and troubleshooting.

> **Honest scope note:** the application code, migration chain, React build and
> a Chromium UI smoke test were executed on Windows with Python 3.12, Node
> 24.20 and PostgreSQL 17.10 (86 backend tests passed; `alembic check` reports
> no drift; frontend typecheck/lint/build pass; login and the main pages load).
> The installer, systemd/Nginx setup, backup/restore drill and physical
> Hikvision integration have **not** been executed on a fresh Kali machine or
> real terminal. Every step below is the intended procedure; verify each stage
> on the real server before go-live.

---

## 1. Requirements

| Item | Minimum | Recommended |
|---|---|---|
| OS | Debian 12 / Kali 2024.x | Kali/Debian with systemd |
| CPU / RAM | 2 vCPU / 4 GB | 4 vCPU / 8 GB |
| Disk (system/SSD) | 40 GB | 100 GB SSD |
| Backup disk | — | 1–4 TB HDD mounted at `/mnt/backup_hdd` |
| Python | 3.10+ | 3.11+ |
| Node.js / npm | 20.19+ or 22.12+ / npm 10+ | Node 22 LTS |
| PostgreSQL | 14+ | 15/16 |
| Network | static LAN IP | static IP + internal DNS name |

The server must be able to reach each Hikvision terminal over TCP (default
port 80/443) and clients must reach the server over HTTP/HTTPS.

Sizing: ~1000 employees and 50 departments produce roughly 2000–4000 raw
events/day and 1000 daily attendance rows/day. One uvicorn worker is sufficient;
see “Scaling” for why you should not simply raise the worker count.

---

## 2. Quick install (recommended)

Copy the repository to the server (USB, `scp`, or `git clone`), then:

```bash
cd facesys-enterprise
sudo ./deployment/install.sh
```

The installer:

1. installs PostgreSQL, Nginx, Python, Node.js/npm, build tools and the
   PostgreSQL client;
2. sets the server timezone to `Asia/Tashkent`;
3. creates the `facesys` system user and `/opt/facesys`;
4. copies the application, creates `/opt/facesys/venv` and builds the React SPA
   into `/opt/facesys/frontend/dist`;
5. generates `/etc/facesys/facesys.env` with random `SECRET_KEY`,
   `REFRESH_SECRET_KEY` and database password (mode `0640`, owner
   `root:facesys`);
6. creates the PostgreSQL role/database if missing;
7. runs `alembic upgrade head`;
8. seeds permissions, the five system roles, default settings and the first
   Super Admin (prompts for the password; minimum 10 characters);
9. creates backup directories, installs systemd units and the daily timer;
10. installs the Nginx site, enables and starts everything;
11. verifies `/health` directly and through Nginx, and confirms that
    auto-start is enabled.

Non-interactive example (useful for automation):

```bash
sudo FACESYS_ADMIN_PASSWORD='ChangeMe-12345' ./deployment/install.sh
```

Useful variables: `FACESYS_DB_PASSWORD`, `FACESYS_ADMIN_USERNAME`,
`FACESYS_DB_NAME`, `FACESYS_DB_USER`, `FACESYS_APP_DIR`, `FACESYS_SEED_ORG=1`
(adds 9 demo departments, positions and 3 shifts — **no attendance data**).

After installation:

* UI: `http://<server-ip>/`
* Health: `http://<server-ip>/health`
* Credentials: the admin username printed at the end (default `admin`)
* Change the password with the **👤 Profil / parol** button after first login.

If you re-run the installer, an existing env file and existing admin user are
preserved; secrets are not rotated.

---

## 3. Manual installation (if the script cannot be used)

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-dev build-essential libpq-dev \
    postgresql postgresql-contrib postgresql-client nginx curl rsync \
    nodejs npm

sudo timedatectl set-timezone Asia/Tashkent

# Service user and code
sudo useradd --system --create-home --home-dir /opt/facesys \
     --shell /usr/sbin/nologin facesys
sudo rsync -a --exclude '.git' --exclude '.env' --exclude 'venv' \
     ./ /opt/facesys/
sudo chown -R facesys:facesys /opt/facesys
sudo chmod 0755 /opt/facesys

# Python environment
sudo -u facesys python3 -m venv /opt/facesys/venv
sudo -u facesys /opt/facesys/venv/bin/pip install --upgrade pip wheel
sudo -u facesys /opt/facesys/venv/bin/pip install -r /opt/facesys/backend/requirements.txt

# React SPA build (Node.js 20.19+ or 22.12+)
sudo -u facesys -H bash -c 'cd /opt/facesys/frontend && npm ci && npm run build'
test -f /opt/facesys/frontend/dist/index.html || {
  echo "frontend build missing" >&2; exit 1; }
sudo rm -rf /opt/facesys/frontend/node_modules
sudo chmod -R a+rX /opt/facesys/frontend

# Configuration
sudo install -d -m 0750 -o root -g facesys /etc/facesys
sudo cp backend/.env.example /etc/facesys/facesys.env
sudo chown root:facesys /etc/facesys/facesys.env
sudo chmod 0640 /etc/facesys/facesys.env
sudo editor /etc/facesys/facesys.env   # set SECRET_KEY, REFRESH_SECRET_KEY,
                                       # DATABASE_*, BACKUP_DIR_*, WORKERS=1
```

Generate secrets with:

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(64))'
```

Database:

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE facesys LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
CREATE DATABASE facesys OWNER facesys;
SQL
```

Migrations and seed (run as the service user, with the env file loaded):

```bash
sudo -u facesys -H bash -c '
  set -a; . /etc/facesys/facesys.env; set +a
  cd /opt/facesys/database/migrations
  /opt/facesys/venv/bin/alembic upgrade head
'
sudo -u facesys -H bash -c '
  set -a; . /etc/facesys/facesys.env; set +a
  cd /opt/facesys
  SEED_ADMIN_PASSWORD="$(read -rsp "Admin password: " p; echo "$p")" \
  /opt/facesys/venv/bin/python database/seed/seed.py --admin-username admin
'
```

> Alembic must be run from `database/migrations`, because `alembic.ini` uses
> `script_location = .`.

Install the units and site (the installer does this for you):

```bash
sudo cp deployment/systemd/facesys*.service deployment/systemd/facesys-backup.timer \
     /etc/systemd/system/
sudo cp deployment/nginx/facesys.conf /etc/nginx/sites-available/facesys.conf
sudo ln -sfn /etc/nginx/sites-available/facesys.conf /etc/nginx/sites-enabled/facesys.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl daemon-reload
sudo systemctl enable --now facesys.service facesys-backup.timer nginx.service
sudo nginx -t && sudo systemctl restart nginx
```

If you use a non-default install dir, replace `/opt/facesys` inside the unit
files and the Nginx `root`/proxy paths (the installer does this automatically).

---

## 4. Configuration (`/etc/facesys/facesys.env`)

| Variable | Meaning |
|---|---|
| `SECRET_KEY`, `REFRESH_SECRET_KEY` | ≥ 32 chars each, different; rotate only with a planned re-login of all users |
| `DATABASE_*` | PostgreSQL connection; keep the password here, never in code |
| `WORKERS` | keep `1` (see Scaling) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | default 15 |
| `REFRESH_TOKEN_EXPIRE_DAYS` | default 7 |
| `LOGIN_RATE_LIMIT`, `LOGIN_RATE_LIMIT_WINDOW` | default 5 attempts / 300 s per IP |
| `BACKUP_DIR_SSD`, `BACKUP_DIR_HDD` | dump destinations |
| `BACKUP_RETENTION_DAYS_SSD/HDD` | default 7 / 90 |
| `BACKUP_HDD_MOUNT` | mountpoint checked by `backup.sh` (default `/mnt/backup_hdd`) |
| `SESSION_COOKIE_SECURE` | set `true` after HTTPS (auth itself uses bearer tokens) |
| `DEBUG` | keep `false`; `true` exposes `/api/docs` and verbose errors |

The app reads environment variables from the systemd unit; a local
`backend/.env` is only used for development. **Never commit a real `.env`.**

View logs:

```bash
journalctl -u facesys.service -f
journalctl -u facesys-backup.service -n 50 --no-pager
```

---

## 5. Nginx and HTTPS

The shipped site listens on port 80 and proxies `/api/` to
`127.0.0.1:8000`; the built React SPA is served from
`/opt/facesys/frontend/dist` with an `index.html` fallback for client-side
routes. It sets a strict Content-Security-Policy, `X-Frame-Options: DENY` and
disables `server_tokens`.

For HTTPS on a LAN, use an internal CA or a self-signed certificate (public CAs
cannot validate a private IP or `.local` name):

```bash
sudo mkdir -p /etc/nginx/tls
sudo openssl req -x509 -nodes -newkey rsa:3072 -days 825 \
  -keyout /etc/nginx/tls/facesys.key \
  -out /etc/nginx/tls/facesys.crt \
  -subj "/CN=facesys.clinic.local" \
  -addext "subjectAltName=DNS:facesys.clinic.local,IP:192.168.1.50"
sudo chmod 600 /etc/nginx/tls/facesys.key
```

Add to `/etc/nginx/sites-available/facesys.conf`:

```nginx
server {
    listen 80;
    server_name facesys.clinic.local 192.168.1.50;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name facesys.clinic.local 192.168.1.50;

    ssl_certificate     /etc/nginx/tls/facesys.crt;
    ssl_certificate_key /etc/nginx/tls/facesys.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    add_header Strict-Transport-Security "max-age=31536000" always;

    # … copy the root / location / API blocks from the shipped site …
}
```

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo sed -i 's/^SESSION_COOKIE_SECURE=.*/SESSION_COOKIE_SECURE=true/' /etc/facesys/facesys.env
sudo systemctl restart facesys
```

Distribute the internal CA certificate to clinic workstations. Do not expose
this service directly to the internet.

---

## 6. Backup disk (HDD)

The daily timer writes to the SSD first, then copies to the HDD **only when the
HDD mount is actually mounted**; otherwise the unit exits non-zero and keeps the
SSD copy.

Format and mount once (replace `/dev/sdb1` with the real device — double-check
with `lsblk`):

```bash
sudo apt install -y e2fsprogs
sudo mkfs.ext4 -L facesys-backup /dev/sdb1
sudo mkdir -p /mnt/backup_hdd
UUID=$(sudo blkid -s UUID -o value /dev/sdb1)
echo "UUID=$UUID /mnt/backup_hdd ext4 defaults,nofail,noatime 0 2" | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount -a
mountpoint -q /mnt/backup_hdd && echo "HDD mounted"
sudo install -d -m 0700 -o facesys -g facesys /mnt/backup_hdd/facesys
```

Test a backup immediately:

```bash
sudo systemctl start facesys-backup.service
systemctl status facesys-backup.service --no-pager
sudo ls -lh /srv/facesys/backups/ssd /mnt/backup_hdd/facesys
sudo -u facesys pg_restore --list /srv/facesys/backups/ssd/facesys_*.dump | head
```

Retention: 7 days on SSD, 90 days on HDD by default. Restore-test procedure:
`docs/SECURITY.md` §7.

The same backup can be started from **Sozlamalar → Zaxira nusxalar** in the UI
(permission `settings:backup`).

---

## 7. Auto-start verification

```bash
systemctl is-enabled facesys.service nginx.service postgresql.service
systemctl is-active  facesys.service nginx.service postgresql.service
systemctl list-timers facesys-backup.timer
curl -fsS http://127.0.0.1/health
```

Then reboot and repeat:

```bash
sudo reboot
# after the server is back:
systemctl is-active facesys nginx postgresql
curl -fsS http://127.0.0.1/health
journalctl -u facesys.service -b --no-pager | tail -n 30
```

Expected health payload:

```json
{"status":"ok","app":"FaceSys Enterprise","version":"1.0.0"}
```

---

## 8. Adding Hikvision terminals

1. Give the terminal a static IP and create a dedicated device user (read-only
   for event search is enough; the system never writes biometric data).
2. In **Qurilmalar → + Qurilma**, enter IP, port, username, password, model and
   department. The password is encrypted before storage.
3. Press **Diagnostika**. Check:
   * `reachable=true`;
   * `event_search_supported=true` — required for automatic attendance;
   * time drift under 120 seconds (fix NTP on the device if not);
   * `alert_stream_supported` is informational only in this version.
4. Map each employee's **device_user_id** to the number enrolled on the
   terminal (`Xodimlar` → edit). Internal IDs are independent.
5. Use **Sinxronlash** to ingest immediately, then check
   `Qurilmalar → Hodisalar` for raw events and `Davomat` for calculated days.

If `event_search_supported=false`, the integration honestly reports that this
firmware cannot be polled; attendance must then be entered via a manual
correction (audited) or the device must be updated/replaced.

---

## 9. Upgrade

```bash
# 1. Back up first
sudo systemctl start facesys-backup.service

# 2. Replace code (keep venv and env)
sudo rsync -a --delete --exclude 'venv/' --exclude '.env' \
     --exclude 'node_modules/' --exclude 'frontend-legacy/' \
     /path/to/new/facesys-enterprise/ /opt/facesys/
sudo chown -R facesys:facesys /opt/facesys
sudo chmod 0755 /opt/facesys

# 3. Dependencies, frontend build and schema
sudo -u facesys /opt/facesys/venv/bin/pip install -r /opt/facesys/backend/requirements.txt
sudo -u facesys -H bash -c 'cd /opt/facesys/frontend && npm ci && npm run build'
test -f /opt/facesys/frontend/dist/index.html
sudo rm -rf /opt/facesys/frontend/node_modules
sudo chmod -R a+rX /opt/facesys/frontend
sudo -u facesys -H bash -c '
  set -a; . /etc/facesys/facesys.env; set +a
  cd /opt/facesys/database/migrations
  /opt/facesys/venv/bin/alembic upgrade head
'

# 4. Restart and verify
sudo systemctl restart facesys
curl -fsS http://127.0.0.1/health
```

Rollback: restore the backup taken in step 1 with
`deployment/backup/restore.sh`, then redeploy the previous code version.

---

## 10. Scaling / multiple workers

Do **not** raise `--workers` in `facesys.service` while the poller runs inside
the app. Each worker starts its own `PollerRegistry`, so every device would be
polled N times. For 1000 employees a single async worker is enough. If you
later need more HTTP throughput:

1. move polling into a separate process/unit first (leader election or a
   dedicated poller service), then
2. raise the uvicorn worker count, and
3. replace the in-process login rate limiter with a shared store (Redis) if
   multiple workers are used.

All of the above is documented as a limitation, not implemented.

---

## 11. Running the test suite

Tests require a real PostgreSQL server and a database whose name contains
`test`:

```bash
sudo -u postgres createdb facesys_test
cd /opt/facesys/backend
TEST_DATABASE_NAME=facesys_test \
TEST_DATABASE_USER=postgres \
TEST_DATABASE_PASSWORD='postgres-password' \
/opt/facesys/venv/bin/pytest
```

The suite creates the schema with SQLAlchemy metadata and rolls every test back.
It refuses to run against a database whose name does not contain `test`.

Migration drift is checked separately (opt-in; creates and drops a throw-away
database):

```bash
RUN_MIGRATION_TEST=1 TEST_DATABASE_PASSWORD='…' \
  /opt/facesys/venv/bin/pytest tests/test_migrations.py
```

Verified in this repository on Windows/PostgreSQL 17.10: **87 passed, 1 skipped**, and
`alembic upgrade head && alembic check` reports *No new upgrade operations
detected*. The frontend checks also pass:

```bash
cd /opt/facesys/frontend
npm ci
npm run gen:api
npm run typecheck
npm run lint
npm run build
```

Re-run on the Kali host; installation, service startup, Nginx and the
backup/restore drill are still unverified there.

---

## 12. Troubleshooting

| Symptom | Check / fix |
|---|---|
| Nginx returns `502 Bad Gateway` | `systemctl status facesys`; `journalctl -u facesys -n 100`; confirm uvicorn is listening on `127.0.0.1:8000`. |
| `password authentication failed for user "facesys"` | `DATABASE_PASSWORD` in `/etc/facesys/facesys.env` differs from the role password. Re-run `ALTER ROLE facesys PASSWORD '…'`. |
| `alembic: command not found` | Use `/opt/facesys/venv/bin/alembic` and run from `database/migrations`. |
| Login returns `423` | Account locked after 10 failed attempts; wait 15 minutes or clear `users.locked_until` in the DB. |
| Login returns `429` | Login rate limit (5/5 min per IP); wait or adjust `LOGIN_RATE_LIMIT`. |
| UI loads without styles | `/opt/facesys` must be traversable by `www-data` (`0755`) and `frontend/dist` readable (`a+rX`). Re-run `npm run build` if `dist/` is stale. |
| Frontend build fails during install | Ensure Node.js 20.19+ or 22.12+ and npm are installed; the installer fails clearly instead of serving a missing/placeholder UI. |
| SPA route refreshes with `404` | Nginx must use `try_files $uri $uri/ /index.html;` and root `/opt/facesys/frontend/dist`. |
| Device: `reachable=false` | `ping`, check port 80/443, verify the device user/password, try `curl --digest -u user:pass http://DEVICE/ISAPI/System/deviceInfo`. |
| Device reachable but no events | `event_search_supported` may be false; device time drift > 2 min; `device_user_id` may not match the enrolled number. Check `Qurilmalar → Hodisalar`. |
| `facesys-backup.service` failed | HDD not mounted (`mountpoint -q /mnt/backup_hdd`); mount it and start the unit again. The SSD dump is kept. |
| Backup restore fails | Use `deployment/backup/restore.sh` (stops the service, `--single-transaction`), never restore over a running service. |
| Reports export empty | `EXPORT_MAX_ROWS` limit or no rows for the filters; check `report:export` permission. |

---

## 13. Uninstall

```bash
sudo systemctl disable --now facesys.service facesys-backup.timer nginx.service
sudo rm -f /etc/systemd/system/facesys*.service /etc/systemd/system/facesys-backup.timer
sudo rm -f /etc/nginx/sites-enabled/facesys.conf /etc/nginx/sites-available/facesys.conf
sudo systemctl daemon-reload
sudo rm -rf /opt/facesys
# Keep /etc/facesys/facesys.env and the backups until you have verified that
# the data is no longer needed. Dropping the database is irreversible:
# sudo -u postgres dropdb facesys
```
