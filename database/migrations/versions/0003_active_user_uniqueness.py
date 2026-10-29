"""Scope user uniqueness to live rows

Users are soft-deleted, but ``uq_users_username`` / ``uq_users_email`` /
``uq_users_employee_id`` were plain UNIQUE constraints. A removed account kept
its login and email reserved forever, so re-adding the same person failed with a
database error (HTTP 500). Replace them with partial unique indexes that only
cover rows where ``is_deleted = false``.

Revision ID: 0003_active_user_uniqueness
Revises: 0002_emp_dev_map_roles
Create Date: 2026-10-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0003_active_user_uniqueness"
down_revision: Union[str, None] = "0002_emp_dev_map_roles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.drop_constraint("uq_users_employee_id", "users", type_="unique")

    op.create_index(
        "uq_users_username_active",
        "users",
        ["username"],
        unique=True,
        postgresql_where=sa.text("is_deleted IS false"),
    )
    op.create_index(
        "uq_users_email_active",
        "users",
        ["email"],
        unique=True,
        postgresql_where=sa.text("is_deleted IS false"),
    )
    op.create_index(
        "uq_users_employee_id_active",
        "users",
        ["employee_id"],
        unique=True,
        postgresql_where=sa.text("employee_id IS NOT NULL AND is_deleted IS false"),
    )


def downgrade() -> None:
    op.drop_index("uq_users_employee_id_active", table_name="users")
    op.drop_index("uq_users_email_active", table_name="users")
    op.drop_index("uq_users_username_active", table_name="users")

    op.create_unique_constraint("uq_users_employee_id", "users", ["employee_id"])
    op.create_unique_constraint("uq_users_email", "users", ["email"])
    op.create_unique_constraint("uq_users_username", "users", ["username"])
