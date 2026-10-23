"""Employee-Device mapping and new roles

Revision ID: 0002_employee_device_mapping_and_roles
Revises: 0001_initial
Create Date: 2026-10-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0002_emp_dev_map_roles"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------ employee_device_user_ids
    op.create_table(
        "employee_device_user_ids",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("device_user_id", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_employee_device_user_ids"),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], name="fk_emp_dev_uid_employee_id_employees", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["device_id"], ["devices.id"], name="fk_emp_dev_uid_device_id_devices", ondelete="CASCADE"
        ),
        sa.UniqueConstraint("employee_id", "device_id", name="uq_employee_device_user_ids_emp_device"),
    )
    op.create_index(
        "ix_employee_device_user_ids_employee_id", "employee_device_user_ids", ["employee_id"]
    )
    op.create_index(
        "ix_employee_device_user_ids_device_id", "employee_device_user_ids", ["device_id"]
    )
    op.create_index(
        "ix_employee_device_user_ids_device_user_id", "employee_device_user_ids", ["device_user_id"]
    )
    op.create_index(
        "ix_employee_device_user_ids_is_deleted", "employee_device_user_ids", ["is_deleted"]
    )

    # ------------------------------------------------------------------ Insert new roles
    # DIRECTOR (Direktor)
    op.execute(
        """
        INSERT INTO roles (name, display_name, description, is_system, can_manage_users, can_manage_roles,
                           can_access_all_departments, can_modify_attendance, can_access_system_settings,
                           can_view_audit_logs, max_department_scope, is_deleted, created_at, updated_at)
        VALUES (
            'director', 'Direktor',
            'View all departments, attendance reports, and statistics. Cannot modify data.',
            true, false, false, true, false, false, true, 0, false, now(), now()
        )
        ON CONFLICT (name) DO NOTHING;
        """
    )

    # ACCOUNTANT (Hisobchi)
    op.execute(
        """
        INSERT INTO roles (name, display_name, description, is_system, can_manage_users, can_manage_roles,
                           can_access_all_departments, can_modify_attendance, can_access_system_settings,
                           can_view_audit_logs, max_department_scope, is_deleted, created_at, updated_at)
        VALUES (
            'accountant', 'Hisobchi',
            'View attendance and leave reports. Cannot modify data or manage users.',
            true, false, false, true, false, false, false, 0, false, now(), now()
        )
        ON CONFLICT (name) DO NOTHING;
        """
    )

    # ------------------------------------------------------------------ Permissions for DIRECTOR
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id, assigned_at)
        SELECT r.id, p.id, now()
        FROM roles r, permissions p
        WHERE r.name = 'director' AND p.name IN (
            'user:read', 'role:read', 'department:read', 'department:view_all',
            'employee:read', 'employee:view_all', 'position:read',
            'device:read', 'device:view_logs', 'attendance:read', 'attendance:read_all',
            'attendance:export', 'shift:read', 'holiday:read', 'leave:read', 'leave:read_all',
            'report:view', 'report:export', 'report:dashboard'
        )
        ON CONFLICT (role_id, permission_id) DO NOTHING;
        """
    )

    # ------------------------------------------------------------------ Permissions for ACCOUNTANT
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id, assigned_at)
        SELECT r.id, p.id, now()
        FROM roles r, permissions p
        WHERE r.name = 'accountant' AND p.name IN (
            'employee:read', 'department:read', 'position:read',
            'attendance:read', 'attendance:read_all', 'attendance:export',
            'leave:read', 'leave:read_all', 'holiday:read',
            'report:view', 'report:export', 'report:dashboard'
        )
        ON CONFLICT (role_id, permission_id) DO NOTHING;
        """
    )

    # ------------------------------------------------------------------ employee_device_user_ids table - add foreign key to roles if needed (not needed)

    # ------------------------------------------------------------------ Remove the unique constraint on employees.device_user_id
    # since we now have a many-to-many mapping
    op.execute("ALTER TABLE employees DROP CONSTRAINT IF EXISTS uq_employees_device_user_id;")


def downgrade() -> None:
    # Restore unique constraint on employees.device_user_id
    op.execute("ALTER TABLE employees ADD CONSTRAINT uq_employees_device_user_id UNIQUE (device_user_id);")

    # Remove roles
    op.execute("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name IN ('director', 'accountant'));")
    op.execute("DELETE FROM roles WHERE name IN ('director', 'accountant');")

    # Drop employee_device_user_ids table
    op.drop_index("ix_employee_device_user_ids_is_deleted", table_name="employee_device_user_ids")
    op.drop_index("ix_employee_device_user_ids_device_user_id", table_name="employee_device_user_ids")
    op.drop_index("ix_employee_device_user_ids_device_id", table_name="employee_device_user_ids")
    op.drop_index("ix_employee_device_user_ids_employee_id", table_name="employee_device_user_ids")
    op.drop_table("employee_device_user_ids")