"""Employee lifecycle tests: IDs, duplicates, status, soft delete, filters."""
from datetime import date

from sqlalchemy import select

from app.core.permissions import Role
from app.models.attendance import AttendanceRecord, AttendanceStatus
from app.models.employee import Employee, EmploymentStatus

API = "/api/v1"


def _payload(internal_id="EMP-001", device_user_id="5001", **overrides):
    data = {
        "internal_id": internal_id,
        "device_user_id": device_user_id,
        "first_name": "Ali",
        "last_name": "Valiyev",
        "middle_name": "Akmalovich",
        "hire_date": "2024-01-01",
        "status": "active",
    }
    data.update(overrides)
    return data


async def test_create_employee_keeps_internal_and_device_ids_separate(
    client, db, make_user, dept_factory
):
    dept = await dept_factory("Kardiologiya", "CARD")
    _, headers = await make_user(Role.HR_DIRECTOR)

    r = await client.post(f"{API}/employees", headers=headers,
                          json=_payload(department_id=dept.id))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["internal_id"] == "EMP-001"
    assert body["device_user_id"] == "5001"
    assert body["department_name"] == "Kardiologiya"
    assert body["full_name"] == "Valiyev Ali Akmalovich"

    emp = await db.get(Employee, body["id"])
    assert emp.internal_id != emp.device_user_id


async def test_duplicate_ids_rejected(client, make_user):
    _, headers = await make_user(Role.HR_DIRECTOR)
    assert (await client.post(f"{API}/employees", headers=headers,
                              json=_payload())).status_code == 201

    r = await client.post(f"{API}/employees", headers=headers,
                          json=_payload(device_user_id="5002"))
    assert r.status_code == 409

    r = await client.post(f"{API}/employees", headers=headers,
                          json=_payload(internal_id="EMP-002"))
    assert r.status_code == 409


async def test_termination_date_cannot_precede_hire_date(client, make_user):
    _, headers = await make_user(Role.HR_DIRECTOR)
    r = await client.post(f"{API}/employees", headers=headers,
                          json=_payload(hire_date="2024-01-01",
                                        termination_date="2023-01-01"))
    assert r.status_code == 422


async def test_update_and_change_status(client, db, make_user):
    _, headers = await make_user(Role.HR_DIRECTOR)
    created = (await client.post(f"{API}/employees", headers=headers,
                                 json=_payload())).json()

    r = await client.patch(f"{API}/employees/{created['id']}", headers=headers,
                           json={"phone": "+998901234567", "notes": "Test"})
    assert r.status_code == 200
    assert r.json()["phone"] == "+998901234567"

    r = await client.post(f"{API}/employees/{created['id']}/status", headers=headers,
                          json={"status": "terminated",
                                "termination_date": "2026-01-31",
                                "reason": "Shartnoma tugadi"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "terminated"
    assert body["termination_date"] == "2026-01-31"

    emp = await db.get(Employee, created["id"])
    assert emp.status == EmploymentStatus.TERMINATED


async def test_soft_delete_keeps_attendance_history(client, db, make_user,
                                                    employee_factory):
    _, headers = await make_user(Role.HR_DIRECTOR)
    emp = await employee_factory("EMP-DEL", device_user_id="5999")
    rec = AttendanceRecord(employee_id=emp.id, record_date=date(2026, 2, 10),
                           status=AttendanceStatus.PRESENT, work_minutes=500)
    db.add(rec)
    await db.flush()
    rec_id = rec.id

    r = await client.delete(f"{API}/employees/{emp.id}", headers=headers)
    assert r.status_code == 200

    await db.refresh(emp)
    assert emp.is_deleted is True
    assert emp.deleted_at is not None
    assert emp.status == EmploymentStatus.TERMINATED

    # Hidden from the list and direct lookup...
    r = await client.get(f"{API}/employees/{emp.id}", headers=headers)
    assert r.status_code == 404
    r = await client.get(f"{API}/employees", headers=headers)
    assert r.json()["total"] == 0

    # ...but the historical attendance record still exists.
    record = await db.get(AttendanceRecord, rec_id)
    assert record is not None
    assert record.is_deleted is False
    r = await client.get(f"{API}/attendance/{rec_id}", headers=headers)
    assert r.status_code == 200
    assert r.json()["work_minutes"] == 500


async def test_search_and_filters(client, make_user, employee_factory, dept_factory):
    _, headers = await make_user(Role.HR_DIRECTOR)
    dept_a = await dept_factory("A", "DEPT-A")
    dept_b = await dept_factory("B", "DEPT-B")
    await employee_factory("S-001", department_id=dept_a.id,
                           first_name="Dilshod", last_name="Karimov",
                           device_user_id="7001")
    await employee_factory("S-002", department_id=dept_b.id,
                           first_name="Malika", last_name="Yusupova",
                           device_user_id="7002")

    r = await client.get(f"{API}/employees", headers=headers, params={"search": "Karimov"})
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["internal_id"] == "S-001"

    r = await client.get(f"{API}/employees", headers=headers, params={"search": "7002"})
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["internal_id"] == "S-002"

    r = await client.get(f"{API}/employees", headers=headers,
                         params={"department_id": dept_a.id})
    assert r.json()["total"] == 1

    r = await client.get(f"{API}/employees", headers=headers, params={"status": "terminated"})
    assert r.json()["total"] == 0

    r = await client.get(f"{API}/employees", headers=headers, params={"status": "nonsense"})
    assert r.status_code == 400


async def test_audit_trail_for_employee_mutations(client, db, make_user):
    from app.models.audit import AuditLog

    _, headers = await make_user(Role.HR_DIRECTOR)
    created = (await client.post(f"{API}/employees", headers=headers,
                                 json=_payload())).json()
    await client.patch(f"{API}/employees/{created['id']}", headers=headers,
                       json={"phone": "+998900000000"})
    await client.delete(f"{API}/employees/{created['id']}", headers=headers)

    actions = (await db.execute(
        select(AuditLog.action).where(AuditLog.resource_type == "employee").order_by(AuditLog.id)
    )).scalars().all()
    assert actions == ["employee.create", "employee.update", "employee.delete"]


async def test_employee_create_requires_permission(client, make_user):
    _, headers = await make_user(Role.DEPARTMENT_HEAD)
    r = await client.post(f"{API}/employees", headers=headers, json=_payload())
    assert r.status_code == 403
