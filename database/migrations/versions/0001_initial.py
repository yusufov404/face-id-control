"""Initial schema — FaceSys Enterprise

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-22

Creates all core tables for FaceSys Enterprise.
Circular foreign keys are added in a second phase:
  - departments.head_employee_id -> employees.id
  - attendance_records.check_in_event_id / check_out_event_id -> device_events.id
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------ departments
    op.create_table(
        "departments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("head_employee_id", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_departments"),
        sa.UniqueConstraint("name", name="uq_departments_name"),
        sa.UniqueConstraint("code", name="uq_departments_code"),
        sa.ForeignKeyConstraint(["parent_id"], ["departments.id"], name="fk_departments_parent_id_departments", ondelete="SET NULL"),
    )
    op.create_index("ix_departments_parent_id", "departments", ["parent_id"])
    op.create_index("ix_departments_is_deleted", "departments", ["is_deleted"])
    op.create_index("ix_departments_parent_active", "departments", ["parent_id", "is_active"])
    op.create_index("ix_departments_code_active", "departments", ["code", "is_active"])

    # ------------------------------------------------------------------ positions
    op.create_table(
        "positions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_positions"),
        sa.UniqueConstraint("name", name="uq_positions_name"),
        sa.UniqueConstraint("code", name="uq_positions_code"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], name="fk_positions_department_id_departments", ondelete="SET NULL"),
    )
    op.create_index("ix_positions_department_id", "positions", ["department_id"])
    op.create_index("ix_positions_is_deleted", "positions", ["is_deleted"])
    op.create_index("ix_positions_dept_active", "positions", ["department_id", "is_active"])

    # ------------------------------------------------------------------ employees
    op.create_table(
        "employees",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("internal_id", sa.String(length=20), nullable=False),
        sa.Column("device_user_id", sa.String(length=32), nullable=True),
        sa.Column("first_name", sa.String(length=50), nullable=False),
        sa.Column("last_name", sa.String(length=50), nullable=False),
        sa.Column("middle_name", sa.String(length=50), nullable=True),
        sa.Column("gender", sa.String(length=20), nullable=True),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("email", sa.String(length=100), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("photo_url", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("hire_date", sa.Date(), nullable=False),
        sa.Column("termination_date", sa.Date(), nullable=True),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("position_id", sa.Integer(), nullable=True),
        sa.Column("supervisor_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_employees"),
        sa.UniqueConstraint("internal_id", name="uq_employees_internal_id"),
        sa.UniqueConstraint("device_user_id", name="uq_employees_device_user_id"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], name="fk_employees_department_id_departments", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["position_id"], ["positions.id"], name="fk_employees_position_id_positions", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["supervisor_id"], ["employees.id"], name="fk_employees_supervisor_id_employees", ondelete="SET NULL"),
    )
    op.create_index("ix_employees_department_id", "employees", ["department_id"])
    op.create_index("ix_employees_position_id", "employees", ["position_id"])
    op.create_index("ix_employees_status", "employees", ["status"])
    op.create_index("ix_employees_is_deleted", "employees", ["is_deleted"])
    op.create_index("ix_employees_dept_status", "employees", ["department_id", "status"])
    op.create_index("ix_employees_name", "employees", ["last_name", "first_name"])
    op.create_index("ix_employees_hire_date", "employees", ["hire_date"])

    # departments.head_employee_id (circular — added now that employees exists)
    op.create_foreign_key(
        "fk_departments_head_employee_id_employees",
        "departments", "employees",
        ["head_employee_id"], ["id"], ondelete="SET NULL",
    )

    # ------------------------------------------------------------------ roles / permissions
    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False),
        sa.Column("can_manage_users", sa.Boolean(), nullable=False),
        sa.Column("can_manage_roles", sa.Boolean(), nullable=False),
        sa.Column("can_access_all_departments", sa.Boolean(), nullable=False),
        sa.Column("can_modify_attendance", sa.Boolean(), nullable=False),
        sa.Column("can_access_system_settings", sa.Boolean(), nullable=False),
        sa.Column("can_view_audit_logs", sa.Boolean(), nullable=False),
        sa.Column("max_department_scope", sa.Integer(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_roles"),
        sa.UniqueConstraint("name", name="uq_roles_name"),
    )
    op.create_index("ix_roles_is_deleted", "roles", ["is_deleted"])

    op.create_table(
        "permissions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=50), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_permissions"),
        sa.UniqueConstraint("name", name="uq_permissions_name"),
    )
    op.create_index("ix_permissions_category", "permissions", ["category"])
    op.create_index("ix_permissions_is_deleted", "permissions", ["is_deleted"])

    # ------------------------------------------------------------------ users
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("email", sa.String(length=100), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=100), nullable=False),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_superuser", sa.Boolean(), nullable=False),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_login_attempts", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mfa_enabled", sa.Boolean(), nullable=False),
        sa.Column("mfa_secret", sa.String(length=32), nullable=True),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("employee_id", sa.Integer(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("username", name="uq_users_username"),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.UniqueConstraint("employee_id", name="uq_users_employee_id"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], name="fk_users_department_id_departments", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], name="fk_users_employee_id_employees", ondelete="SET NULL"),
    )
    op.create_index("ix_users_department_id", "users", ["department_id"])
    op.create_index("ix_users_is_deleted", "users", ["is_deleted"])

    op.create_table(
        "user_roles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("assigned_by", sa.Integer(), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_user_roles"),
        sa.UniqueConstraint("user_id", "role_id", name="uq_user_roles_user_role"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_user_roles_user_id_users", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], name="fk_user_roles_role_id_roles", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_by"], ["users.id"], name="fk_user_roles_assigned_by_users", ondelete="SET NULL"),
    )

    op.create_table(
        "role_permissions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("permission_id", sa.Integer(), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_role_permissions"),
        sa.UniqueConstraint("role_id", "permission_id", name="uq_role_permissions_role_permission"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], name="fk_role_permissions_role_id_roles", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["permission_id"], ["permissions.id"], name="fk_role_permissions_permission_id_permissions", ondelete="CASCADE"),
    )

    # ------------------------------------------------------------------ devices
    op.create_table(
        "devices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("serial_number", sa.String(length=50), nullable=False),
        sa.Column("device_type", sa.String(length=30), nullable=False),
        sa.Column("ip_address", sa.String(length=45), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("connection_type", sa.String(length=10), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("password_encrypted", sa.String(length=255), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("firmware_version", sa.String(length=50), nullable=True),
        sa.Column("model", sa.String(length=50), nullable=True),
        sa.Column("isapi_version", sa.String(length=20), nullable=True),
        sa.Column("capabilities", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("last_heartbeat", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_enabled", sa.Boolean(), nullable=False),
        sa.Column("sync_interval", sa.Integer(), nullable=False),
        sa.Column("timeout", sa.Integer(), nullable=False),
        sa.Column("retry_attempts", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_devices"),
        sa.UniqueConstraint("serial_number", name="uq_devices_serial_number"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], name="fk_devices_department_id_departments", ondelete="SET NULL"),
    )
    op.create_index("ix_devices_department_id", "devices", ["department_id"])
    op.create_index("ix_devices_status", "devices", ["status"])
    op.create_index("ix_devices_is_deleted", "devices", ["is_deleted"])
    op.create_index("ix_devices_dept_status", "devices", ["department_id", "status"])
    op.create_index("ix_devices_ip_port", "devices", ["ip_address", "port"])

    # ------------------------------------------------------------------ shifts
    op.create_table(
        "shifts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("shift_type", sa.String(length=20), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("crosses_midnight", sa.Boolean(), nullable=False),
        sa.Column("break_start", sa.Time(), nullable=True),
        sa.Column("break_end", sa.Time(), nullable=True),
        sa.Column("break_duration", sa.Integer(), nullable=False),
        sa.Column("late_threshold", sa.Integer(), nullable=False),
        sa.Column("early_leave_threshold", sa.Integer(), nullable=False),
        sa.Column("min_work_minutes", sa.Integer(), nullable=False),
        sa.Column("overtime_enabled", sa.Boolean(), nullable=False),
        sa.Column("overtime_start_after", sa.Integer(), nullable=False),
        sa.Column("max_overtime_minutes", sa.Integer(), nullable=True),
        sa.Column("rotation_pattern", sa.JSON(), nullable=True),
        sa.Column("applicable_days", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_shifts"),
        sa.UniqueConstraint("code", name="uq_shifts_code"),
    )
    op.create_index("ix_shifts_is_deleted", "shifts", ["is_deleted"])
    op.create_index("ix_shifts_active_type", "shifts", ["is_active", "shift_type"])

    op.create_table(
        "employee_shift_assignments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("shift_id", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("custom_start_time", sa.Time(), nullable=True),
        sa.Column("custom_end_time", sa.Time(), nullable=True),
        sa.Column("custom_break_start", sa.Time(), nullable=True),
        sa.Column("custom_break_end", sa.Time(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_employee_shift_assignments"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], name="fk_employee_shift_assignments_employee_id_employees", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"], name="fk_employee_shift_assignments_shift_id_shifts", ondelete="CASCADE"),
    )
    op.create_index("ix_employee_shift_assignments_employee_id", "employee_shift_assignments", ["employee_id"])
    op.create_index("ix_employee_shift_assignments_shift_id", "employee_shift_assignments", ["shift_id"])
    op.create_index("ix_employee_shift_assignments_is_deleted", "employee_shift_assignments", ["is_deleted"])
    op.create_index("ix_emp_shift_assignments_dates", "employee_shift_assignments", ["employee_id", "start_date", "end_date"])
    op.create_index("ix_emp_shift_assignments_active", "employee_shift_assignments", ["employee_id", "is_active", "start_date"])

    # ------------------------------------------------------------------ attendance_records
    op.create_table(
        "attendance_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("record_date", sa.Date(), nullable=False),
        sa.Column("shift_id", sa.Integer(), nullable=True),
        sa.Column("scheduled_check_in", sa.Time(), nullable=True),
        sa.Column("scheduled_check_out", sa.Time(), nullable=True),
        sa.Column("actual_check_in", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_check_out", sa.DateTime(timezone=True), nullable=True),
        sa.Column("break_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("break_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("overtime_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("overtime_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("late_minutes", sa.Integer(), nullable=False),
        sa.Column("early_leave_minutes", sa.Integer(), nullable=False),
        sa.Column("work_minutes", sa.Integer(), nullable=False),
        sa.Column("overtime_minutes", sa.Integer(), nullable=False),
        sa.Column("break_minutes", sa.Integer(), nullable=False),
        sa.Column("check_in_event_id", sa.Integer(), nullable=True),
        sa.Column("check_out_event_id", sa.Integer(), nullable=True),
        sa.Column("is_manual", sa.Boolean(), nullable=False),
        sa.Column("is_confirmed", sa.Boolean(), nullable=False),
        sa.Column("confirmed_by", sa.Integer(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_attendance_records"),
        sa.UniqueConstraint("employee_id", "record_date", name="uq_attendance_records_emp_date"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], name="fk_attendance_records_employee_id_employees", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"], name="fk_attendance_records_shift_id_shifts", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["confirmed_by"], ["users.id"], name="fk_attendance_records_confirmed_by_users", ondelete="SET NULL"),
    )
    op.create_index("ix_attendance_records_employee_id", "attendance_records", ["employee_id"])
    op.create_index("ix_attendance_records_record_date", "attendance_records", ["record_date"])
    op.create_index("ix_attendance_records_status", "attendance_records", ["status"])
    op.create_index("ix_attendance_records_is_deleted", "attendance_records", ["is_deleted"])
    op.create_index("ix_attendance_records_date_status", "attendance_records", ["record_date", "status"])
    op.create_index("ix_attendance_records_emp_date_status", "attendance_records", ["employee_id", "record_date", "status"])

    # ------------------------------------------------------------------ device_events
    op.create_table(
        "device_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=True),
        sa.Column("device_user_id", sa.String(length=32), nullable=True),
        sa.Column("event_type", sa.String(length=30), nullable=False),
        sa.Column("verify_mode", sa.String(length=30), nullable=True),
        sa.Column("event_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device_event_id", sa.String(length=64), nullable=False),
        sa.Column("similarity", sa.Float(), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("mask_detected", sa.Boolean(), nullable=True),
        sa.Column("raw_data", sa.JSON(), nullable=False),
        sa.Column("processed", sa.Boolean(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attendance_record_id", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_device_events"),
        sa.UniqueConstraint("device_id", "device_event_id", name="uq_device_events_device_event_id"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], name="fk_device_events_device_id_devices", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], name="fk_device_events_employee_id_employees", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["attendance_record_id"], ["attendance_records.id"], name="fk_device_events_attendance_record_id_attendance_records", ondelete="SET NULL"),
    )
    op.create_index("ix_device_events_device_id", "device_events", ["device_id"])
    op.create_index("ix_device_events_employee_id", "device_events", ["employee_id"])
    op.create_index("ix_device_events_device_user_id", "device_events", ["device_user_id"])
    op.create_index("ix_device_events_event_time", "device_events", ["event_time"])
    op.create_index("ix_device_events_processed", "device_events", ["processed"])
    op.create_index("ix_device_events_is_deleted", "device_events", ["is_deleted"])
    op.create_index("ix_device_events_emp_time", "device_events", ["employee_id", "event_time"])
    op.create_index("ix_device_events_unprocessed", "device_events", ["processed", "event_time"])

    # attendance_records event FKs (circular — device_events now exists)
    op.create_foreign_key(
        "fk_attendance_records_check_in_event_id_device_events",
        "attendance_records", "device_events",
        ["check_in_event_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_attendance_records_check_out_event_id_device_events",
        "attendance_records", "device_events",
        ["check_out_event_id"], ["id"], ondelete="SET NULL",
    )

    # ------------------------------------------------------------------ attendance_corrections
    op.create_table(
        "attendance_corrections",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("attendance_record_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("correction_type", sa.String(length=30), nullable=False),
        sa.Column("field_name", sa.String(length=50), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("corrected_by", sa.Integer(), nullable=False),
        sa.Column("approved_by", sa.Integer(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_approved", sa.Boolean(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_attendance_corrections"),
        sa.ForeignKeyConstraint(["attendance_record_id"], ["attendance_records.id"], name="fk_attendance_corrections_attendance_record", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], name="fk_attendance_corrections_employee_id_employees", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["corrected_by"], ["users.id"], name="fk_attendance_corrections_corrected_by_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], name="fk_attendance_corrections_approved_by_users", ondelete="SET NULL"),
    )
    op.create_index("ix_attendance_corrections_attendance_record_id", "attendance_corrections", ["attendance_record_id"])
    op.create_index("ix_attendance_corrections_employee_id", "attendance_corrections", ["employee_id"])
    op.create_index("ix_attendance_corrections_is_deleted", "attendance_corrections", ["is_deleted"])
    op.create_index("ix_attendance_corrections_emp_date", "attendance_corrections", ["employee_id", "created_at"])
    op.create_index("ix_attendance_corrections_pending", "attendance_corrections", ["is_approved", "created_at"])

    # ------------------------------------------------------------------ leave_requests
    op.create_table(
        "leave_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("leave_type", sa.String(length=30), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_days", sa.Float(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("attachment_url", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("requested_by", sa.Integer(), nullable=False),
        sa.Column("approved_by", sa.Integer(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_leave_requests"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], name="fk_leave_requests_employee_id_employees", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], name="fk_leave_requests_requested_by_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], name="fk_leave_requests_approved_by_users", ondelete="SET NULL"),
    )
    op.create_index("ix_leave_requests_employee_id", "leave_requests", ["employee_id"])
    op.create_index("ix_leave_requests_start_date", "leave_requests", ["start_date"])
    op.create_index("ix_leave_requests_end_date", "leave_requests", ["end_date"])
    op.create_index("ix_leave_requests_status", "leave_requests", ["status"])
    op.create_index("ix_leave_requests_is_deleted", "leave_requests", ["is_deleted"])
    op.create_index("ix_leave_requests_emp_dates", "leave_requests", ["employee_id", "start_date", "end_date"])
    op.create_index("ix_leave_requests_status_dates", "leave_requests", ["status", "start_date", "end_date"])

    # ------------------------------------------------------------------ holidays
    op.create_table(
        "holidays",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("is_recurring", sa.Boolean(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_working_day", sa.Boolean(), nullable=False),
        sa.Column("applies_to_all", sa.Boolean(), nullable=False),
        sa.Column("department_ids", sa.JSON(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_holidays"),
        sa.UniqueConstraint("date", name="uq_holidays_date"),
    )
    op.create_index("ix_holidays_is_deleted", "holidays", ["is_deleted"])
    op.create_index("ix_holidays_date_recurring", "holidays", ["date", "is_recurring"])

    # ------------------------------------------------------------------ audit_logs
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("user_ip", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("resource_type", sa.String(length=50), nullable=False),
        sa.Column("resource_id", sa.String(length=50), nullable=True),
        sa.Column("old_values", sa.JSON(), nullable=True),
        sa.Column("new_values", sa.JSON(), nullable=True),
        sa.Column("changed_fields", sa.JSON(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("request_method", sa.String(length=10), nullable=True),
        sa.Column("request_path", sa.String(length=255), nullable=True),
        sa.Column("request_id", sa.String(length=36), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_audit_logs"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_audit_logs_user_id_users", ondelete="SET NULL"),
    )
    op.create_index("ix_audit_logs_timestamp", "audit_logs", ["timestamp"])
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_resource_type", "audit_logs", ["resource_type"])
    op.create_index("ix_audit_logs_resource_id", "audit_logs", ["resource_id"])
    op.create_index("ix_audit_logs_user_time", "audit_logs", ["user_id", "timestamp"])
    op.create_index("ix_audit_logs_resource", "audit_logs", ["resource_type", "resource_id", "timestamp"])
    op.create_index("ix_audit_logs_action_time", "audit_logs", ["action", "timestamp"])

    # ------------------------------------------------------------------ system_settings
    op.create_table(
        "system_settings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("value_type", sa.String(length=20), nullable=False),
        sa.Column("category", sa.String(length=50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False),
        sa.Column("is_readonly", sa.Boolean(), nullable=False),
        sa.Column("validation_schema", sa.JSON(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_system_settings"),
        sa.UniqueConstraint("key", name="uq_system_settings_key"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], name="fk_system_settings_updated_by_users", ondelete="SET NULL"),
    )
    op.create_index("ix_system_settings_category", "system_settings", ["category"])
    op.create_index("ix_system_settings_is_deleted", "system_settings", ["is_deleted"])
    op.create_index("ix_system_settings_category_public", "system_settings", ["category", "is_public"])


def downgrade() -> None:
    # Drop in reverse dependency order
    op.drop_table("system_settings")
    op.drop_table("audit_logs")
    op.drop_table("holidays")
    op.drop_table("leave_requests")
    op.drop_table("attendance_corrections")

    # Break circular FKs before dropping
    op.drop_constraint(
        "fk_attendance_records_check_out_event_id_device_events",
        "attendance_records", type_="foreignkey",
    )
    op.drop_constraint(
        "fk_attendance_records_check_in_event_id_device_events",
        "attendance_records", type_="foreignkey",
    )
    op.drop_table("device_events")
    op.drop_table("attendance_records")
    op.drop_table("employee_shift_assignments")
    op.drop_table("shifts")
    op.drop_table("devices")
    op.drop_table("role_permissions")
    op.drop_table("user_roles")
    op.drop_table("users")
    op.drop_table("permissions")
    op.drop_table("roles")
    op.drop_constraint(
        "fk_departments_head_employee_id_employees", "departments", type_="foreignkey"
    )
    op.drop_table("employees")
    op.drop_table("positions")
    op.drop_table("departments")
