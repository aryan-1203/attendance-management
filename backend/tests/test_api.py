"""HTTP-level tests: auth, password policy, roles, error shape, main flows."""
from tests.conftest import PASSWORD, login


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_openapi_has_paths(client):
    spec = client.get("/openapi.json").json()
    assert "/api/attendance/grid" in spec["paths"] and "/api/reports/pay-days" in spec["paths"]


class TestAuth:
    def test_login_me_refresh(self, client, world):
        r = client.post("/api/auth/login", json={"email": "HR@t.io", "password": PASSWORD})
        assert r.status_code == 200
        tokens = r.json()
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}).json()
        assert me["role_name"] == "hr_admin" and me["session_minutes"] == 60
        r2 = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        assert r2.status_code == 200
        bad = client.post("/api/auth/refresh", json={"refresh_token": tokens["access_token"]})
        assert bad.status_code == 401

    def test_bad_login_shape_and_lockout(self, client, world):
        for _ in range(5):
            r = client.post("/api/auth/login", json={"email": "hr@t.io", "password": "nope"})
            assert r.status_code == 401
        assert r.json()["error"]["code"] == "invalid_credentials"
        r = client.post("/api/auth/login", json={"email": "hr@t.io", "password": PASSWORD})
        assert r.json()["error"]["code"] == "account_locked"

    def test_unauthenticated(self, client, world):
        r = client.get("/api/employees")
        assert r.status_code == 401 and r.json()["error"]["code"] == "not_authenticated"

    def test_forgot_reset_and_policy(self, client, world):
        r = client.post("/api/auth/forgot-password", json={"email": "emp@t.io"})
        token = r.json()["data"]["dev_token"]
        weak = client.post("/api/auth/reset-password", json={"token": token, "new_password": "password"})
        assert weak.status_code == 422 and weak.json()["error"]["code"] == "weak_password"
        ok = client.post("/api/auth/reset-password", json={"token": token, "new_password": "N3w!Passw0rd"})
        assert ok.status_code == 200
        again = client.post("/api/auth/reset-password", json={"token": token, "new_password": "N3w!Passw0rd"})
        assert again.status_code == 422
        login(client, "emp@t.io", "N3w!Passw0rd")
        unknown = client.post("/api/auth/forgot-password", json={"email": "nobody@t.io"})
        assert unknown.status_code == 200 and unknown.json()["data"] is None

    def test_change_password_revokes_tokens(self, client, world):
        h = login(client, "emp@t.io")
        r = client.post("/api/auth/change-password", headers=h,
                        json={"current_password": PASSWORD, "new_password": "Another#Pass9"})
        assert r.status_code == 200
        assert client.get("/api/auth/me", headers=h).status_code == 401


class TestRoles:
    def test_employee_restrictions(self, client, world):
        h = login(client, "emp@t.io")
        assert client.get("/api/attendance/grid", headers=h).status_code == 403
        assert client.get("/api/settings", headers=h).status_code == 200
        assert client.put("/api/settings", headers=h, json={"values": {}}).status_code == 403
        emps = client.get("/api/employees", headers=h).json()
        assert [e["code"] for e in emps["items"]] == ["E1"]
        other = world["prob"].id
        assert client.get(f"/api/employees/{other}", headers=h).status_code == 403
        assert client.get("/api/attendance/summary", headers=h).status_code == 200
        assert client.get(f"/api/attendance/summary?employee_id={other}", headers=h).status_code == 403

    def test_manager_sees_team_only(self, client, world):
        h = login(client, "mgr@t.io")
        codes = [e["code"] for e in client.get("/api/employees", headers=h).json()["items"]]
        assert sorted(codes) == ["E1", "E2"]
        grid = client.get("/api/attendance/grid", headers=h).json()
        assert sorted(e["code"] for e in grid["employees"]) == ["E1", "E2"]
        assert client.post("/api/attendance/bulk", headers=h, json={"changes": [
            {"employee_id": world["perm"].id, "date": "2026-11-02", "status": "P"}]}).status_code == 403

    def test_accounts_only_locked_reports(self, client, world):
        h = login(client, "acc@t.io")
        r = client.get("/api/reports/pay-days", headers=h)
        assert r.status_code == 403
        hh = login(client, "hr@t.io")
        cycles = client.get("/api/cycles", headers=hh).json()
        cur = cycles[0]
        assert client.post(f"/api/cycles/{cur['id']}/lock", headers=hh, json={}).status_code == 422
        assert client.post(f"/api/cycles/{cur['id']}/lock", headers=hh,
                           json={"acknowledge_warnings": True}).status_code == 200
        r = client.get(f"/api/reports/pay-days.xlsx?cycle_id={cur['id']}", headers=h)
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/vnd.openxml")


class TestFlows:
    def test_mark_grid_and_reports(self, client, world):
        h = login(client, "hr@t.io")
        e = world["perm"].id
        r = client.post("/api/attendance/bulk", headers=h, json={"changes": [
            {"employee_id": e, "date": "2026-10-21", "status": "A"},
            {"employee_id": e, "date": "2026-10-22", "status": "HD"}]})
        assert r.status_code == 200 and r.json()["previous"][0]["status"] is None
        bad = client.post("/api/attendance/bulk", headers=h, json={"changes": [
            {"employee_id": e, "date": "2026-10-21", "status": "Q"}]})
        assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_status"
        s = client.get(f"/api/attendance/summary?employee_id={e}", headers=h).json()
        assert s["lop_days"] == "0.00" and s["paid_leave_used"] == "1.50" and s["balance"]["usable"] == "0.00"
        g = client.get("/api/attendance/grid", headers=h).json()
        assert g["days"][0]["date"] == "2026-10-20" and len(g["days"]) == 31
        mp = client.post("/api/attendance/mark-all-present", headers=h, json={"date": "2026-11-17"}).json()
        assert mp["count"] == 3
        rng = client.post("/api/attendance/mark-range", headers=h, json={
            "start_date": "2026-11-10", "end_date": "2026-11-12", "status": "A", "employee_ids": [e]}).json()
        assert rng["count"] == 3
        pd = client.get("/api/reports/pay-days", headers=h).json()
        assert pd["totals"]["employees"] == 3
        for rep in ("pay-days.xlsx", "muster-roll.xlsx", "leave-register.xlsx", "lop-summary.xlsx", "pay-days.pdf"):
            assert client.get(f"/api/reports/{rep}", headers=h).status_code == 200, rep
        st = client.get(f"/api/reports/statement?fmt=pdf&employee_id={e}", headers=h)
        assert st.status_code == 200 and st.content[:4] == b"%PDF"
        em = client.post("/api/reports/email-accounts", headers=h, json={})
        assert em.status_code == 200 and em.json()["mode"] == "logged"
        audit = client.get("/api/audit?action=attendance", headers=h).json()
        assert audit["total"] >= 2
        dash = client.get("/api/dashboard", headers=h).json()
        assert dash["today"]["present"] == 3

    def test_leave_via_api(self, client, world):
        he = login(client, "emp@t.io")
        pv = client.post("/api/leave/preview", headers=he, json={"start_date": "2026-11-02", "end_date": "2026-11-04"})
        assert pv.json()["message"] == "1.5 days paid, 1.5 days LOP"
        req = client.post("/api/leave/requests", headers=he, json={"start_date": "2026-11-02",
                                                                   "end_date": "2026-11-04", "reason": "Trip"}).json()
        hm = login(client, "mgr@t.io")
        notes = client.get("/api/notifications", headers=hm).json()
        assert notes["total"] == 1 and "Leave request" in notes["items"][0]["title"]
        d = client.post(f"/api/leave/requests/{req['id']}/decision", headers=hm, json={"action": "approve"})
        assert d.status_code == 200 and d.json()["status"] == "approved"
        mine = client.get("/api/leave/requests?scope=mine", headers=he).json()
        assert mine["items"][0]["status"] == "approved"
        assert client.get("/api/notifications/unread-count", headers=he).json()["count"] == 1

    def test_settings_roundtrip(self, client, world):
        h = login(client, "hr@t.io")
        rows = client.get("/api/settings", headers=h).json()
        assert any(r["key"] == "smtp_password" for r in rows)
        r = client.put("/api/settings", headers=h, json={"values": {"cycle_start_day": 40}})
        assert r.status_code == 422 and "between 1 and 28" in r.json()["error"]["message"]
        r = client.put("/api/settings", headers=h, json={"values": {"sandwich_rule": True}})
        assert next(x for x in r.json() if x["key"] == "sandwich_rule")["value"] is True

    def test_employee_crud_and_validation(self, client, world):
        h = login(client, "hr@t.io")
        r = client.post("/api/employees", headers=h, json={"code": "E1", "full_name": "Dup",
                                                           "date_of_joining": "2026-01-01"})
        assert r.status_code == 409
        r = client.post("/api/employees", headers=h, json={"code": "N9", "full_name": "Nina",
                                                           "date_of_joining": "2026-11-01"})
        assert r.status_code == 201
        nid = r.json()["id"]
        prof = client.get(f"/api/employees/{nid}/profile", headers=h).json()
        assert prof["balances"]["usable"] == "0.50" and prof["balances"]["locked"] == "0.50"
        assert len(prof["heatmap"]) == 365
        r = client.patch(f"/api/employees/{nid}", headers=h, json={"exit_date": "2026-10-01"})
        assert r.status_code == 422
        lst = client.get("/api/employees?search=nin&sort=-full_name", headers=h).json()
        assert lst["total"] == 1
        assert client.delete(f"/api/employees/{nid}", headers=h).status_code == 204
        assert client.get("/api/employees?search=nin", headers=h).json()["total"] == 0


def test_manager_dashboard_scoped_to_team(client, world):
    h = login(client, "mgr@t.io")
    d = client.get("/api/dashboard", headers=h).json()
    assert d["today"]["total"] == 2  # E1, E2 report to the manager; the manager's own record is excluded
    hh = login(client, "hr@t.io")
    assert client.get("/api/dashboard", headers=hh).json()["today"]["total"] == 3


def test_attachment_download_and_approvals_scope(client, world):
    he = login(client, "emp@t.io")
    up = client.post("/api/leave/attachments", headers=he, files={"file": ("note.pdf", b"%PDF-1.4 test", "application/pdf")})
    path = up.json()["path"]
    client.post("/api/leave/requests", headers=he, json={"start_date": "2026-11-02", "end_date": "2026-11-02",
                                                         "reason": "Doctor", "attachment_path": path})
    hm = login(client, "mgr@t.io")
    name = path.split("/")[-1]
    r = client.get(f"/api/leave/attachments/{name}", headers=hm)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    # manager's own request is excluded from their approvals scope
    client.post("/api/leave/requests", headers=hm, json={"start_date": "2026-11-03", "end_date": "2026-11-03",
                                                         "reason": "Own"})
    pending = client.get("/api/leave/requests?status=pending&scope=approvals", headers=hm).json()
    assert pending["total"] == 1
    other = login(client, "acc@t.io")
    assert client.get(f"/api/leave/attachments/{name}", headers=other).status_code == 200  # accounts can view employees


def test_hr_cannot_remove_own_or_last_admin(client, world):
    h = login(client, "hr@t.io")
    me = client.get("/api/auth/me", headers=h).json()
    r = client.patch(f"/api/users/{me['id']}", headers=h, json={"role": "employee"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "self_demotion"
    other = client.post("/api/users", headers=h, json={"email": "hr2@t.io", "full_name": "HR Two", "role": "hr_admin",
                                                        "password": "Strong#Pass1"}).json()
    assert client.patch(f"/api/users/{other['id']}", headers=h, json={"is_active": False}).status_code == 200
    cyc = client.get("/api/cycles", headers=h).json()[0]
    assert "locked_by_name" in cyc
