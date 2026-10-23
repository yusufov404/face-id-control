"""Authentication tests: login, lockout, refresh, password change, /me."""
from datetime import datetime, timezone


from app.core.permissions import Permission, Role

API = "/api/v1"


async def test_login_success_returns_tokens(client, make_user):
    user, _ = await make_user(Role.HR_DIRECTOR)
    r = await client.post(f"{API}/auth/login", json={
        "username": user.username, "password": "TestPassphrase123!",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0


async def test_login_accepts_email(client, make_user):
    user, _ = await make_user(Role.AUDITOR)
    r = await client.post(f"{API}/auth/login", json={
        "username": user.email, "password": "TestPassphrase123!",
    })
    assert r.status_code == 200


async def test_login_wrong_password_and_unknown_user(client, make_user):
    user, _ = await make_user(Role.AUDITOR)
    r = await client.post(f"{API}/auth/login", json={
        "username": user.username, "password": "wrong-password",
    })
    assert r.status_code == 401

    r = await client.post(f"{API}/auth/login", json={
        "username": "does-not-exist", "password": "whatever",
    })
    assert r.status_code == 401


async def test_login_inactive_user_rejected(client, make_user):
    user, _ = await make_user(Role.AUDITOR, is_active=False)
    r = await client.post(f"{API}/auth/login", json={
        "username": user.username, "password": "TestPassphrase123!",
    })
    assert r.status_code == 403


async def test_account_locks_after_ten_failures(client, db, make_user):
    user, _ = await make_user(Role.AUDITOR)

    for _ in range(10):
        r = await client.post(f"{API}/auth/login", json={
            "username": user.username, "password": "wrong-password",
        })
        assert r.status_code == 401, r.text

    await db.refresh(user)
    assert user.locked_until is not None
    locked = user.locked_until
    if locked.tzinfo is None:  # SQLite harness drops tzinfo
        locked = locked.replace(tzinfo=timezone.utc)
    assert locked > datetime.now(timezone.utc)

    # Even the correct password is refused while locked.
    r = await client.post(f"{API}/auth/login", json={
        "username": user.username, "password": "TestPassphrase123!",
    })
    assert r.status_code == 423


async def test_successful_login_resets_failed_counter(client, db, make_user):
    user, _ = await make_user(Role.AUDITOR)
    user.failed_login_attempts = 4
    await db.flush()

    r = await client.post(f"{API}/auth/login", json={
        "username": user.username, "password": "TestPassphrase123!",
    })
    assert r.status_code == 200
    await db.refresh(user)
    assert user.failed_login_attempts == 0
    assert user.last_login is not None


async def test_me_returns_effective_permissions(client, make_user):
    user, headers = await make_user(Role.CHIEF_PHYSICIAN)
    r = await client.get(f"{API}/auth/me", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["username"] == user.username
    assert Role.CHIEF_PHYSICIAN.value in body["roles"]
    assert Permission.ATTENDANCE_READ.value in body["permissions"]
    assert Permission.EMPLOYEE_CREATE.value not in body["permissions"]
    # Chief physician sees all departments
    assert body["department_scope"] is None
    assert body["is_superuser"] is False


async def test_me_department_scope_for_department_head(client, make_user, dept_factory):
    dept = await dept_factory("Kardiologiya", "CARDIO")
    user, headers = await make_user(Role.DEPARTMENT_HEAD, department_id=dept.id)
    r = await client.get(f"{API}/auth/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["department_scope"] == dept.id


async def test_me_requires_valid_token(client, make_user):
    r = await client.get(f"{API}/auth/me")
    assert r.status_code == 401

    r = await client.get(f"{API}/auth/me", headers={"Authorization": "Bearer not-a-token"})
    assert r.status_code == 401


async def test_deleted_user_token_rejected(client, db, make_user):
    user, headers = await make_user(Role.AUDITOR)
    user.is_deleted = True
    user.deleted_at = datetime.now(timezone.utc)
    await db.flush()

    r = await client.get(f"{API}/auth/me", headers=headers)
    assert r.status_code == 401


async def test_refresh_rotates_access_token(client, make_user):
    user, _ = await make_user(Role.AUDITOR)
    login = await client.post(f"{API}/auth/login", json={
        "username": user.username, "password": "TestPassphrase123!",
    })
    refresh_token = login.json()["refresh_token"]

    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": refresh_token})
    assert r.status_code == 200, r.text
    new_access = r.json()["access_token"]

    me = await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {new_access}"})
    assert me.status_code == 200


async def test_access_token_cannot_be_used_as_refresh(client, make_user):
    user, headers = await make_user(Role.AUDITOR)
    access = headers["Authorization"].split(" ", 1)[1]
    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": access})
    assert r.status_code == 401

    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": "garbage"})
    assert r.status_code == 401


async def test_change_password_flow(client, make_user):
    user, headers = await make_user(Role.AUDITOR)

    r = await client.post(f"{API}/auth/change-password", headers=headers, json={
        "current_password": "wrong", "new_password": "AnotherPassphrase456!",
    })
    assert r.status_code == 400

    r = await client.post(f"{API}/auth/change-password", headers=headers, json={
        "current_password": "TestPassphrase123!",
        "new_password": "AnotherPassphrase456!",
    })
    assert r.status_code == 200

    old = await client.post(f"{API}/auth/login", json={
        "username": user.username, "password": "TestPassphrase123!",
    })
    assert old.status_code == 401

    new = await client.post(f"{API}/auth/login", json={
        "username": user.username, "password": "AnotherPassphrase456!",
    })
    assert new.status_code == 200


async def test_login_writes_audit_entry(client, db, make_user):
    from sqlalchemy import select
    from app.models.audit import AuditLog

    user, _ = await make_user(Role.AUDITOR)
    await client.post(f"{API}/auth/login", json={
        "username": user.username, "password": "TestPassphrase123!",
    })
    rows = (await db.execute(
        select(AuditLog).where(AuditLog.action == "auth.login", AuditLog.user_id == user.id)
    )).scalars().all()
    assert len(rows) == 1
    assert rows[0].success is True
