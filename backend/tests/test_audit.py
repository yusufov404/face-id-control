"""Audit log tests: append-only trail, filters, permissions, export."""
from datetime import date

from app.core.permissions import Role

API = "/api/v1"


async def _seed_actions(client, headers):
    await client.post(f"{API}/departments", headers=headers,
                      json={"name": "Audit bo'lim", "code": "AUD-D"})
    await client.post(f"{API}/employees", headers=headers, json={
        "internal_id": "AUD-1", "first_name": "Ali", "last_name": "Valiyev",
        "hire_date": "2024-01-01",
    })


async def test_audit_records_mutations(client, make_user):
    _, headers = await make_user(Role.HR_DIRECTOR)
    await _seed_actions(client, headers)

    r = await client.get(f"{API}/audit", headers=headers)
    assert r.status_code == 200
    body = r.json()
    actions = {item["action"] for item in body["items"]}
    assert "department.create" in actions
    assert "employee.create" in actions
    for item in body["items"]:
        assert item["user_name"]

    r = await client.get(f"{API}/audit", headers=headers,
                         params={"action": "employee.create"})
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["resource_type"] == "employee"

    r = await client.get(f"{API}/audit", headers=headers,
                         params={"resource_type": "department"})
    assert r.json()["total"] == 1

    r = await client.get(f"{API}/audit", headers=headers,
                         params={"search": "Xodim yaratildi"})
    assert r.json()["total"] == 1


async def test_audit_date_filter(client, make_user):
    from datetime import timedelta

    _, headers = await make_user(Role.HR_DIRECTOR)
    await _seed_actions(client, headers)

    today = date.today()
    r = await client.get(f"{API}/audit", headers=headers, params={
        "date_from": (today - timedelta(days=1)).isoformat(),
        "date_to": (today + timedelta(days=1)).isoformat(),
    })
    assert r.json()["total"] >= 2

    r = await client.get(f"{API}/audit", headers=headers,
                         params={"date_from": "2000-01-01", "date_to": "2000-01-02"})
    assert r.json()["total"] == 0


async def test_audit_detail_contains_old_and_new_values(client, make_user):
    _, headers = await make_user(Role.HR_DIRECTOR)
    await _seed_actions(client, headers)

    listing = (await client.get(f"{API}/audit", headers=headers,
                                params={"action": "employee.create"})).json()
    log_id = listing["items"][0]["id"]

    r = await client.get(f"{API}/audit/{log_id}", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["action"] == "employee.create"
    assert body["new_values"]["internal_id"] == "AUD-1"
    assert body["success"] is True
    assert body["changed_fields"]

    r = await client.get(f"{API}/audit/999999", headers=headers)
    assert r.status_code == 404


async def test_audit_requires_audit_read(client, make_user):
    for role in (Role.CHIEF_PHYSICIAN, Role.DEPARTMENT_HEAD, Role.AUDITOR):
        _, headers = await make_user(role)
        r = await client.get(f"{API}/audit", headers=headers)
        assert r.status_code == 403, role


async def test_audit_export_is_excel(client, make_user):
    _, headers = await make_user(Role.HR_DIRECTOR)
    await _seed_actions(client, headers)

    r = await client.get(f"{API}/audit/export", headers=headers)
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers["content-type"]
    assert r.content[:2] == b"PK"          # xlsx is a zip archive
    assert len(r.content) > 1000


async def test_audit_export_requires_export_permission(client, make_user):
    _, headers = await make_user(Role.AUDITOR)
    r = await client.get(f"{API}/audit/export", headers=headers)
    assert r.status_code == 403


async def test_audit_survives_deleted_actor(client, db, make_user):
    """Deleting a user must not cascade-delete their audit history."""
    from sqlalchemy import select
    from app.models.audit import AuditLog

    super_admin, super_headers = await make_user(Role.SUPER_ADMIN)
    hr, hr_headers = await make_user(Role.HR_DIRECTOR)

    await client.post(f"{API}/departments", headers=hr_headers,
                      json={"name": "History", "code": "HIST"})
    await client.delete(f"{API}/users/{hr.id}", headers=super_headers)

    rows = (await db.execute(
        select(AuditLog).where(AuditLog.user_id == hr.id)
    )).scalars().all()
    assert len(rows) >= 1
    r = await client.get(f"{API}/audit", headers=super_headers)
    assert r.status_code == 200
    assert any(item["user_id"] == hr.id for item in r.json()["items"])
