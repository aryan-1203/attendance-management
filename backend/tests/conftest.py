import os
import tempfile

os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "sqlite://")
os.environ["ENABLE_SCHEDULER"] = "false"
_tmp = tempfile.mkdtemp(prefix="prosparity-test-")
os.environ["UPLOAD_DIR"] = os.path.join(_tmp, "uploads")
os.environ["REPORT_DIR"] = os.path.join(_tmp, "reports")

from datetime import date  # noqa: E402
from decimal import Decimal  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import Department, Employee, Role, User  # noqa: E402
from app.services import policy_service  # noqa: E402
from app.utils import timeutil  # noqa: E402

TODAY = date(2026, 11, 17)
PASSWORD = "Test@1234"


@pytest.fixture(autouse=True)
def _schema():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    timeutil.set_today(TODAY)
    yield
    timeutil.set_today(None)


@pytest.fixture
def db():
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture
def world(db):
    """Roles, policy defaults, a department, HR/manager/employee/accounts users and a few employees."""
    policy_service.seed_defaults(db)
    roles = {n: Role(name=n) for n in ("hr_admin", "manager", "employee", "accounts")}
    db.add_all(roles.values())
    dep = Department(name="Engineering", code="ENG")
    db.add(dep)
    db.flush()
    mgr = Employee(code="M1", full_name="Mona Manager", department_id=dep.id, date_of_joining=date(2020, 1, 1),
                   employment_type="permanent")
    db.add(mgr)
    db.flush()
    perm = Employee(code="E1", full_name="Pat Permanent", department_id=dep.id, manager_id=mgr.id,
                    date_of_joining=date(2024, 1, 1), employment_type="permanent")
    prob = Employee(code="E2", full_name="Pia Probation", department_id=dep.id, manager_id=mgr.id,
                    date_of_joining=date(2026, 7, 20), employment_type="probation")
    db.add_all([perm, prob])
    db.flush()
    pw = hash_password(PASSWORD)
    users = {
        "hr": User(email="hr@t.io", full_name="Hana HR", role_id=roles["hr_admin"].id, password_hash=pw),
        "manager": User(email="mgr@t.io", full_name="Mona Manager", role_id=roles["manager"].id, password_hash=pw,
                        employee_id=mgr.id),
        "employee": User(email="emp@t.io", full_name="Pat Permanent", role_id=roles["employee"].id,
                         password_hash=pw, employee_id=perm.id),
        "accounts": User(email="acc@t.io", full_name="Acc Ounts", role_id=roles["accounts"].id, password_hash=pw),
    }
    db.add_all(users.values())
    db.commit()
    return {"db": db, "users": users, "perm": perm, "prob": prob, "mgr": mgr, "dep": dep}


@pytest.fixture
def client():
    from app.main import app
    with TestClient(app) as c:
        yield c


def login(client, email, password=PASSWORD):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
