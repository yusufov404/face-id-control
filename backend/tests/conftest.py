"""Pytest fixtures for FaceSys Enterprise.

Requirements
------------
* A running PostgreSQL server.
* A dedicated database whose name contains "test" (default: ``facesys_test``).
* ``TEST_DATABASE_*`` environment variables if the defaults do not match.

    createdb -U postgres facesys_test
    export TEST_DATABASE_PASSWORD=secret
    cd backend && pytest

The suite never touches a production database: it refuses to run unless the
database name contains "test". Each test runs inside a transaction that is
rolled back afterwards, so tests are independent of each other.

Schema is created from the SQLAlchemy metadata. Migration drift is checked
separately by ``test_migrations.py`` (requires ``alembic upgrade head`` on an
empty database and is opt-in).
"""
import asyncio
import os
import tempfile
from datetime import date, time
from pathlib import Path
from typing import AsyncGenerator, Optional

import pytest

# --------------------------------------------------------------------------- env
TEST_DB_NAME = os.getenv("TEST_DATABASE_NAME", "facesys_test")
if "test" not in TEST_DB_NAME.lower():
    raise RuntimeError(
        f"Refusing to run tests against database '{TEST_DB_NAME}'. "
        "The test database name must contain 'test'."
    )

os.environ["ENVIRONMENT"] = "testing"
os.environ["DEBUG"] = "false"
os.environ["SECRET_KEY"] = "t" * 64
os.environ["REFRESH_SECRET_KEY"] = "r" * 64
os.environ["DATABASE_HOST"] = os.getenv("TEST_DATABASE_HOST", "localhost")
os.environ["DATABASE_PORT"] = os.getenv("TEST_DATABASE_PORT", "5432")
os.environ["DATABASE_NAME"] = TEST_DB_NAME
os.environ["DATABASE_USER"] = os.getenv("TEST_DATABASE_USER", "postgres")
os.environ["DATABASE_PASSWORD"] = os.getenv("TEST_DATABASE_PASSWORD", "")
# Keep the auth/IP limiter out of the way; lockout is still tested at user level.
os.environ["LOGIN_RATE_LIMIT"] = "1000"
os.environ["API_RATE_LIMIT"] = "100000"

_BACKUP_ROOT = Path(tempfile.gettempdir()) / f"facesys_test_backups_{os.getpid()}"
os.environ["BACKUP_DIR_SSD"] = str(_BACKUP_ROOT / "ssd")
os.environ["BACKUP_DIR_HDD"] = str(_BACKUP_ROOT / "hdd_not_mounted")

import httpx  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app.core.database import Base, get_db  # noqa: E402
from app.core.permissions import ROLE_DEFINITIONS, Permission, Role as RoleEnum  # noqa: E402
from app.core.security import create_token_pair, get_password_hash  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import Permission as PermissionModel  # noqa: E402
from app.models.user import Role, User  # noqa: E402

TEST_DB_URL = (
    f"postgresql+asyncpg://{os.environ['DATABASE_USER']}:{os.environ['DATABASE_PASSWORD']}"
    f"@{os.environ['DATABASE_HOST']}:{os.environ['DATABASE_PORT']}/{TEST_DB_NAME}"
)

TEST_PASSWORD = "TestPassphrase123!"


async def _create_schema() -> None:
    eng = create_async_engine(TEST_DB_URL, poolclass=NullPool)
    try:
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    finally:
        await eng.dispose()


async def _drop_schema() -> None:
    eng = create_async_engine(TEST_DB_URL, poolclass=NullPool)
    try:
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
    finally:
        await eng.dispose()


@pytest.fixture(scope="session", autouse=True)
def _test_database():
    """Create the schema once per session, drop it at the end."""
    try:
        asyncio.run(_create_schema())
    except Exception as exc:  # noqa: BLE001
        pytest.exit(
            f"Test database is not reachable ({exc}).\n"
            f"Create it first:  createdb -U {os.environ['DATABASE_USER']} {TEST_DB_NAME}",
            returncode=2,
        )
    yield
    try:
        asyncio.run(_drop_schema())
    except Exception:  # noqa: BLE001
        pass


@pytest.fixture
async def engine() -> AsyncGenerator:
    """Function-scoped engine bound to the running test event loop."""
    eng = create_async_engine(TEST_DB_URL, poolclass=NullPool)
    try:
        yield eng
    finally:
        await eng.dispose()


@pytest.fixture
async def db(engine) -> AsyncGenerator[AsyncSession, None]:
    """Isolated session: everything rolls back after each test."""
    connection = await engine.connect()
    transaction = await connection.begin()
    session = AsyncSession(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    try:
        yield session
    finally:
        await session.close()
        await transaction.rollback()
        await connection.close()


@pytest.fixture
async def seeded(db: AsyncSession) -> dict:
    """Insert all permissions, the 5 system roles and their matrix."""
    perms: dict[str, PermissionModel] = {}
    for p in Permission:
        obj = PermissionModel(
            name=p.value,
            display_name=p.value,
            category=p.value.split(":", 1)[0],
            is_system=True,
        )
        db.add(obj)
        perms[p.value] = obj
    await db.flush()

    roles: dict[str, Role] = {}
    for role_enum, definition in ROLE_DEFINITIONS.items():
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
        )
        role.permissions = [perms[p.value] for p in definition.permissions]
        db.add(role)
        roles[role_enum.value] = role
    await db.flush()
    return {"permissions": perms, "roles": roles}


@pytest.fixture
async def client(db: AsyncSession) -> AsyncGenerator[httpx.AsyncClient, None]:
    async def _override_db():
        yield db
        # Endpoints that rely on get_db's implicit commit still work in tests.
        await db.commit()

    app.dependency_overrides[get_db] = _override_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c
    app.dependency_overrides.clear()


def _headers_for(user: User) -> dict[str, str]:
    tokens = create_token_pair({
        "sub": user.username,
        "user_id": user.id,
        "email": user.email,
        "is_superuser": user.is_superuser,
    })
    return {"Authorization": f"Bearer {tokens.access_token}"}


@pytest.fixture
def make_user(db: AsyncSession, seeded: dict):
    """Factory: create a user with a role and return (user, auth_headers)."""
    counter = {"n": 0}

    async def _make(
        role: Optional[RoleEnum] = None,
        *,
        department_id: Optional[int] = None,
        is_superuser: bool = False,
        username: Optional[str] = None,
        is_active: bool = True,
    ):
        counter["n"] += 1
        name = username or f"user{counter['n']}"
        user = User(
            username=name,
            email=f"{name}@test.local",
            password_hash=get_password_hash(TEST_PASSWORD),
            full_name=f"Test {name.title()}",
            department_id=department_id,
            is_active=is_active,
            is_superuser=is_superuser,
        )
        if role is not None:
            user.roles = [seeded["roles"][role.value]]
        db.add(user)
        await db.flush()
        # Load the collection so tests may replace user.roles without triggering
        # an async lazy load (which SQLAlchemy forbids outside greenlet context).
        await db.refresh(user, ["roles"])
        return user, _headers_for(user)

    return _make


@pytest.fixture
def dept_factory(db: AsyncSession):
    from app.models.department import Department

    async def _make(name: str, code: str):
        d = Department(name=name, code=code, is_active=True)
        db.add(d)
        await db.flush()
        return d

    return _make


@pytest.fixture
def employee_factory(db: AsyncSession):
    from app.models.employee import Employee, EmploymentStatus

    async def _make(
        internal_id: str,
        *,
        department_id: Optional[int] = None,
        device_user_id: Optional[str] = None,
        first_name: str = "Ali",
        last_name: str = "Valiyev",
        status: EmploymentStatus = EmploymentStatus.ACTIVE,
    ):
        e = Employee(
            internal_id=internal_id,
            device_user_id=device_user_id,
            first_name=first_name,
            last_name=last_name,
            hire_date=date(2024, 1, 1),
            department_id=department_id,
            status=status,
        )
        db.add(e)
        await db.flush()
        return e

    return _make


@pytest.fixture
def shift_factory(db: AsyncSession):
    from app.models.shift import Shift

    async def _make(
        code: str = "DAY",
        *,
        start: time = time(8, 0),
        end: time = time(17, 0),
        late_threshold: int = 15,
        early_leave_threshold: int = 15,
        min_work_minutes: int = 480,
    ):
        s = Shift(
            name=f"Shift {code}",
            code=code,
            start_time=start,
            end_time=end,
            crosses_midnight=end <= start,
            late_threshold=late_threshold,
            early_leave_threshold=early_leave_threshold,
            min_work_minutes=min_work_minutes,
            applicable_days=[],
        )
        db.add(s)
        await db.flush()
        return s

    return _make


@pytest.fixture
def device_factory(db: AsyncSession):
    from app.core.crypto import encrypt_secret
    from app.models.device import Device

    async def _make(
        name: str = "Test terminal",
        *,
        serial_number: str = "DS-TEST-0001",
        department_id: Optional[int] = None,
    ):
        d = Device(
            name=name,
            serial_number=serial_number,
            ip_address="192.0.2.10",
            port=80,
            username="admin",
            password_encrypted=encrypt_secret("device-password"),
            department_id=department_id,
            sync_enabled=False,
        )
        db.add(d)
        await db.flush()
        return d

    return _make
