import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, require_permission
from app.audit.service import AuditService
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import Permission
from app.models.settings import SystemSetting
from app.schemas.device import BackupInfo, SystemSettingRead, SystemSettingUpdate
from app.schemas.common import Message

router = APIRouter(prefix="/settings", tags=["settings"])
backup_router = APIRouter(prefix="/backups", tags=["backups"])
logger = logging.getLogger("facesys.backups")


@router.get("", response_model=list[SystemSettingRead])
async def list_settings(
    category: Optional[str] = None,
    ctx: AuthContext = Depends(require_permission(Permission.SETTINGS_READ)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SystemSetting).where(SystemSetting.is_deleted.is_(False))
    if category:
        stmt = stmt.where(SystemSetting.category == category)
    rows = (await db.execute(stmt.order_by(SystemSetting.category, SystemSetting.key))).scalars().all()
    return [SystemSettingRead.model_validate(s) for s in rows]


@router.patch("/{key}", response_model=SystemSettingRead)
async def update_setting(
    key: str,
    payload: SystemSettingUpdate,
    ctx: AuthContext = Depends(require_permission(Permission.SETTINGS_UPDATE)),
    db: AsyncSession = Depends(get_db),
):
    s = (await db.execute(
        select(SystemSetting).where(SystemSetting.key == key, SystemSetting.is_deleted.is_(False))
    )).scalar_one_or_none()
    if s is None:
        raise HTTPException(status_code=404, detail="Sozlama topilmadi")
    if s.is_readonly:
        raise HTTPException(status_code=409, detail="Bu sozlama faqat o'qish uchun")
    old = s.value
    s.value = payload.value
    s.updated_by = ctx.user_id
    AuditService(db).record(
        action="settings.update", resource_type="system_setting", resource_id=s.id,
        user_id=ctx.user_id, old_values={"value": old}, new_values={"value": payload.value},
        description=f"Sozlama o'zgartirildi: {key}",
    )
    await db.commit()
    await db.refresh(s)
    return SystemSettingRead.model_validate(s)


def _backup_dirs() -> list[Path]:
    dirs = [Path(settings.BACKUP_DIR_SSD)]
    # Only expose the HDD location when the filesystem is actually mounted.
    # An unmounted mountpoint is just an empty directory on the system disk.
    if os.path.ismount(settings.BACKUP_HDD_MOUNT):
        dirs.append(Path(settings.BACKUP_DIR_HDD))
    return dirs


def _hdd_is_mounted() -> bool:
    return os.path.ismount(settings.BACKUP_HDD_MOUNT)


@backup_router.get("", response_model=list[BackupInfo])
async def list_backups(
    ctx: AuthContext = Depends(require_permission(Permission.SETTINGS_BACKUP)),
):
    out: list[BackupInfo] = []
    for d in _backup_dirs():
        if not d.exists():
            continue
        for f in sorted(d.glob("*.dump"), reverse=True)[:50]:
            st = f.stat()
            out.append(BackupInfo(
                filename=f.name,
                size_bytes=st.st_size,
                created_at=datetime.fromtimestamp(st.st_mtime, tz=timezone.utc),
                location=str(d),
            ))
    return out


@backup_router.post("", response_model=BackupInfo)
async def create_backup(
    ctx: AuthContext = Depends(require_permission(Permission.SETTINGS_BACKUP)),
    db: AsyncSession = Depends(get_db),
):
    ssd = Path(settings.BACKUP_DIR_SSD)
    ssd.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"facesys_{stamp}.dump"
    target = ssd / filename
    partial = ssd / f"{filename}.partial"

    env = os.environ.copy()
    env["PGPASSWORD"] = settings.DATABASE_PASSWORD
    cmd = [
        "pg_dump",
        "-h", settings.DATABASE_HOST,
        "-p", str(settings.DATABASE_PORT),
        "-U", settings.DATABASE_USER,
        "-Fc",
        "-f", str(partial),
        settings.DATABASE_NAME,
    ]
    try:
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=3600)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="pg_dump topilmadi. PostgreSQL client o'rnatilganini tekshiring.")
    if result.returncode != 0:
        partial.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Backup xatosi: {result.stderr[:500]}")
    partial.replace(target)

    # Mirror to the HDD only when the filesystem is actually mounted.
    hdd = Path(settings.BACKUP_DIR_HDD)
    if _hdd_is_mounted():
        try:
            hdd.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, hdd / filename)
        except OSError as exc:
            logger.warning("HDD backup copy failed (%s): %s", hdd, exc)
    else:
        logger.info(
            "HDD mount %s is not mounted; backup kept on SSD only",
            settings.BACKUP_HDD_MOUNT,
        )

    st = target.stat()
    AuditService(db).record(
        action="backup.create", resource_type="backup", resource_id=filename,
        user_id=ctx.user_id, description=f"Zaxira nusxa yaratildi: {filename}",
    )
    await db.commit()
    return BackupInfo(
        filename=filename, size_bytes=st.st_size,
        created_at=datetime.fromtimestamp(st.st_mtime, tz=timezone.utc),
        location=str(ssd),
    )


@backup_router.post("/{filename}/restore", response_model=Message)
async def restore_backup(
    filename: str,
    confirm: bool = Query(False),
    ctx: AuthContext = Depends(require_permission(Permission.SETTINGS_RESTORE)),
    db: AsyncSession = Depends(get_db),
):
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="Tiklash ma'lumotlarni almashtiradi. confirm=true bilan qayta yuboring.",
        )
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Fayl nomi yaroqsiz")
    candidates = [d / filename for d in _backup_dirs()]
    source = next((p for p in candidates if p.exists()), None)
    if source is None:
        raise HTTPException(status_code=404, detail="Backup fayl topilmadi")

    env = os.environ.copy()
    env["PGPASSWORD"] = settings.DATABASE_PASSWORD
    cmd = [
        "pg_restore",
        "-h", settings.DATABASE_HOST,
        "-p", str(settings.DATABASE_PORT),
        "-U", settings.DATABASE_USER,
        "--clean", "--if-exists", "--no-owner", "--no-privileges",
        "--single-transaction", "--exit-on-error",
        "-d", settings.DATABASE_NAME,
        str(source),
    ]
    # Record the attempt before touching the database: after a successful
    # restore the current connection pool may be invalidated. This entry can be
    # replaced by the restored dump, so also log to the system journal.
    logger.warning(
        "backup.restore requested by user_id=%s file=%s", ctx.user_id, filename
    )
    AuditService(db).record(
        action="backup.restore", resource_type="backup", resource_id=filename,
        user_id=ctx.user_id, description=f"Backup tiklash boshlandi: {filename}",
    )
    await db.commit()

    try:
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=3600)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="pg_restore topilmadi")
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=(
                "Restore xatosi (tranzaksiya qaytarildi): "
                f"{result.stderr[:500]}"
            ),
        )

    return Message(
        detail=(
            "Backup tiklandi. Xizmatni qayta ishga tushiring: "
            "sudo systemctl restart facesys"
        )
    )