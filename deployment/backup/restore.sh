#!/usr/bin/env bash
# FaceSys Enterprise — manual database restore.
#
# Usage (as root):
#   /opt/facesys/deployment/backup/restore.sh /path/to/facesys_YYYYmmdd_HHMMSS.dump
#
# This REPLACES the current database contents. The service is stopped first and
# started again afterwards. Run through docs/SECURITY.md ("Tiklashni sinash")
# on a copy before relying on it in a real incident.
set -euo pipefail

ENV_FILE="${FACESYS_ENV_FILE:-/etc/facesys/facesys.env}"
APP_DIR="${FACESYS_APP_DIR:-/opt/facesys}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root (sudo)"
[[ $# -eq 1 ]] || die "usage: $0 /path/to/facesys_*.dump"
DUMP="$1"
[[ -f "$DUMP" ]] || die "file not found: $DUMP"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
: "${DATABASE_HOST:=localhost}"
: "${DATABASE_PORT:=5432}"
: "${DATABASE_NAME:=facesys}"
: "${DATABASE_USER:=facesys}"
export PGPASSWORD="${DATABASE_PASSWORD:?DATABASE_PASSWORD missing in $ENV_FILE}"

if ! pg_restore --list "$DUMP" >/dev/null; then
    die "pg_restore cannot read $DUMP"
fi

cat <<WARN
This will REPLACE the contents of database '${DATABASE_NAME}' on ${DATABASE_HOST}.
Dump: ${DUMP}
Type RESTORE to continue:
WARN
read -r answer
[[ "$answer" == "RESTORE" ]] || die "aborted"

log "Stopping facesys.service"
systemctl stop facesys.service

log "Restoring database"
if ! pg_restore \
        --host="$DATABASE_HOST" --port="$DATABASE_PORT" \
        --username="$DATABASE_USER" --dbname="$DATABASE_NAME" \
        --clean --if-exists --no-owner --no-privileges \
        --exit-on-error --single-transaction \
        "$DUMP"; then
    log "ERROR: pg_restore failed. The database may be partially restored."
    log "       Do NOT start the service until it has been checked."
    exit 1
fi

log "Applying migrations (in case the dump is older than the code)"
runuser -u facesys -- env HOME="$APP_DIR" bash -c "
    set -a; . '$ENV_FILE'; set +a
    cd '$APP_DIR/database/migrations' && '$APP_DIR/venv/bin/alembic' upgrade head
"

log "Starting facesys.service"
systemctl start facesys.service

for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
        log "Restore finished; service is healthy"
        exit 0
    fi
    sleep 1
done

die "service did not become healthy after restore — check: journalctl -u facesys -n 100"
