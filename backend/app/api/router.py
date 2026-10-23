from fastapi import APIRouter

from app.api import (
    audit,
    auth,
    attendance,
    dashboard,
    departments,
    devices,
    employees,
    leaves,
    monitoring,
    positions,
    reports,
    settings,
    shifts,
    users,
)

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(departments.router)
api_router.include_router(positions.router)
api_router.include_router(employees.router)
api_router.include_router(users.router)
api_router.include_router(users.roles_router)
api_router.include_router(users.permissions_router)
api_router.include_router(devices.router)
api_router.include_router(monitoring.router)
api_router.include_router(attendance.router)
api_router.include_router(shifts.router)
api_router.include_router(shifts.assign_router)
api_router.include_router(leaves.router)
api_router.include_router(leaves.holiday_router)
api_router.include_router(reports.router)
api_router.include_router(audit.router)
api_router.include_router(settings.router)
api_router.include_router(settings.backup_router)