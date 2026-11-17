#!/bin/sh
set -e
python - <<'PY'
import time, sys
from sqlalchemy import text
from app.core.database import engine
for i in range(60):
    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
        break
    except Exception as exc:  # noqa: BLE001
        print(f"waiting for database ({exc.__class__.__name__})…", flush=True)
        time.sleep(2)
else:
    sys.exit("database not reachable")
PY
alembic upgrade head
if [ "${SEED_DEMO:-false}" = "true" ]; then
  python -m app.seed
fi
exec "$@"
