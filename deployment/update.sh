#!/usr/bin/env bash
# FaceSys Enterprise — mavjud o'rnatishni yangilash.
#
# Ishlatish:  sudo bash /home/jdserver/facesys-deploy.sh
# (skript root huquqi bilan ishlaydi; baza va kod backup'i avtomatik olinadi)
set -euo pipefail

SRC="${SRC:-/home/jdserver/facesys-deploy}"
TARGET="${TARGET:-/opt/facesys}"
ENV_FILE="${ENV_FILE:-/etc/facesys/facesys.env}"
SERVICE="${SERVICE:-facesys.service}"
APP_USER="${APP_USER:-facesys}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8000/health}"
BK="/var/backups/facesys"
STAMP="$(date +%Y%m%d_%H%M%S)"

log() { printf '\n=== %s\n' "$*"; }
die() { printf '\n!!! XATO: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Bu skript root huquqi bilan ishlaydi"
[[ -d "$SRC/backend/app" ]] || die "Manba topilmadi: $SRC"
[[ -f "$ENV_FILE" ]] || die "Env fayl topilmadi: $ENV_FILE"

mkdir -p "$BK"

# ------------------------------------------------------------------ 1. backup
log "1/7 Baza backup"
set -a; . "$ENV_FILE"; set +a
DB_HOST="${DATABASE_HOST:-127.0.0.1}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_PASSWORD="${DATABASE_PASSWORD:-}"
[[ -n "$DB_PASSWORD" ]] || die "DATABASE_PASSWORD env faylda topilmadi"
export PGPASSWORD="$DB_PASSWORD"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DATABASE_USER" -Fc "$DATABASE_NAME" \
    -f "$BK/db_$STAMP.dump"
du -h "$BK/db_$STAMP.dump"

log "2/7 Kod backup"
tar czf "$BK/code_$STAMP.tgz" -C "$(dirname "$TARGET")" \
    "$(basename "$TARGET")/backend/app" \
    "$(basename "$TARGET")/database/migrations/versions" \
    "$(basename "$TARGET")/frontend/dist" \
    "$(basename "$TARGET")/docs"
du -h "$BK/code_$STAMP.tgz"

# ------------------------------------------------------------------ 2. migrate
log "3/7 Python paketlar"
"$TARGET/venv/bin/pip" install -q -r "$SRC/backend/requirements.txt"

log "4/7 Migratsiyalar"
runuser -u "$APP_USER" -- bash -c "
    set -a; . '$ENV_FILE'; set +a
    cd '$TARGET/database/migrations'
    '$TARGET/venv/bin/alembic' upgrade head
"

# ------------------------------------------------------------------ 3. files
log "5/7 Fayllarni almashtirish"
rsync -a --delete "$SRC/backend/app/" "$TARGET/backend/app/"
cp -f "$SRC/backend/requirements.txt" "$TARGET/backend/requirements.txt"
rsync -a --delete "$SRC/database/migrations/versions/" "$TARGET/database/migrations/versions/"
rsync -a "$SRC/frontend/src/" "$TARGET/frontend/src/"
cp -f "$SRC/frontend/package.json" "$SRC/frontend/package-lock.json" \
      "$SRC/frontend/openapi.json" "$TARGET/frontend/"
rm -rf "$TARGET/frontend/dist.new"
cp -a "$SRC/frontend/dist" "$TARGET/frontend/dist.new"
rm -rf "$TARGET/frontend/dist"
mv "$TARGET/frontend/dist.new" "$TARGET/frontend/dist"
rsync -a "$SRC/docs/" "$TARGET/docs/"
cp -f "$SRC/README.md" "$TARGET/README.md"
find "$TARGET/backend/app" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true

chown -R "$APP_USER:$APP_USER" \
    "$TARGET/backend/app" "$TARGET/backend/requirements.txt" \
    "$TARGET/database/migrations" "$TARGET/frontend/src" \
    "$TARGET/frontend/dist" "$TARGET/frontend/package.json" \
    "$TARGET/frontend/package-lock.json" "$TARGET/frontend/openapi.json" \
    "$TARGET/docs" "$TARGET/README.md"

# ------------------------------------------------------------------ 4. restart
log "6/7 Xizmatni qayta ishga tushirish"
systemctl restart "$SERVICE"
ok=0
for _ in $(seq 1 40); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
done
if [[ "$ok" -ne 1 ]]; then
    printf "\n!!! Xizmat ko'tarilmadi — kod backupdan qaytarilmoqda\n" >&2
    systemctl stop "$SERVICE" || true
    tar xzf "$BK/code_$STAMP.tgz" -C "$(dirname "$TARGET")"
    chown -R "$APP_USER:$APP_USER" "$TARGET/backend/app" "$TARGET/frontend/dist"
    systemctl start "$SERVICE"
    journalctl -u "$SERVICE" -n 40 --no-pager || true
    die "Yangilanish bekor qilindi. Baza backup: $BK/db_$STAMP.dump"
fi
curl -fsS "$HEALTH_URL"; echo

log "7/7 Nginx"
nginx -t
systemctl reload nginx

printf '\n=== TAYYOR\n'
printf 'Baza backup : %s\n' "$BK/db_$STAMP.dump"
printf 'Kod backup  : %s\n' "$BK/code_$STAMP.tgz"
printf 'Versiya     : %s\n' "$(cd "$TARGET/database/migrations" && "$TARGET/venv/bin/alembic" current 2>/dev/null | tail -1)"
