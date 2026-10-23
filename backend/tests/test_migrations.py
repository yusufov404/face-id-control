"""Migration smoke test (opt-in).

Creates a throw-away database, runs ``alembic upgrade head``, verifies the
schema, then runs ``alembic downgrade base`` and drops the database.

Enable with:

    RUN_MIGRATION_TEST=1 TEST_DATABASE_PASSWORD=... pytest tests/test_migrations.py
"""
import os
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_MIGRATION_TEST") != "1",
    reason="Set RUN_MIGRATION_TEST=1 to run the Alembic migration test",
)

MIGRATIONS = Path(__file__).resolve().parents[2] / "database" / "migrations"


def test_alembic_upgrade_and_downgrade():
    psycopg2 = pytest.importorskip("psycopg2")
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, inspect

    from app.core.config import settings

    db_name = os.getenv("TEST_MIGRATION_DATABASE", "facesys_migration_test")
    if "test" not in db_name.lower():
        pytest.fail("Migration test database name must contain 'test'")

    original_name = settings.DATABASE_NAME
    admin = psycopg2.connect(
        host=settings.DATABASE_HOST, port=settings.DATABASE_PORT,
        user=settings.DATABASE_USER, password=settings.DATABASE_PASSWORD,
        dbname="postgres",
    )
    admin.autocommit = True
    try:
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
            cur.execute(f'CREATE DATABASE "{db_name}"')

        settings.DATABASE_NAME = db_name
        cfg = Config(str(MIGRATIONS / "alembic.ini"))
        cfg.set_main_option("script_location", str(MIGRATIONS))

        command.upgrade(cfg, "head")

        engine = create_engine(settings.DATABASE_URL_SYNC)
        try:
            inspector = inspect(engine)
            tables = set(inspector.get_table_names())
            expected = {
                "departments", "positions", "employees", "users", "roles",
                "permissions", "user_roles", "role_permissions", "devices",
                "device_events", "attendance_records", "attendance_corrections",
                "shifts", "employee_shift_assignments", "leave_requests",
                "holidays", "audit_logs", "system_settings",
            }
            assert expected <= tables, expected - tables
            assert "alembic_version" in tables
        finally:
            engine.dispose()

        # The migrated schema must also match the SQLAlchemy metadata exactly.
        command.check(cfg)

        command.downgrade(cfg, "base")

        engine = create_engine(settings.DATABASE_URL_SYNC)
        try:
            remaining = set(inspect(engine).get_table_names()) - {"alembic_version"}
            assert remaining == set(), remaining
        finally:
            engine.dispose()
    finally:
        settings.DATABASE_NAME = original_name
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
        admin.close()
