#!/usr/bin/env bash
# FaceSys Enterprise — PostgreSQL backup.
#
# Run by facesys-backup.service with EnvironmentFile=/etc/facesys/facesys.env.
# Writes a custom-format dump to the SSD directory, verifies that pg_restore can
# read it, copies it to the HDD only when the HDD mount is actually mounted and
# finally applies retention.
#
# Exit codes:
#   0  backup written and copied to HDD
#   1  backup written to SSD but HDD is not mounted (nothing is deleted on HDD)
#   2  pg_dump failed (the partial file is removed)
set -euo pipefail

: "${DATABASE_HOST:=localhost}"
: "${DATABASE_PORT:=5432}"
: "${DATABASE_NAME:=facesys}"
: "${DATABASE_USER:=facesys}"
: "${BACKUP_DIR_SSD:=/var/backups/facesys/ssd}"
: "${BACKUP_DIR_HDD:=/mnt/backup_hdd/facesys}"
: "${BACKUP_RETENTION_DAYS_SSD:=7}"
: "${BACKUP_RETENTION_DAYS_HDD:=90}"
: "${BACKUP_HDD_MOUNT:=/mnt/backup_hdd}"

umask 0077
timestamp="$(date -u +%Y%m%d_%H%M%S)"
name="facesys_${timestamp}.dump"
target="${BACKUP_DIR_SSD}/${name}"
partial="${target}.partial"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

cleanup() { rm -f "$partial"; }
trap cleanup EXIT

if [[ -z "${DATABASE_PASSWORD:-}" ]]; then
    log "ERROR: DATABASE_PASSWORD is not set (check /etc/facesys/facesys.env)"
    exit 2
fi
export PGPASSWORD="$DATABASE_PASSWORD"

mkdir -p "$BACKUP_DIR_SSD"

log "Starting backup: ${name}"
if ! pg_dump \
        --host="$DATABASE_HOST" \
        --port="$DATABASE_PORT" \
        --username="$DATABASE_USER" \
        --dbname="$DATABASE_NAME" \
        --format=custom --compress=6 \
        --no-owner --no-privileges \
        --file="$partial"; then
    log "ERROR: pg_dump failed"
    exit 2
fi

# A dump that pg_restore cannot list is useless: fail loudly instead of keeping it.
if ! pg_restore --list "$partial" >/dev/null; then
    log "ERROR: dump integrity check failed"
    exit 2
fi

mv "$partial" "$target"
chmod 0600 "$target"
log "SSD backup OK: ${target} ($(du -h "$target" | cut -f1))"

retention() {
    local dir="$1" days="$2"
    find "$dir" -maxdepth 1 -type f -name 'facesys_*.dump' -mtime "+${days}" -print -delete \
        | sed 's/^/  removed by retention: /'
}

if mountpoint -q "$BACKUP_HDD_MOUNT"; then
    mkdir -p "$BACKUP_DIR_HDD"
    cp --preserve=mode,timestamps "$target" "${BACKUP_DIR_HDD}/${name}"
    sync
    log "HDD backup OK: ${BACKUP_DIR_HDD}/${name}"
    retention "$BACKUP_DIR_HDD" "$BACKUP_RETENTION_DAYS_HDD"
else
    log "ERROR: ${BACKUP_HDD_MOUNT} is not a mounted filesystem."
    log "       SSD backup kept; HDD copy skipped. Mount the disk and re-run:"
    log "       systemctl start facesys-backup.service"
    retention "$BACKUP_DIR_SSD" "$BACKUP_RETENTION_DAYS_SSD"
    exit 1
fi

retention "$BACKUP_DIR_SSD" "$BACKUP_RETENTION_DAYS_SSD"
log "Backup finished"
