"""Seed initial roles, permissions, settings, and the first Super Admin.

Usage (from repo root, backend venv active):
    python database/seed/seed.py --admin-username admin --admin-password 'StrongPass123!'

Demo organisational data (departments/positions/shifts) is created only with
--with-org. NO attendance events or attendance records are ever seeded — the
system must never present fake data as real.
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend"))

from sqlalchemy import select

from app.core.database import async_session_maker
from app.core.permissions import Permission, Role as RoleEnum, ROLE_DEFINITIONS
from app.core.security import get_password_hash
from app.models.department import Department
from app.models.position import Position
from app.models.shift import Shift
from app.models.settings import SystemSetting
from app.models.user import Permission as PermissionModel, Role, User
from datetime import time


PERMISSION_LABELS = {
    "user": "Foydalanuvchilar",
    "role": "Rollar",
    "department": "Bo'limlar",
    "employee": "Xodimlar",
    "position": "Lavozimlar",
    "device": "Qurilmalar",
    "attendance": "Davomat",
    "shift": "Smenalar",
    "holiday": "Bayramlar",
    "leave": "Ta'tillar",
    "report": "Hisobotlar",
    "audit": "Audit",
    "settings": "Sozlamalar",
    "system": "Tizim",
}

PERMISSION_DISPLAY = {
    "user:create": "Foydalanuvchi yaratish",
    "user:read": "Foydalanuvchilarni ko'rish",
    "user:update": "Foydalanuvchini tahrirlash",
    "user:delete": "Foydalanuvchini o'chirish",
    "user:assign_role": "Rol biriktirish",
    "role:create": "Rol yaratish",
    "role:read": "Rollarni ko'rish",
    "role:update": "Rolni tahrirlash",
    "role:delete": "Rolni o'chirish",
    "role:assign_permission": "Rolga ruxsat berish",
    "department:create": "Bo'lim yaratish",
    "department:read": "Bo'limlarni ko'rish",
    "department:update": "Bo'limni tahrirlash",
    "department:delete": "Bo'limni o'chirish",
    "department:view_all": "Barcha bo'limlarni ko'rish",
    "employee:create": "Xodim qo'shish",
    "employee:read": "Xodimlarni ko'rish",
    "employee:update": "Xodimni tahrirlash",
    "employee:delete": "Xodimni o'chirish",
    "employee:view_all": "Barcha xodimlarni ko'rish",
    "employee:change_status": "Xodim holatini o'zgartirish",
    "position:create": "Lavozim yaratish",
    "position:read": "Lavozimlarni ko'rish",
    "position:update": "Lavozimni tahrirlash",
    "position:delete": "Lavozimni o'chirish",
    "device:create": "Qurilma qo'shish",
    "device:read": "Qurilmalarni ko'rish",
    "device:update": "Qurilmani tahrirlash",
    "device:delete": "Qurilmani o'chirish",
    "device:sync": "Qurilma sinxronizatsiyasi",
    "device:view_logs": "Qurilma loglarini ko'rish",
    "attendance:read": "Davomatni ko'rish",
    "attendance:read_all": "Barcha davomatni ko'rish",
    "attendance:correct": "Davomatni tuzatish",
    "attendance:correct_all": "Barcha bo'limlarda tuzatish",
    "attendance:export": "Davomat eksporti",
    "shift:create": "Smena yaratish",
    "shift:read": "Smenalarni ko'rish",
    "shift:update": "Smenani tahrirlash",
    "shift:delete": "Smenani o'chirish",
    "shift:assign": "Smena biriktirish",
    "holiday:create": "Bayram qo'shish",
    "holiday:read": "Bayramlarni ko'rish",
    "holiday:update": "Bayramni tahrirlash",
    "holiday:delete": "Bayramni o'chirish",
    "leave:create": "Ta'til so'rovi yaratish",
    "leave:read": "Ta'tillarni ko'rish",
    "leave:approve": "Ta'tilni tasdiqlash",
    "leave:read_all": "Barcha ta'tillarni ko'rish",
    "report:view": "Hisobotlarni ko'rish",
    "report:export": "Hisobot eksporti",
    "report:dashboard": "Dashboard",
    "audit:read": "Auditni ko'rish",
    "audit:export": "Audit eksporti",
    "settings:read": "Sozlamalarni ko'rish",
    "settings:update": "Sozlamalarni tahrirlash",
    "settings:backup": "Zaxira nusxa",
    "settings:restore": "Tiklash",
    "system:admin": "Tizim administratori",
}


async def seed_permissions(db) -> dict[str, PermissionModel]:
    out = {}
    for perm in Permission:
        existing = (await db.execute(
            select(PermissionModel).where(PermissionModel.name == perm.value)
        )).scalar_one_or_none()
        if existing:
            out[perm.value] = existing
            continue
        category = perm.value.split(":", 1)[0]
        obj = PermissionModel(
            name=perm.value,
            display_name=PERMISSION_DISPLAY.get(perm.value, perm.value),
            description=f"{PERMISSION_LABELS.get(category, category)} moduli ruxsati",
            category=category,
            is_system=True,
        )
        db.add(obj)
        out[perm.value] = obj
    await db.flush()
    return out


async def seed_roles(db, perm_map: dict[str, PermissionModel]) -> dict[str, Role]:
    out = {}
    for role_enum, definition in ROLE_DEFINITIONS.items():
        target_permissions = [
            perm_map[p.value] for p in definition.permissions if p.value in perm_map
        ]
        role = (await db.execute(
            select(Role).where(Role.name == role_enum.value)
        )).scalar_one_or_none()
        if role is None:
            role = Role(
                name=role_enum.value,
                display_name=definition.display_name,
                description=definition.description,
                is_system=True,
                can_manage_users=definition.can_manage_users,
                can_manage_roles=definition.can_manage_roles,
                can_access_all_departments=definition.can_access_all_departments,
                can_modify_attendance=definition.can_modify_attendance,
                can_access_system_settings=definition.can_access_system_settings,
                can_view_audit_logs=definition.can_view_audit_logs,
                max_department_scope=definition.max_department_scope,
                permissions=target_permissions,
            )
            db.add(role)
            await db.flush()
        else:
            # Refresh the collection before replacing it; lazy loading is not
            # allowed in the async session.
            await db.refresh(role, ["permissions"])
            # Keep flags in sync with code.
            role.display_name = definition.display_name
            role.description = definition.description
            role.can_manage_users = definition.can_manage_users
            role.can_manage_roles = definition.can_manage_roles
            role.can_access_all_departments = definition.can_access_all_departments
            role.can_modify_attendance = definition.can_modify_attendance
            role.can_access_system_settings = definition.can_access_system_settings
            role.can_view_audit_logs = definition.can_view_audit_logs
            role.max_department_scope = definition.max_department_scope
            role.permissions = target_permissions
        out[role_enum.value] = role
    await db.flush()
    return out


async def seed_admin(db, username: str, password: str, email: str, roles: dict[str, Role]):
    existing = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if existing:
        print(f"[=] Admin '{username}' allaqachon mavjud — o'zgartirilmadi")
        return existing
    admin = User(
        username=username,
        email=email,
        password_hash=get_password_hash(password),
        full_name="Tizim administratori",
        is_active=True,
        is_superuser=True,
    )
    admin.roles = [roles[RoleEnum.SUPER_ADMIN.value]]
    db.add(admin)
    await db.flush()
    print(f"[+] Super Admin yaratildi: {username}")
    return admin


async def seed_settings(db):
    defaults = [
        ("org.name", "FaceSys Enterprise", "string", "organization", "Tashkilot nomi", True, False),
        ("org.timezone", "Asia/Tashkent", "string", "organization", "Tizim vaqt zonasi", True, False),
        ("attendance.late_grace_minutes", 15, "integer", "attendance", "Kechikishga tolerantlik", False, False),
        ("attendance.debounce_seconds", 60, "integer", "attendance", "Takroriy skan bo'sag'asi", False, False),
        ("hikvision.polling_enabled", True, "boolean", "integration", "Hikvision polling yoqilgan", False, False),
        ("hikvision.poll_interval_seconds", 30, "integer", "integration", "Polling oralig'i", False, False),
        ("backup.retention_days_hdd", 90, "integer", "backup", "HDD zaxira muddati", False, False),
    ]
    for key, value, vtype, cat, desc, public, readonly in defaults:
        existing = (await db.execute(
            select(SystemSetting).where(SystemSetting.key == key)
        )).scalar_one_or_none()
        if existing:
            continue
        db.add(SystemSetting(
            key=key, value=value, value_type=vtype, category=cat,
            description=desc, is_public=public, is_readonly=readonly,
        ))
    await db.flush()


async def seed_org(db):
    """Optional demo organisational structure. No attendance data."""
    depts = [
        ("Kardiologiya", "CARD"),
        ("Nevrologiya", "NEURO"),
        ("Terapiya", "THER"),
        ("Pediatriya", "PED"),
        ("Jarrohlik", "SURG"),
        ("Radiologiya", "RAD"),
        ("Laboratoriya", "LAB"),
        ("Qabul bo'limi", "RECEP"),
        ("Ma'muriyat", "ADMIN"),
    ]
    created = []
    for name, code in depts:
        d = (await db.execute(select(Department).where(Department.code == code))).scalar_one_or_none()
        if d is None:
            d = Department(name=name, code=code, is_active=True)
            db.add(d)
            created.append(name)
    await db.flush()

    positions = [
        ("Bosh shifokor", "CHIEF"),
        ("Bo'lim mudiri", "HEAD"),
        ("Shifokor", "DOC"),
        ("Hamshira", "NURSE"),
        ("Laborant", "LABTECH"),
        ("Administrator", "ADM"),
        ("Sanitar", "CLEAN"),
    ]
    for name, code in positions:
        p = (await db.execute(select(Position).where(Position.code == code))).scalar_one_or_none()
        if p is None:
            db.add(Position(name=name, code=code, is_active=True))
    await db.flush()

    shifts = [
        ("Kunduzgi smena", "DAY", time(8, 0), time(17, 0), False, 60),
        ("Tungi smena", "NIGHT", time(20, 0), time(8, 0), True, 60),
        ("Ertalabki smena", "MORNING", time(7, 0), time(14, 0), False, 30),
    ]
    for name, code, start, end, crosses, brk in shifts:
        s = (await db.execute(select(Shift).where(Shift.code == code))).scalar_one_or_none()
        if s is None:
            db.add(Shift(
                name=name, code=code, start_time=start, end_time=end,
                crosses_midnight=crosses, break_duration=brk,
                break_start=time(13, 0) if not crosses else None,
                break_end=time(14, 0) if not crosses else None,
                is_active=True, applicable_days=[],
            ))
    await db.flush()
    if created:
        print(f"[+] Bo'limlar yaratildi: {', '.join(created)}")


async def main():
    parser = argparse.ArgumentParser(description="FaceSys seed")
    parser.add_argument("--admin-username", default=os.getenv("SEED_ADMIN_USERNAME", "admin"))
    parser.add_argument("--admin-password", default=os.getenv("SEED_ADMIN_PASSWORD"))
    parser.add_argument("--admin-email", default=os.getenv("SEED_ADMIN_EMAIL", "admin@facesys.local"))
    parser.add_argument("--with-org", action="store_true", help="Demo bo'lim/lavozim/smena yaratish")
    args = parser.parse_args()

    if not args.admin_password:
        print("[!] --admin-password yoki SEED_ADMIN_PASSWORD kerak")
        sys.exit(2)
    if len(args.admin_password) < 10:
        print("[!] Admin paroli kamida 10 belgidan iborat bo'lishi kerak")
        sys.exit(2)

    async with async_session_maker() as db:
        perm_map = await seed_permissions(db)
        print(f"[+] Ruxsatlar: {len(perm_map)}")
        roles = await seed_roles(db, perm_map)
        print(f"[+] Rollar: {len(roles)}")
        await seed_settings(db)
        if args.with_org:
            await seed_org(db)
        await seed_admin(db, args.admin_username, args.admin_password, args.admin_email, roles)
        await db.commit()
    print("[✓] Seed tugadi")


if __name__ == "__main__":
    asyncio.run(main())