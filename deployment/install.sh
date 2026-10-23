#!/usr/bin/env bash
# FaceSys Enterprise — Kali Linux (Debian) installer.
#
# Usage (from the repository root):
#   sudo ./deployment/install.sh
#
# Optional non-interactive inputs:
#   FACESYS_DB_PASSWORD=...      PostgreSQL password for the app role
#   FACESYS_ADMIN_PASSWORD=...   Super Admin password (min 10 chars)
#   FACESYS_ADMIN_USERNAME=...   Super Admin username (default: admin)
#   FACESYS_DB_NAME=facesys      Database name
#   FACESYS_DB_USER=facesys      Database role
#   FACESYS_APP_DIR=/opt/facesys Install directory
#   FACESYS_SEED_ORG=1           Also create demo departments/positions/shifts
#
# The script is idempotent: re-running keeps an existing /etc/facesys/facesys.env
# and does not overwrite an existing admin user.
set -euo pipefail

APP_DIR="${FACESYS_APP_DIR:-/opt/facesys}"
APP_USER="facesys"
ETC_DIR="/etc/facesys"
ENV_FILE="${ETC_DIR}/facesys.env"
DB_NAME="${FACESYS_DB_NAME:-facesys}"
DB_USER="${FACESYS_DB_USER:-facesys}"
ADMIN_USERNAME="${FACESYS_ADMIN_USERNAME:-admin}"
BACKUP_SSD_DEFAULT="/srv/facesys/backups/ssd"
BACKUP_HDD_DEFAULT="/mnt/backup_hdd/facesys"
BACKUP_MOUNT_DEFAULT="/mnt/backup_hdd"

log()  { echo -e "\n\033[1;34m[facesys]\033[0m $*"; }
warn() { echo -e "\033[1;33m[facesys]\033[0m $*"; }
die()  { echo -e "\033[1;31m[facesys] ERROR:\033[0m $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root: sudo ./deployment/install.sh"
command -v apt-get >/dev/null || die "this installer targets Debian/Kali (apt-get not found)"

[[ "$DB_NAME" =~ ^[a-z_][a-z0-9_]*$ ]] || die "invalid FACESYS_DB_NAME"
[[ "$DB_USER" =~ ^[a-z_][a-z0-9_]*$ ]] || die "invalid FACESYS_DB_USER"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$SRC_DIR/backend/requirements.txt" ]] || die "repository layout not recognised"

# --------------------------------------------------------------------------- packages
log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
    python3 python3-venv python3-dev build-essential libpq-dev \
    postgresql postgresql-contrib postgresql-client \
    nginx curl rsync ca-certificates tzdata openssl nodejs npm

# The server and the clients must agree on Asia/Tashkent attendance dates.
if command -v timedatectl >/dev/null; then
    timedatectl set-timezone Asia/Tashkent || warn "could not set timezone to Asia/Tashkent"
fi

# --------------------------------------------------------------------------- user
if ! id -u "$APP_USER" >/dev/null 2>&1; then
    log "Creating system user '${APP_USER}'"
    useradd --system --create-home --home-dir "$APP_DIR" \
            --shell /usr/sbin/nologin "$APP_USER"
fi

as_app() { ( cd "$APP_DIR" && runuser -u "$APP_USER" -- env HOME="$APP_DIR" "$@" ); }
as_postgres() { ( cd / && runuser -u postgres -- "$@" ); }

# Escape a path for use as a sed replacement (used to support FACESYS_APP_DIR).
escape_sed() { printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'; }
APP_DIR_SED="$(escape_sed "$APP_DIR")"

# --------------------------------------------------------------------------- files
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
    log "Copying application to ${APP_DIR}"
    mkdir -p "$APP_DIR"
    rsync -a --delete \
        --exclude '.git/' \
        --exclude '.env' \
        --exclude 'venv/' \
        --exclude 'backend/.env' \
        --exclude '__pycache__/' \
        --exclude '.pytest_cache/' \
        --exclude '.ruff_cache/' \
        --exclude 'frontend/node_modules/' \
        --exclude 'frontend-legacy/' \
        "$SRC_DIR"/ "$APP_DIR"/
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
# Nginx (www-data) must traverse the install directory to serve the frontend.
# Secrets live in /etc/facesys, not here.
chmod 0755 "$APP_DIR"
chmod -R a+rX "$APP_DIR/frontend"

log "Creating Python virtual environment"
if [[ ! -x "$APP_DIR/venv/bin/python" ]]; then
    as_app python3 -m venv "$APP_DIR/venv"
fi
as_app "$APP_DIR/venv/bin/pip" install --upgrade pip wheel
as_app "$APP_DIR/venv/bin/pip" install -r "$APP_DIR/backend/requirements.txt"

# --------------------------------------------------------------------------- frontend
log "Building React frontend"
FRONTEND_DIR="$APP_DIR/frontend"
NODE_BUILD_OK=0
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    if node -e 'const [a,b]=process.versions.node.split(".").map(Number); const ok=(a===20&&b>=19)||(a>22)||(a===22&&b>=12); process.exit(ok?0:1)'; then
        NODE_BUILD_OK=1
    else
        warn "Node.js $(node -v) cannot build this frontend (need 20.19+ or 22.12+)"
    fi
fi
if [[ -f "$FRONTEND_DIR/package-lock.json" && "$NODE_BUILD_OK" == "1" ]]; then
    as_app bash -c "cd '$FRONTEND_DIR' && npm ci --no-audit --no-fund && npm run build"
elif [[ -f "$FRONTEND_DIR/dist/index.html" ]]; then
    warn "using the prebuilt frontend in ${FRONTEND_DIR}/dist"
else
    die "frontend/dist is missing and Node.js/npm cannot build it. Install Node.js 20.19+ or 22.12+ with npm, or build the frontend on another machine and copy frontend/dist here."
fi
[[ -f "$FRONTEND_DIR/dist/index.html" ]] || die "frontend build did not produce frontend/dist/index.html"
# Node is only needed at build time; the static SPA is served by Nginx.
rm -rf "$FRONTEND_DIR/node_modules"
chmod -R a+rX "$FRONTEND_DIR"

# --------------------------------------------------------------------------- env file
install -d -m 0750 -o root -g "$APP_USER" "$ETC_DIR"

if [[ -f "$ENV_FILE" ]]; then
    log "Keeping existing ${ENV_FILE}"
    # shellcheck disable=SC1090
    set -a; . "$ENV_FILE"; set +a
    DB_PASSWORD="${FACESYS_DB_PASSWORD:-${DATABASE_PASSWORD:-}}"
    [[ -n "$DB_PASSWORD" ]] || die "DATABASE_PASSWORD missing in ${ENV_FILE}"
else
    log "Generating ${ENV_FILE} with new secrets"
    DB_PASSWORD="${FACESYS_DB_PASSWORD:-$(openssl rand -hex 24)}"
    SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')"
    REFRESH_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')"

    umask 0027
    cat > "$ENV_FILE" <<EOF
# FaceSys Enterprise — server configuration. Keep this file private (0640).
# Generated by deployment/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ).

APP_NAME=FaceSys Enterprise
APP_VERSION=1.0.0
DEBUG=false
ENVIRONMENT=production
TIMEZONE=Asia/Tashkent

HOST=127.0.0.1
PORT=8000
# Keep 1: the Hikvision poller runs inside the app process (see docs/INSTALL.md).
WORKERS=1

DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=${DB_NAME}
DATABASE_USER=${DB_USER}
DATABASE_PASSWORD=${DB_PASSWORD}
DATABASE_POOL_SIZE=20
DATABASE_MAX_OVERFLOW=10
DATABASE_POOL_TIMEOUT=30

SECRET_KEY=${SECRET_KEY}
REFRESH_SECRET_KEY=${REFRESH_KEY}
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7
PASSWORD_HASH_ALGORITHM=argon2
BCRYPT_ROUNDS=12

SESSION_COOKIE_NAME=facesys_session
# Set true only after HTTPS is configured (docs/INSTALL.md).
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_HTTPONLY=true
SESSION_COOKIE_SAMESITE=lax

LOGIN_RATE_LIMIT=5
LOGIN_RATE_LIMIT_WINDOW=300
API_RATE_LIMIT=100
API_RATE_LIMIT_WINDOW=60

# Same-origin deployment behind Nginx; CORS is only needed for a separate dev UI.
CORS_ORIGINS='["http://localhost"]'
CORS_ALLOW_CREDENTIALS=true

HIKVISION_TIMEOUT=10
HIKVISION_RETRY_ATTEMPTS=3
HIKVISION_RETRY_DELAY=5
HIKVISION_SYNC_INTERVAL=300

BACKUP_DIR_SSD=${BACKUP_SSD_DEFAULT}
BACKUP_DIR_HDD=${BACKUP_HDD_DEFAULT}
BACKUP_RETENTION_DAYS_SSD=7
BACKUP_RETENTION_DAYS_HDD=90
BACKUP_HDD_MOUNT=${BACKUP_MOUNT_DEFAULT}

AUDIT_LOG_RETENTION_DAYS=365
DEFAULT_PAGE_SIZE=20
MAX_PAGE_SIZE=100
EXPORT_MAX_ROWS=10000
EOF
    chown root:"$APP_USER" "$ENV_FILE"
    chmod 0640 "$ENV_FILE"

    # shellcheck disable=SC1090
    set -a; . "$ENV_FILE"; set +a
fi

BACKUP_DIR_SSD="${BACKUP_DIR_SSD:-$BACKUP_SSD_DEFAULT}"
BACKUP_DIR_HDD="${BACKUP_DIR_HDD:-$BACKUP_HDD_DEFAULT}"
BACKUP_HDD_MOUNT="${BACKUP_HDD_MOUNT:-$BACKUP_MOUNT_DEFAULT}"

# --------------------------------------------------------------------------- database
log "Ensuring PostgreSQL is running"
systemctl enable --now postgresql.service
for _ in $(seq 1 30); do
    as_postgres pg_isready -q && break
    sleep 1
done
as_postgres pg_isready -q || die "PostgreSQL did not start"

log "Ensuring database role and database exist"
DB_PASSWORD_SQL="${DB_PASSWORD//\'/\'\'}"
as_postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
        CREATE ROLE "${DB_USER}" LOGIN PASSWORD '${DB_PASSWORD_SQL}';
    ELSE
        ALTER ROLE "${DB_USER}" WITH LOGIN PASSWORD '${DB_PASSWORD_SQL}';
    END IF;
END
\$\$;
SQL

if ! as_postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    as_postgres createdb -O "$DB_USER" "$DB_NAME"
    log "Created database ${DB_NAME}"
else
    log "Database ${DB_NAME} already exists"
fi

# --------------------------------------------------------------------------- migrations
log "Applying Alembic migrations"
as_app bash -c "
    set -a; . '$ENV_FILE'; set +a
    cd '$APP_DIR/database/migrations'
    '$APP_DIR/venv/bin/alembic' upgrade head
"

# --------------------------------------------------------------------------- admin
ADMIN_PASSWORD="${FACESYS_ADMIN_PASSWORD:-}"
if [[ -z "$ADMIN_PASSWORD" ]]; then
    if [[ -t 0 ]]; then
        read -rsp "Super Admin paroli (kamida 10 belgi): " ADMIN_PASSWORD; echo
        read -rsp "Parolni takrorlang: " ADMIN_PASSWORD2; echo
        [[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD2" ]] || die "passwords do not match"
    else
        die "FACESYS_ADMIN_PASSWORD is required when stdin is not a terminal"
    fi
fi
[[ ${#ADMIN_PASSWORD} -ge 10 ]] || die "Super Admin password must be at least 10 characters"

log "Seeding roles, permissions, settings and Super Admin '${ADMIN_USERNAME}'"
SEED_ARGS=""
[[ "${FACESYS_SEED_ORG:-0}" == "1" ]] && SEED_ARGS="--with-org"
export SEED_ADMIN_USERNAME="$ADMIN_USERNAME"
export SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD"
as_app bash -c "
    set -a; . '$ENV_FILE'; set +a
    cd '$APP_DIR'
    '$APP_DIR/venv/bin/python' database/seed/seed.py $SEED_ARGS
"
unset SEED_ADMIN_PASSWORD

# --------------------------------------------------------------------------- backups
log "Preparing backup directories"
install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$BACKUP_DIR_SSD"
if mountpoint -q "$BACKUP_HDD_MOUNT"; then
    install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$BACKUP_DIR_HDD"
    log "HDD mount detected at ${BACKUP_HDD_MOUNT}"
else
    warn "${BACKUP_HDD_MOUNT} is not mounted. Backups will be written to the SSD"
    warn "and the backup unit will report failure until the HDD is mounted."
fi
chmod 0755 "$APP_DIR/deployment/backup/backup.sh" "$APP_DIR/deployment/backup/restore.sh"

# --------------------------------------------------------------------------- systemd
log "Installing systemd units"
for unit in facesys.service facesys-backup.service facesys-backup.timer; do
    sed "s|/opt/facesys|${APP_DIR_SED}|g" \
        "$APP_DIR/deployment/systemd/$unit" > "/etc/systemd/system/$unit"
    chmod 0644 "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable facesys.service
systemctl enable --now facesys-backup.timer
systemctl restart facesys.service

# --------------------------------------------------------------------------- nginx
log "Configuring Nginx"
sed "s|/opt/facesys|${APP_DIR_SED}|g" \
    "$APP_DIR/deployment/nginx/facesys.conf" > /etc/nginx/sites-available/facesys.conf
chmod 0644 /etc/nginx/sites-available/facesys.conf
ln -sfn /etc/nginx/sites-available/facesys.conf /etc/nginx/sites-enabled/facesys.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

# --------------------------------------------------------------------------- verify
log "Waiting for the application to become healthy"
HEALTHY=0
for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then HEALTHY=1; break; fi
    sleep 1
done
if [[ $HEALTHY -ne 1 ]]; then
    systemctl status facesys.service --no-pager || true
    journalctl -u facesys.service -n 40 --no-pager || true
    die "application did not become healthy"
fi

systemctl is-enabled --quiet facesys.service || die "facesys.service is not enabled"
systemctl is-active --quiet facesys.service || die "facesys.service is not active"
curl -fsS http://127.0.0.1/health >/dev/null || die "Nginx cannot reach the application"
log "Auto-start is enabled and the health check passes through Nginx"

IP_ADDR="$(hostname -I | awk '{print $1}')"
cat <<SUMMARY

==========================================================================
 FaceSys Enterprise o'rnatildi.

   Manzil:        http://${IP_ADDR:-<server-ip>}/
   Admin login:   ${ADMIN_USERNAME}
   Sozlamalar:    ${ENV_FILE}   (root:${APP_USER}, 0640)
   Ilova:         ${APP_DIR}
   Zaxira (SSD):  ${BACKUP_DIR_SSD}
   Zaxira (HDD):  ${BACKUP_DIR_HDD}
   Backup timer:  systemctl list-timers facesys-backup.timer

 Keyingi qadamlar:
   1) Brauzerda kirib, "Profil / parol" tugmasi orqali parolni almashtiring.
   2) "Qurilmalar" bo'limida Hikvision terminalini qo'shing va "Diagnostika"
      tugmasini bosing. Faqat qurilma qo'llab-quvvatlaydigan funksiyalar
      yashil bo'ladi.
   3) HDD zaxira diskini mount qiling (${BACKUP_HDD_MOUNT}) va
      "sudo systemctl start facesys-backup.service" bilan sinab ko'ring.
   4) Tiklashni sinash tartibi: docs/SECURITY.md.
   5) Tarmoqdan tashqarida ishlatishdan oldin HTTPS sozlang: docs/INSTALL.md.

 Rebootdan keyin avtomatik ishga tushishini tekshirish:
   sudo reboot
   # rebootdan keyin:
   systemctl is-active facesys nginx postgresql
   curl -fsS http://127.0.0.1/health
==========================================================================
SUMMARY
