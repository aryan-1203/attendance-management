"""add function_manager_id for Function Head alongside reporting manager

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-26
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(sa.Column("function_manager_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_employees_function_manager_id",
            "employees",
            ["function_manager_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index(batch.f("ix_employees_function_manager_id"), ["function_manager_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.drop_index(batch.f("ix_employees_function_manager_id"))
        batch.drop_constraint("fk_employees_function_manager_id", type_="foreignkey")
        batch.drop_column("function_manager_id")
