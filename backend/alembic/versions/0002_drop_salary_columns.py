"""drop salary amounts — Accounts computes pay; this system only tracks days

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("monthly_gross")
    op.execute("DELETE FROM policy_settings WHERE `key` IN ('currency_symbol', 'currency_code', 'per_day_basis', "
               "'encashment_basis')" if op.get_bind().dialect.name == "mysql" else
               "DELETE FROM policy_settings WHERE key IN ('currency_symbol', 'currency_code', 'per_day_basis', "
               "'encashment_basis')")


def downgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(sa.Column("monthly_gross", sa.Numeric(12, 2), nullable=False, server_default="0.00"))
