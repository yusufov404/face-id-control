"""System settings and backup/restore endpoints.

Backup tests never call the real pg_dump/pg_restore: subprocess.run is
monkeypatched. The privilege and confirmation guards are still real.
"""
import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.permissions import Role

API = "/api/v1"


@pytest.fixture
async def system_settings(db):
    from app.models.settings import SystemSetting

    db.add_all([
        SystemSetting(key="org.name", value="Klinika №1", value_type="string",
                      category="organization", description="Tashkilot nomi",
                      is_public=True),
        SystemSetting(key="attendance.late_grace", value=15, value_type="integer",
                      category="attendance", description="Kechikishga tolerantlik"),
        SystemSetting(key="system.version", value="1.0.0", value_type="string",
                      category="system", description="Versiya", is_readonly=True),
    ])
    await db.flush()


@pytest.fixture
def clean_backup_dirs():
    ssd = Path(settings.BACKUP_DIR_SSD)
    hdd = Path(settings.BACKUP_DIR_HDD)
    for d in (ssd, hdd):
        shutil.rmtree(d, ignore_errors=True)
    yield ssd, hdd
    for d in (ssd, hdd):
        shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def fake_postgres(monkeypatch):
    """Replace subprocess.run with a fake that writes a dump file."""
    import app.api.settings as settings_api

    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        if cmd[0] == "pg_dump":
            target = Path(cmd[cmd.index("-f") + 1])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"FAKE-CUSTOM-FORMAT-DUMP" * 100)
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(settings_api.subprocess, "run", fake_run)
    return calls


async def test_settings_list_and_permissions(client, make_user, system_settings):
    _, super_headers = await make_user(Role.SUPER_ADMIN)
    r = await client.get(f"{API}/settings", headers=super_headers)
    assert r.status_code == 200
    keys = {s["key"] for s in r.json()}
    assert keys == {"org.name", "attendance.late_grace", "system.version"}

    for role in (Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                 Role.DEPARTMENT_HEAD, Role.AUDITOR):
        _, headers = await make_user(role)
        r = await client.get(f"{API}/settings", headers=headers)
        assert r.status_code == 403, role


async def test_update_setting_and_audit(client, db, make_user, system_settings):
    from app.models.audit import AuditLog

    super_admin, headers = await make_user(Role.SUPER_ADMIN)

    r = await client.patch(f"{API}/settings/org.name", headers=headers,
                           json={"value": "Yangi klinika"})
    assert r.status_code == 200, r.text
    assert r.json()["value"] == "Yangi klinika"

    r = await client.patch(f"{API}/settings/attendance.late_grace", headers=headers,
                           json={"value": 20})
    assert r.status_code == 200
    assert r.json()["value"] == 20

    rows = (await db.execute(
        select(AuditLog).where(AuditLog.action == "settings.update").order_by(AuditLog.id)
    )).scalars().all()
    assert len(rows) == 2
    assert rows[0].old_values["value"] == "Klinika №1"
    assert rows[0].new_values["value"] == "Yangi klinika"
    assert rows[0].user_id == super_admin.id


async def test_readonly_and_unknown_setting_rejected(client, make_user, system_settings):
    _, headers = await make_user(Role.SUPER_ADMIN)

    r = await client.patch(f"{API}/settings/system.version", headers=headers,
                           json={"value": "2.0.0"})
    assert r.status_code == 409

    r = await client.patch(f"{API}/settings/does.not.exist", headers=headers,
                           json={"value": "x"})
    assert r.status_code == 404


async def test_hr_cannot_update_settings(client, make_user, system_settings):
    _, headers = await make_user(Role.HR_DIRECTOR)
    r = await client.patch(f"{API}/settings/org.name", headers=headers,
                           json={"value": "HR hack"})
    assert r.status_code == 403


async def test_backup_list_is_empty_initially(client, make_user, clean_backup_dirs):
    _, headers = await make_user(Role.SUPER_ADMIN)
    r = await client.get(f"{API}/backups", headers=headers)
    assert r.status_code == 200
    assert r.json() == []


async def test_backup_permissions(client, make_user, clean_backup_dirs):
    for role in (Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                 Role.DEPARTMENT_HEAD, Role.AUDITOR):
        _, headers = await make_user(role)
        r = await client.get(f"{API}/backups", headers=headers)
        assert r.status_code == 403, role
        r = await client.post(f"{API}/backups", headers=headers)
        assert r.status_code == 403, role


async def test_create_backup_and_list(client, db, make_user, clean_backup_dirs,
                                      fake_postgres):
    from app.models.audit import AuditLog

    _, headers = await make_user(Role.SUPER_ADMIN)

    r = await client.post(f"{API}/backups", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["filename"].endswith(".dump")
    assert body["size_bytes"] > 0
    assert Path(body["location"]) == clean_backup_dirs[0]

    assert any(cmd[0] == "pg_dump" for cmd in fake_postgres)
    dump_cmd = next(cmd for cmd in fake_postgres if cmd[0] == "pg_dump")
    assert "-Fc" in dump_cmd

    r = await client.get(f"{API}/backups", headers=headers)
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["filename"] == body["filename"]

    logs = (await db.execute(
        select(AuditLog).where(AuditLog.action == "backup.create")
    )).scalars().all()
    assert len(logs) == 1


async def test_restore_requires_typed_confirmation(client, make_user,
                                                   clean_backup_dirs):
    _, headers = await make_user(Role.SUPER_ADMIN)
    r = await client.post(f"{API}/backups/whatever.dump/restore", headers=headers)
    assert r.status_code == 400
    assert "confirm" in r.json()["detail"]

    r = await client.post(f"{API}/backups/whatever.dump/restore?confirm=true",
                          headers=headers)
    assert r.status_code == 404


async def test_restore_rejects_path_traversal(client, make_user, clean_backup_dirs):
    _, headers = await make_user(Role.SUPER_ADMIN)
    for name in ("..%5Cevil.dump", "..%2Fevil.dump"):
        r = await client.post(f"{API}/backups/{name}/restore?confirm=true",
                              headers=headers)
        # Either rejected by routing or by the explicit filename guard.
        assert r.status_code in (400, 404), (name, r.status_code)


async def test_restore_executes_pg_restore_and_audits(client, db, make_user,
                                                      clean_backup_dirs,
                                                      fake_postgres):
    from app.models.audit import AuditLog

    ssd, _ = clean_backup_dirs
    ssd.mkdir(parents=True, exist_ok=True)
    (ssd / "facesys_20260101_020000.dump").write_bytes(b"dump-bytes")

    _, headers = await make_user(Role.SUPER_ADMIN)
    r = await client.post(
        f"{API}/backups/facesys_20260101_020000.dump/restore?confirm=true",
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert any(cmd[0] == "pg_restore" for cmd in fake_postgres)

    restore_cmd = next(cmd for cmd in fake_postgres if cmd[0] == "pg_restore")
    assert "--clean" in restore_cmd

    logs = (await db.execute(
        select(AuditLog).where(AuditLog.action == "backup.restore")
    )).scalars().all()
    assert len(logs) == 1
    assert logs[0].resource_id == "facesys_20260101_020000.dump"


async def test_backup_failure_is_reported(client, make_user, clean_backup_dirs,
                                          monkeypatch):
    import app.api.settings as settings_api

    def failing_run(cmd, **kwargs):
        return SimpleNamespace(returncode=1, stdout="", stderr="pg_dump: error")

    monkeypatch.setattr(settings_api.subprocess, "run", failing_run)
    _, headers = await make_user(Role.SUPER_ADMIN)

    r = await client.post(f"{API}/backups", headers=headers)
    assert r.status_code == 500
    assert "Backup xatosi" in r.json()["detail"]
