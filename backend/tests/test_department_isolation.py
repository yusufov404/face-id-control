"""Department isolation is enforced server-side.

A department head (or any user whose role does not grant all-department access)
must not be able to read or write records belonging to another department.
Out-of-scope object access returns 404 (not 403) to avoid ID enumeration.
"""
from app.core.permissions import Role

API = "/api/v1"


async def _fixture_data(dept_factory, employee_factory):
    dept_a = await dept_factory("Kardiologiya", "CARD")
    dept_b = await dept_factory("Nevrologiya", "NEURO")
    emp_a = await employee_factory("EMP-A1", department_id=dept_a.id, first_name="Ali")
    emp_b = await employee_factory("EMP-B1", department_id=dept_b.id, first_name="Bek")
    return dept_a, dept_b, emp_a, emp_b


async def test_head_lists_only_own_department(client, make_user, dept_factory,
                                              employee_factory):
    dept_a, dept_b, _, _ = await _fixture_data(dept_factory, employee_factory)
    _, headers = await make_user(Role.DEPARTMENT_HEAD, department_id=dept_a.id)

    r = await client.get(f"{API}/employees", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["department_id"] == dept_a.id

    # Asking for another department explicitly is ignored, not honoured.
    r = await client.get(f"{API}/employees", headers=headers,
                         params={"department_id": dept_b.id})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["department_id"] == dept_a.id


async def test_head_cannot_read_other_department_employee(client, make_user,
                                                          dept_factory, employee_factory):
    dept_a, _, emp_a, emp_b = await _fixture_data(dept_factory, employee_factory)
    _, headers = await make_user(Role.DEPARTMENT_HEAD, department_id=dept_a.id)

    r = await client.get(f"{API}/employees/{emp_a.id}", headers=headers)
    assert r.status_code == 200

    r = await client.get(f"{API}/employees/{emp_b.id}", headers=headers)
    assert r.status_code == 404


async def test_head_cannot_read_other_department(client, make_user, dept_factory):
    dept_a, dept_b = (await dept_factory("A bo'lim", "DA"),
                      await dept_factory("B bo'lim", "DB"))
    _, headers = await make_user(Role.DEPARTMENT_HEAD, department_id=dept_a.id)

    r = await client.get(f"{API}/departments", headers=headers)
    assert r.status_code == 200
    assert [d["id"] for d in r.json()["items"]] == [dept_a.id]

    r = await client.get(f"{API}/departments/options", headers=headers)
    assert r.status_code == 200
    assert [d["id"] for d in r.json()] == [dept_a.id]

    r = await client.get(f"{API}/departments/{dept_b.id}", headers=headers)
    assert r.status_code == 404


async def test_head_cannot_update_other_department_employee(
    client, db, seeded, make_user, dept_factory, employee_factory
):
    from app.core.permissions import Permission

    dept_a, _, _, emp_b = await _fixture_data(dept_factory, employee_factory)
    role = await _make_scoped_role(db, seeded, "scoped_editor", {
        Permission.EMPLOYEE_READ, Permission.EMPLOYEE_UPDATE,
    })
    user, headers = await make_user(None, department_id=dept_a.id)
    user.roles = [role]
    await db.flush()

    r = await client.patch(f"{API}/employees/{emp_b.id}", headers=headers,
                           json={"first_name": "Hacked"})
    assert r.status_code == 404


async def _make_scoped_role(db, seeded, name: str, permissions):
    """Create a non-system role without all-department access."""
    from app.models.user import Role as RoleModel

    role = RoleModel(
        name=name, display_name=name, is_system=False,
        can_access_all_departments=False, can_modify_attendance=True,
    )
    role.permissions = [seeded["permissions"][p.value] for p in permissions]
    db.add(role)
    await db.flush()
    return role


async def test_scoped_user_cannot_create_employee_in_other_department(
    client, db, seeded, make_user, dept_factory
):
    from app.core.permissions import Permission

    dept_a, dept_b = (await dept_factory("A bo'lim", "DA"),
                      await dept_factory("B bo'lim", "DB"))
    role = await _make_scoped_role(db, seeded, "scoped_hr", {
        Permission.EMPLOYEE_CREATE, Permission.EMPLOYEE_READ,
    })
    user, headers = await make_user(None, department_id=dept_a.id)
    user.roles = [role]
    await db.flush()

    r = await client.post(f"{API}/employees", headers=headers, json={
        "internal_id": "OUT-1", "first_name": "X", "last_name": "Y",
        "hire_date": "2024-01-01", "department_id": dept_b.id,
    })
    assert r.status_code == 403

    r = await client.post(f"{API}/employees", headers=headers, json={
        "internal_id": "IN-1", "first_name": "X", "last_name": "Y",
        "hire_date": "2024-01-01", "department_id": dept_a.id,
    })
    assert r.status_code == 201


async def test_attendance_is_scoped(client, make_user, dept_factory, employee_factory,
                                    db):
    from datetime import date
    from app.models.attendance import AttendanceRecord, AttendanceStatus

    dept_a, _, emp_a, emp_b = await _fixture_data(dept_factory, employee_factory)
    rec_a = AttendanceRecord(employee_id=emp_a.id, record_date=date(2026, 1, 5),
                             status=AttendanceStatus.PRESENT)
    rec_b = AttendanceRecord(employee_id=emp_b.id, record_date=date(2026, 1, 5),
                             status=AttendanceStatus.PRESENT)
    db.add_all([rec_a, rec_b])
    await db.flush()

    _, headers = await make_user(Role.DEPARTMENT_HEAD, department_id=dept_a.id)

    r = await client.get(f"{API}/attendance", headers=headers)
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["employee_id"] == emp_a.id

    # Filtering by the other department's employee must not leak it.
    r = await client.get(f"{API}/attendance", headers=headers,
                         params={"employee_id": emp_b.id})
    assert r.status_code == 200
    assert r.json()["total"] == 0

    r = await client.get(f"{API}/attendance/{rec_b.id}", headers=headers)
    assert r.status_code == 404

    r = await client.get(f"{API}/attendance/{rec_a.id}", headers=headers)
    assert r.status_code == 200


async def test_scoped_user_cannot_correct_other_department(
    client, db, seeded, make_user, dept_factory, employee_factory
):
    from datetime import date
    from app.core.permissions import Permission
    from app.models.attendance import AttendanceRecord, AttendanceStatus

    dept_a, _, emp_a, emp_b = await _fixture_data(dept_factory, employee_factory)
    rec_a = AttendanceRecord(employee_id=emp_a.id, record_date=date(2026, 1, 6),
                             status=AttendanceStatus.ABSENT)
    rec_b = AttendanceRecord(employee_id=emp_b.id, record_date=date(2026, 1, 6),
                             status=AttendanceStatus.ABSENT)
    db.add_all([rec_a, rec_b])
    await db.flush()

    role = await _make_scoped_role(db, seeded, "scoped_corrector", {
        Permission.ATTENDANCE_READ, Permission.ATTENDANCE_CORRECT,
    })
    user, headers = await make_user(None, department_id=dept_a.id)
    user.roles = [role]
    await db.flush()

    payload = {
        "correction_type": "status",
        "field_name": "status",
        "new_value": "present",
        "reason": "Scoped correction test",
    }
    r = await client.post(f"{API}/attendance/corrections", headers=headers,
                          json={**payload, "attendance_record_id": rec_b.id})
    assert r.status_code == 404

    r = await client.post(f"{API}/attendance/corrections", headers=headers,
                          json={**payload, "attendance_record_id": rec_a.id})
    assert r.status_code == 201, r.text


async def test_hr_director_sees_all_departments(client, make_user, dept_factory,
                                                employee_factory):
    dept_a, dept_b, emp_a, emp_b = await _fixture_data(dept_factory, employee_factory)
    _, headers = await make_user(Role.HR_DIRECTOR)

    r = await client.get(f"{API}/employees", headers=headers)
    assert r.status_code == 200
    assert r.json()["total"] == 2

    for emp in (emp_a, emp_b):
        r = await client.get(f"{API}/employees/{emp.id}", headers=headers)
        assert r.status_code == 200


async def test_department_head_cannot_list_users(client, make_user, dept_factory):
    dept = await dept_factory("Kardiologiya", "CARD")
    _, headers = await make_user(Role.DEPARTMENT_HEAD, department_id=dept.id)
    r = await client.get(f"{API}/users", headers=headers)
    assert r.status_code == 403


async def test_auditor_sees_all_departments_read_only(
    client, make_user, dept_factory, employee_factory
):
    """Auditors are read-only but not department-scoped (docs/RBAC.md)."""
    dept_a, _, _, _ = await _fixture_data(dept_factory, employee_factory)
    _, headers = await make_user(Role.AUDITOR, department_id=dept_a.id)

    r = await client.get(f"{API}/employees", headers=headers)
    assert r.status_code == 200
    assert r.json()["total"] == 2

    r = await client.post(f"{API}/employees", headers=headers, json={
        "internal_id": "AUD-1", "first_name": "X", "last_name": "Y",
        "hire_date": "2024-01-01", "department_id": dept_a.id,
    })
    assert r.status_code == 403
