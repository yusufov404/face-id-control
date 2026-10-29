"""Role-based access control: the matrix is enforced by the backend.

The effective permission set is always recomputed from the database on every
request; these tests exercise real HTTP calls, not the permission helpers.
"""
from app.core.permissions import ROLE_DEFINITIONS, Permission, Role

API = "/api/v1"
ALL_ROLES = [
    Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
    Role.DEPARTMENT_HEAD, Role.AUDITOR,
]


async def _users_for_all_roles(make_user, department_id):
    out = {}
    for role in ALL_ROLES:
        user, headers = await make_user(
            role,
            department_id=department_id if role == Role.DEPARTMENT_HEAD else None,
        )
        out[role] = headers
    return out


READ_MATRIX = [
    ("/departments", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                      Role.DEPARTMENT_HEAD, Role.AUDITOR}),
    ("/departments/options", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                              Role.DEPARTMENT_HEAD, Role.AUDITOR}),
    ("/positions", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                    Role.DEPARTMENT_HEAD}),
    ("/employees", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                    Role.DEPARTMENT_HEAD, Role.AUDITOR}),
    ("/users", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR}),
    ("/roles", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR}),
    ("/devices", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR}),
    ("/attendance", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                     Role.DEPARTMENT_HEAD, Role.AUDITOR}),
    ("/attendance/corrections/list", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN,
                                      Role.HR_DIRECTOR, Role.DEPARTMENT_HEAD, Role.AUDITOR}),
    ("/shifts", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                 Role.DEPARTMENT_HEAD}),
    ("/leaves", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                 Role.DEPARTMENT_HEAD}),
    ("/holidays", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                   Role.DEPARTMENT_HEAD}),
    ("/reports/attendance", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                             Role.DEPARTMENT_HEAD, Role.AUDITOR}),
    ("/reports/departments", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                              Role.DEPARTMENT_HEAD, Role.AUDITOR}),
    ("/dashboard/stats", {Role.SUPER_ADMIN, Role.CHIEF_PHYSICIAN, Role.HR_DIRECTOR,
                          Role.DEPARTMENT_HEAD}),
    ("/audit", {Role.SUPER_ADMIN, Role.HR_DIRECTOR}),
    ("/settings", {Role.SUPER_ADMIN}),
]


async def test_read_matrix(client, make_user, dept_factory):
    dept = await dept_factory("Terapiya", "THER")
    headers = await _users_for_all_roles(make_user, dept.id)

    failures = []
    for path, allowed in READ_MATRIX:
        for role, h in headers.items():
            r = await client.get(f"{API}{path}", headers=h)
            expect = 200 if role in allowed else 403
            if r.status_code != expect:
                failures.append(f"GET {path} as {role.value}: {r.status_code} != {expect} {r.text[:200]}")
    assert not failures, "\n".join(failures)


async def test_me_permission_sets_match_definitions(client, make_user, dept_factory):
    dept = await dept_factory("Laboratoriya", "LAB")
    headers = await _users_for_all_roles(make_user, dept.id)

    for role, h in headers.items():
        r = await client.get(f"{API}/auth/me", headers=h)
        assert r.status_code == 200
        actual = set(r.json()["permissions"])
        expected = {p.value for p in ROLE_DEFINITIONS[role].permissions}
        assert actual == expected, f"{role.value}: {actual ^ expected}"


async def test_superuser_flag_grants_everything(client, make_user):
    _, headers = await make_user(Role.AUDITOR, is_superuser=True)
    r = await client.get(f"{API}/settings", headers=headers)
    assert r.status_code == 200
    r = await client.get(f"{API}/audit", headers=headers)
    assert r.status_code == 200
    me = await client.get(f"{API}/auth/me", headers=headers)
    assert set(me.json()["permissions"]) == {p.value for p in Permission}


async def test_department_head_is_read_only(client, make_user, dept_factory):
    dept = await dept_factory("Nevrologiya", "NEURO")
    _, headers = await make_user(Role.DEPARTMENT_HEAD, department_id=dept.id)

    employee_payload = {
        "internal_id": "EMP-9001", "first_name": "Test", "last_name": "User",
        "hire_date": "2024-01-01", "department_id": dept.id,
    }
    r = await client.post(f"{API}/employees", headers=headers, json=employee_payload)
    assert r.status_code == 403

    r = await client.delete(f"{API}/employees/1", headers=headers)
    assert r.status_code == 403

    r = await client.post(f"{API}/departments", headers=headers,
                          json={"name": "Yangi", "code": "YANGI"})
    assert r.status_code == 403

    r = await client.post(f"{API}/attendance/corrections", headers=headers, json={
        "attendance_record_id": 1, "correction_type": "status", "field_name": "status",
        "new_value": "present", "reason": "test",
    })
    assert r.status_code == 403


async def test_auditor_cannot_perform_any_write(client, make_user, dept_factory):
    dept = await dept_factory("Audit bo'limi", "AUD")
    _, headers = await make_user(Role.AUDITOR, department_id=dept.id)

    calls = [
        ("post", "/departments", {"name": "X", "code": "X1"}),
        ("post", "/positions", {"name": "X", "code": "X1"}),
        ("post", "/employees", {
            "internal_id": "A-1", "first_name": "A", "last_name": "B",
            "hire_date": "2024-01-01",
        }),
        ("post", "/shifts", {
            "name": "X", "code": "X1", "start_time": "08:00", "end_time": "17:00",
        }),
        ("post", "/attendance/corrections", {
            "attendance_record_id": 1, "correction_type": "status",
            "field_name": "status", "new_value": "present", "reason": "test",
        }),
        ("post", "/devices", {
            "name": "Terminal", "serial_number": "SN-1", "ip_address": "192.0.2.1",
            "username": "admin", "password": "x",
        }),
        ("post", "/backups/none.dump/restore?confirm=true", None),
        ("patch", "/settings/org.name", {"value": "hacked"}),
    ]
    for method, path, payload in calls:
        r = await getattr(client, method)(f"{API}{path}", headers=headers, json=payload)
        assert r.status_code == 403, f"{method} {path} -> {r.status_code}: {r.text[:200]}"


async def test_chief_physician_is_read_only(client, make_user, dept_factory):
    dept = await dept_factory("Bosh shifokor bo'limi", "CHIEF")
    _, headers = await make_user(Role.CHIEF_PHYSICIAN, department_id=dept.id)

    r = await client.post(f"{API}/employees", headers=headers, json={
        "internal_id": "C-1", "first_name": "A", "last_name": "B",
        "hire_date": "2024-01-01",
    })
    assert r.status_code == 403

    r = await client.post(f"{API}/attendance/corrections", headers=headers, json={
        "attendance_record_id": 1, "correction_type": "status", "field_name": "status",
        "new_value": "present", "reason": "test",
    })
    assert r.status_code == 403


async def test_hr_can_manage_employees_but_not_super_admin(client, db, make_user,
                                                           dept_factory, seeded):
    dept = await dept_factory("Kadrlar bo'limi", "HR")
    hr, hr_headers = await make_user(Role.HR_DIRECTOR)

    # HR can create an employee
    r = await client.post(f"{API}/employees", headers=hr_headers, json={
        "internal_id": "HR-EMP-1", "first_name": "Ali", "last_name": "Valiyev",
        "hire_date": "2024-01-01", "department_id": dept.id,
    })
    assert r.status_code == 201, r.text

    # HR cannot assign the Super Admin role
    target, _ = await make_user(Role.AUDITOR)
    super_role_id = seeded["roles"][Role.SUPER_ADMIN.value].id
    r = await client.put(f"{API}/users/{target.id}/roles", headers=hr_headers,
                         json={"role_ids": [super_role_id]})
    assert r.status_code == 403

    # HR cannot grant roles at all (only Super Admin may)
    hr_role_id = seeded["roles"][Role.HR_DIRECTOR.value].id
    r = await client.put(f"{API}/users/{target.id}/roles", headers=hr_headers,
                         json={"role_ids": [hr_role_id]})
    assert r.status_code == 403

    # HR can still create an account, but only without roles
    r = await client.post(f"{API}/users", headers=hr_headers, json={
        "username": "hr.assistant",
        "password": "StrongPass123!",
        "full_name": "Kadr Yordamchisi",
        "role_ids": [hr_role_id],
    })
    assert r.status_code == 403

    r = await client.post(f"{API}/users", headers=hr_headers, json={
        "username": "hr.assistant",
        "password": "StrongPass123!",
        "full_name": "Kadr Yordamchisi",
    })
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["roles"] == []
    assert created["email"] == "hr.assistant@facesys.local"

    # HR cannot delete users
    r = await client.delete(f"{API}/users/{target.id}", headers=hr_headers)
    assert r.status_code == 403

    # HR cannot change settings
    r = await client.patch(f"{API}/settings/anything", headers=hr_headers, json={"value": 1})
    assert r.status_code == 403


async def test_hr_cannot_modify_system_roles(client, make_user, seeded):
    _, headers = await make_user(Role.HR_DIRECTOR)
    role_id = seeded["roles"][Role.AUDITOR.value].id

    r = await client.put(f"{API}/roles/{role_id}/permissions", headers=headers,
                         json={"permission_ids": []})
    assert r.status_code == 403


async def test_super_admin_can_modify_system_roles(client, make_user, seeded):
    _, headers = await make_user(Role.SUPER_ADMIN)
    role_id = seeded["roles"][Role.AUDITOR.value].id
    permission_id = seeded["permissions"][Permission.REPORT_VIEW.value].id

    r = await client.put(f"{API}/roles/{role_id}/permissions", headers=headers,
                         json={"permission_ids": [permission_id]})
    assert r.status_code == 200, r.text
    assert [p["name"] for p in r.json()] == [Permission.REPORT_VIEW.value]


async def test_user_email_is_optional(client, make_user, seeded):
    """A blank email must not fail: the API derives <username>@facesys.local."""
    _, headers = await make_user(Role.SUPER_ADMIN)
    hr_role_id = seeded["roles"][Role.HR_DIRECTOR.value].id

    r = await client.post(f"{API}/users", headers=headers, json={
        "username": "bolim.boshligi",
        "email": "",
        "password": "StrongPass123!",
        "full_name": "Bo'lim Boshlig'i",
        "role_ids": [hr_role_id],
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["email"] == "bolim.boshligi@facesys.local"
    assert [role["name"] for role in body["roles"]] == [Role.HR_DIRECTOR.value]


async def test_login_is_reusable_after_soft_delete(client, make_user):
    """Re-adding a removed person must not collide with the archived account."""
    _, headers = await make_user(Role.SUPER_ADMIN)
    payload = {
        "username": "reuse.login",
        "password": "StrongPass123!",
        "full_name": "Qayta Qo'shilgan",
    }

    created = await client.post(f"{API}/users", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    deleted = await client.delete(f"{API}/users/{created.json()['id']}", headers=headers)
    assert deleted.status_code == 200, deleted.text

    again = await client.post(f"{API}/users", headers=headers, json=payload)
    assert again.status_code == 201, again.text
    body = again.json()
    assert body["username"] == "reuse.login"
    assert body["email"] == "reuse.login@facesys.local"


async def test_internal_email_domain_is_accepted_on_create_and_update(client, make_user):
    """`*.facesys.local` is a reserved domain but must stay usable for accounts."""
    _, headers = await make_user(Role.SUPER_ADMIN)
    created = await client.post(f"{API}/users", headers=headers, json={
        "username": "head.internal",
        "email": "head.internal@facesys.local",
        "password": "StrongPass123!",
        "full_name": "Bo'lim Boshlig'i",
    })
    assert created.status_code == 201, created.text
    assert created.json()["email"] == "head.internal@facesys.local"

    # The edit form posts the stored address back — that must not be rejected.
    updated = await client.patch(f"{API}/users/{created.json()['id']}", headers=headers, json={
        "email": "head.internal@facesys.local",
        "full_name": "Bo'lim Boshlig'i 2",
    })
    assert updated.status_code == 200, updated.text
    assert updated.json()["email"] == "head.internal@facesys.local"


async def test_duplicate_user_returns_conflict_not_server_error(client, make_user):
    """A uniqueness hit must surface as 409, never as an opaque 500."""
    _, headers = await make_user(Role.SUPER_ADMIN)
    payload = {
        "username": "twin.login",
        "email": "twin.login@example.com",
        "password": "StrongPass123!",
        "full_name": "Birinchi Hisob",
    }
    first = await client.post(f"{API}/users", headers=headers, json=payload)
    assert first.status_code == 201, first.text

    second = await client.post(f"{API}/users", headers=headers, json=payload)
    assert second.status_code == 409, second.text
    assert "band" in second.json()["detail"]


async def test_unauthenticated_requests_are_rejected(client):
    for path in ("/employees", "/attendance", "/users", "/settings", "/audit"):
        r = await client.get(f"{API}{path}")
        assert r.status_code == 401, path
