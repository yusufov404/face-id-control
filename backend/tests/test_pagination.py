"""Pagination and search behaviour (1000-employee scale contract)."""
import pytest

from app.core.permissions import Role

API = "/api/v1"


@pytest.fixture
async def many_employees(employee_factory, dept_factory):
    dept_a = await dept_factory("Bo'lim A", "PAGE-A")
    dept_b = await dept_factory("Bo'lim B", "PAGE-B")
    for i in range(55):
        await employee_factory(
            f"P-{i:03d}",
            department_id=dept_a.id if i % 2 == 0 else dept_b.id,
            device_user_id=f"9{i:03d}",
            first_name=f"Xodim{i:03d}",
            last_name=f"F{i:03d}",
        )
    return dept_a, dept_b


async def test_pages_are_stable_and_bounded(client, make_user, many_employees):
    _, headers = await make_user(Role.HR_DIRECTOR)

    r = await client.get(f"{API}/employees", headers=headers,
                         params={"page": 1, "page_size": 20})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 55
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert body["pages"] == 3
    assert len(body["items"]) == 20
    assert body["items"][0]["last_name"] == "F000"

    r = await client.get(f"{API}/employees", headers=headers,
                         params={"page": 2, "page_size": 20})
    assert r.json()["items"][0]["last_name"] == "F020"

    r = await client.get(f"{API}/employees", headers=headers,
                         params={"page": 3, "page_size": 20})
    assert len(r.json()["items"]) == 15

    r = await client.get(f"{API}/employees", headers=headers,
                         params={"page": 4, "page_size": 20})
    assert r.json()["items"] == []
    assert r.json()["total"] == 55


async def test_page_size_limits_are_enforced(client, make_user, many_employees):
    _, headers = await make_user(Role.HR_DIRECTOR)

    r = await client.get(f"{API}/employees", headers=headers,
                         params={"page_size": 101})
    assert r.status_code == 422

    r = await client.get(f"{API}/employees", headers=headers, params={"page": 0})
    assert r.status_code == 422

    r = await client.get(f"{API}/employees", headers=headers, params={"page": -5})
    assert r.status_code == 422


async def test_search_then_paginate(client, make_user, many_employees):
    _, headers = await make_user(Role.HR_DIRECTOR)

    r = await client.get(f"{API}/employees", headers=headers,
                         params={"search": "Xodim01", "page_size": 5})
    body = r.json()
    assert body["total"] == 10        # Xodim010 ... Xodim019
    assert body["pages"] == 2
    assert len(body["items"]) == 5


async def test_filter_by_department_then_paginate(client, make_user, many_employees):
    dept_a, dept_b = many_employees
    _, headers = await make_user(Role.HR_DIRECTOR)

    r = await client.get(f"{API}/employees", headers=headers,
                         params={"department_id": dept_a.id, "page_size": 100})
    assert r.json()["total"] == 28    # even indices 0..54

    r = await client.get(f"{API}/employees", headers=headers,
                         params={"department_id": dept_b.id, "page_size": 100})
    assert r.json()["total"] == 27


async def test_audit_pagination(client, db, make_user):
    from app.audit.service import AuditService
    from app.core.permissions import Role

    hr, headers = await make_user(Role.HR_DIRECTOR)
    for i in range(30):
        AuditService(db).record(
            action="test.pagination", resource_type="test", resource_id=i,
            user_id=hr.id, description=f"Row {i}",
        )
    await db.flush()

    r = await client.get(f"{API}/audit", headers=headers,
                         params={"page": 1, "page_size": 10})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 30
    assert body["pages"] == 3
    assert len(body["items"]) == 10
