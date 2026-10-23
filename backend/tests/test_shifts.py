"""Shift assignment listing must serialize related employee and shift data."""
from datetime import date

from app.core.permissions import Role
from app.models.shift import EmployeeShiftAssignment

API = "/api/v1"


async def test_assignment_list_eager_loads_relations(
    client, db, make_user, employee_factory, shift_factory
):
    employee = await employee_factory("SHIFT-001", first_name="Ali", last_name="Valiyev")
    shift = await shift_factory("DAY")
    assignment = EmployeeShiftAssignment(
        employee_id=employee.id,
        shift_id=shift.id,
        start_date=date(2026, 1, 1),
        is_active=True,
    )
    db.add(assignment)
    await db.flush()

    _, headers = await make_user(Role.HR_DIRECTOR)

    response = await client.get(f"{API}/shift-assignments", headers=headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["employee_id"] == employee.id
    assert item["shift_id"] == shift.id
    assert item["employee_name"] == "Valiyev Ali"
    assert item["shift_name"] == "Shift DAY"
