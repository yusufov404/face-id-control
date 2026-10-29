# FaceSys Enterprise — Security Guide

This document describes what the system actually implements, how to operate it
safely on a clinic LAN, how to test a restore, and what is **not** protected.
Nothing here should be read as a claim that the code has passed a penetration
test or that the Hikvision integration has been validated on real hardware.

---

## 1. Scope and assets

Protected assets:

- Employee personal data (names, internal IDs, device user IDs, department,
  position, hire/termination dates).
- Attendance records, raw device events, corrections and leave/holiday data.
- User accounts, password hashes, roles and permissions.
- Hikvision device credentials (encrypted at rest).
- Audit journal.
- Database backups (full copies of all of the above).

Trust boundary: the clinic LAN, the application server, the PostgreSQL server
and the Hikvision terminals. Clinic workstations and the LAN itself are assumed
to be at least partially untrusted.

---

## 2. Threat model (summary)

| Threat | Impact | Primary controls | Residual risk |
|---|---|---|---|
| Stolen user password | Impersonation, data access | Argon2id hashing, login rate limit, 10-failure/15-min lockout, audit | No MFA; a phished password works until the account is disabled |
| Malicious insider with a valid account | Unauthorized reads/corrections | Server-side RBAC, department scope (404), audit trail, correction approval | HR/Super Admin can legitimately see a lot; audit review is manual |
| ID enumeration / cross-department access | Privacy breach | Scope recomputed from DB; out-of-scope returns `404`; fail-closed when a scoped user has no department | — |
| LAN sniffing | Credential/token theft | HTTPS recommended; otherwise HTTP is cleartext | **Default install is HTTP on the LAN** |
| Stolen database backup | Full data disclosure | `0600` files, separate backup disk, filesystem permissions | **Backups are not encrypted**; use LUKS/disk encryption |
| Compromised Hikvision device | Fake attendance events | Device on isolated VLAN, dedicated credentials, audit, event metadata review | Device protocol is HTTP Digest; terminal trust is assumed |
| XSS via stored data | Token theft from `localStorage` | Output escaping (`esc`), strict Nginx CSP (`script-src 'self'`), no third-party scripts | `localStorage` is readable by any same-origin XSS |
| Ransomware / disk failure | Data loss | Daily `pg_dump` to SSD + HDD, retention, tested restore procedure | Offline/off-site copy is an operational decision, not automatic |
| Stolen `SECRET_KEY` | Token forgery, device password decryption | Env file `0640 root:facesys`, not in git | No HSM/key vault |
| Unsupported feature assumed to work | Attendance gaps presented as normal | Capability flags, explicit UI/API status, no fabricated data | Firmware differences require on-site diagnostics |

---

## 3. Authentication and sessions

### Passwords

- Hashing: **Argon2id** via `passlib` (`argon2` preferred, `bcrypt` accepted as
  a legacy fallback). Argon2 parameters: 100 MiB memory, 2 iterations,
  parallelism 8. Adjust only with a measured reason.
- Minimum new-password length is enforced by the API (8 characters for
  self-service change; the seeded Super Admin password must be at least 10).
- Passwords are never logged. Device passwords are encrypted separately.
- Login failures are audited (`auth.login.failed`) with IP and user agent.
- After **10 failed attempts** the account is locked for **15 minutes**
  (`users.locked_until`). A successful login clears the counter.
- The login endpoint is rate limited per client IP: **5 requests / 300 s** by
  default (`LOGIN_RATE_LIMIT`, `LOGIN_RATE_LIMIT_WINDOW`). The limiter is
  in-process and per worker, and its counters reset on restart.
- The rate-limit/audit IP comes from the socket peer. `X-Forwarded-For` is not
  trusted by application code; uvicorn is started with
  `--proxy-headers --forwarded-allow-ips=127.0.0.1` so only Nginx on loopback
  can supply the real client address.

### Tokens

- Access and refresh tokens are JWTs (HS256) signed with two different secrets.
- Access token: 15 minutes (`ACCESS_TOKEN_EXPIRE_MINUTES`).
- Refresh token: 7 days (`REFRESH_TOKEN_EXPIRE_DAYS`).
- Tokens are sent in `Authorization: Bearer …`; the frontend stores them in
  `localStorage`.
- On **every request** the backend reloads the user, checks `is_active` and
  `is_deleted`, recomputes roles/permissions from the database, and applies
  department scope. A token's permission snapshot is never trusted.
- Refresh checks that the user still exists and is active.

**Limitation — no revocation:** logout and password change do not invalidate
already-issued access or refresh tokens. There is no `jti` deny-list. Effective
revocation is **deactivating the user** (checked on every request and on
refresh). If a token is believed stolen, deactivate the account immediately.

**Limitation — no MFA.** Use strong unique passwords and restrict who can reach
the UI.

### CSRF

There is no CSRF middleware, and none is needed for the current design:
credentials are not sent automatically (no auth cookies), so a cross-site form
cannot authenticate. A `generate_csrf_token()` helper exists but is not wired
into any endpoint. **If you ever switch to cookie-based sessions, implement
CSRF tokens before doing so.** The `SESSION_COOKIE_*` settings are reserved and
currently have no effect.

---

## 4. Authorization and department isolation

- Permissions are defined in `backend/app/core/permissions.py`; the human
  matrix is `docs/RBAC.md`.
- Five system roles: `super_admin`, `chief_physician`, `hr_director`,
  `department_head`, `auditor`. Role permissions are also stored in the
  database; the code matrix is the fallback for system roles.
- `require_permission(...)` returns `403` when a permission is missing.
- Department scope is resolved per request. If a role is not allowed to access
  all departments:
  - the user's `department_id` becomes the scope;
  - if that field is empty, the request fails with `403` (**fail closed**)
    instead of silently granting all-department access;
  - fetching an object from another department returns `404`, so IDs cannot be
    probed for existence;
  - list filters (`department_id`, employee filters) are intersected with the
    caller's scope, never allowed to widen it.
- Super Admin cannot be granted by an HR user: role management endpoints check
  the caller's permissions and protect system roles. Review
  `backend/app/api/users.py` and `docs/RBAC.md` when changing this.
- Tests `test_rbac.py` and `test_department_isolation.py` exercise the matrix,
  the `404` behavior, and cross-department access (run them on PostgreSQL).

---

## 5. Secrets and sensitive data

### Application secrets

`/etc/facesys/facesys.env` (installed):

- owner `root:facesys`, mode `0640`;
- contains `SECRET_KEY`, `REFRESH_SECRET_KEY`, database password and backup
  paths;
- is excluded from git (`.gitignore` also excludes `.env`, keys and dumps).

Never commit a real `.env`. The repository contains only `.env.example` with
placeholders.

### Device password encryption

Hikvision passwords are encrypted with **Fernet**. The Fernet key is derived
as `SHA-256(SECRET_KEY)`. Consequences:

- The API never returns the plaintext password.
- Logs and error messages must not include it (the client never logs the
  password; `HikvisionClient.__repr__` omits it).
- **Rotating `SECRET_KEY` makes all stored device passwords undecryptable.**
  Rotate in a maintenance window: stop the service, change the key, re-enter
  every device password in the UI, then restart. All users must log in again.
- Rotating only `REFRESH_SECRET_KEY` invalidates refresh tokens but leaves
  access tokens valid until they expire.

### Data minimisation

- No biometric templates, face images, fingerprints or card numbers are stored.
- Raw ISAPI event payloads are sanitized before storage: keys that could
  contain biometrics, images, card numbers, URLs or credentials are dropped,
  strings are truncated, depth/list sizes are bounded.
- Similarity scores and verification-mode labels are stored as metadata.

### Backups contain everything

A dump includes all PII and password hashes. It inherits the application's
exposure if copied elsewhere. Protect backup disks physically and consider
LUKS full-disk encryption. Backup files are written with mode `0600`; the
backup directory is mode `0700` owned by `facesys`.

---

## 6. Transport, Nginx and browser controls

The installer configures Nginx to serve the static frontend and proxy `/api/`
and `/health` to `127.0.0.1:8000`:

- uvicorn binds loopback only (not reachable directly from the LAN);
- `server_tokens off`;
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, restrictive
  `Permissions-Policy`;
- CSP: `default-src 'self'; script-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors
  'none'; base-uri 'self'; form-action 'self'`.
  The Vite production build emits external JavaScript/CSS only, so inline
  scripts are not needed. Tailwind and chart libraries use inline `style`
  attributes, which require `style-src 'unsafe-inline'`.
- dotfiles are denied; unknown paths fall back to `index.html` so React Router
  deep links work.

**Default install is HTTP.** On a flat LAN, credentials and bearer tokens can
be captured by anyone with switch/port access. Configure HTTPS with an internal
CA or self-signed certificate (`docs/INSTALL.md` §5), distribute the CA
certificate to workstations, and add HSTS. Do not expose this service to the
internet.

All frontend dependencies are bundled into `frontend/dist`; the CSP does not
allow external script origins, so the UI stays on the LAN and does not load
assets from a CDN. Rebuild the SPA after changing dependencies with
`cd frontend && npm ci && npm run build`.

---

## 7. Database hardening

- The application uses a dedicated PostgreSQL role (`facesys`) that owns its
  database; it is not a superuser.
- Keep PostgreSQL listening on localhost only (`listen_addresses = 'localhost'`)
  and use `scram-sha-256` for TCP password auth in `pg_hba.conf`.
- Only the OS `postgres` user should have superuser access. Do not give the
  application role `CREATEDB`/`SUPERUSER`.
- The database password lives only in `/etc/facesys/facesys.env`.
- Change the database password with `ALTER ROLE facesys PASSWORD '…'`, update
  the env file, then `systemctl restart facesys`.
- Restrict OS access to the server; the `facesys` account is a system account
  with `/usr/sbin/nologin`.

Example `pg_hba.conf` lines (adjust the cluster version/paths):

```
local   all             postgres                                peer
local   all             all                                     peer
host    facesys         facesys         127.0.0.1/32            scram-sha-256
host    facesys         facesys         ::1/128                 scram-sha-256
```

---

## 8. Audit logging and retention

- Critical actions are recorded in `audit_logs` with actor, action, resource,
  old/new values, changed fields, IP, user agent, success flag and description.
  Examples: login success/failure, password change, employee create/update/
  delete/status change, attendance corrections, role/user changes, settings
  changes, backup create/restore, leave decisions.
- The API exposes read/export endpoints only; there is **no update or delete
  endpoint** for audit rows.
- A database superuser can still modify the table; protect DB access and keep
  off-host copies.
- `AUDIT_LOG_RETENTION_DAYS=365` is stored in configuration but **no automatic
  purge job exists**. Decide retention with clinic/legal policy and, if needed,
  delete older rows manually in a maintenance window, then `VACUUM`:

```sql
DELETE FROM audit_logs WHERE created_at < now() - interval '365 days';
```

  Export the journal first if retention is legally required.
- The API restore endpoint writes an audit entry and a system-journal warning
  **before** restoring. The database entry can be replaced by the restored
  dump; the journal warning remains in `journalctl -u facesys`.

---

## 9. Backups and restore testing

### What runs

- `facesys-backup.timer` starts `facesys-backup.service` daily at 02:00
  (server local time, `Persistent=true`).
- `deployment/backup/backup.sh`:
  1. `pg_dump -Fc` into `BACKUP_DIR_SSD` (partial file, mode `0600`);
  2. verifies the dump with `pg_restore --list`;
  3. renames it into place;
  4. copies it to `BACKUP_DIR_HDD` **only if** `BACKUP_HDD_MOUNT` is a real
     mounted filesystem;
  5. applies retention (7 days SSD, 90 days HDD by default).
- If the HDD is not mounted the unit exits non-zero and keeps the SSD copy.
  This is deliberate: it must not silently write the second copy onto the same
  disk.
- The UI/API backup uses the same mount check; an unmounted mountpoint is not
  treated as an HDD.

### Monthly non-destructive restore test (recommended)

This verifies the dump without touching production:

```bash
# 1. Take a fresh backup and wait for it to finish
sudo systemctl start facesys-backup.service
sudo systemctl status facesys-backup.service --no-pager
DUMP="$(ls -t /srv/facesys/backups/ssd/facesys_*.dump | head -1)"
ls -lh "$DUMP"

# 2. Restore into a scratch database
sudo -u postgres dropdb --if-exists facesys_restore_test
sudo -u postgres createdb -O facesys facesys_restore_test
sudo -u facesys -H bash -c '
  set -a; . /etc/facesys/facesys.env; set +a
  PGPASSWORD="$DATABASE_PASSWORD" pg_restore \
    -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" \
    --no-owner --no-privileges --exit-on-error \
    -d facesys_restore_test "$1"
' _ "$DUMP"

# 3. Sanity checks
sudo -u postgres psql -d facesys_restore_test -c "
  SELECT count(*) AS users FROM users;
  SELECT count(*) AS employees FROM employees;
  SELECT count(*) AS attendance FROM attendance_records;
  SELECT count(*) AS events FROM device_events;
  SELECT max(record_date) AS last_attendance FROM attendance_records;
  SELECT version_num FROM alembic_version;
"

# 4. Clean up
sudo -u postgres dropdb facesys_restore_test
```

Record the date, dump filename, row counts and any errors in the operations
log. A dump that cannot be restored is not a backup.

### Quarterly full disaster-recovery drill (staging)

Only on a staging copy or during an approved outage, because it **replaces**
production data:

```bash
sudo /opt/facesys/deployment/backup/restore.sh /srv/facesys/backups/ssd/facesys_YYYYmmdd_HHMMSS.dump
# type RESTORE when prompted
```

The script stops `facesys.service`, runs
`pg_restore --clean --if-exists --single-transaction --exit-on-error`, applies
`alembic upgrade head` (in case the dump is older than the code), starts the
service and waits for `/health`. Then verify in the UI: login, employee count,
last attendance date, audit rows, device list. Measure the time to recovery.

### API restore caveat

`POST /backups/{filename}/restore?confirm=true` exists for controlled
maintenance, but the API process keeps running with open connections while its
tables are replaced. It requires an immediate
`sudo systemctl restart facesys` afterwards. Prefer `restore.sh`, which stops
the service first.

### Retention

- SSD: 7 daily dumps (fast recovery).
- HDD: 90 daily dumps (longer history).
- Keep at least one copy offline/off-site if clinic policy requires
  ransomware protection. The system does not implement off-site replication or
  backup encryption.

---

## 10. Hikvision and biometric privacy

- The integration is **read-only** with respect to people and templates:
  device info, capabilities, time, and `AcsEvent` search. The system does not
  push users, passwords, face images or fingerprints to a terminal.
- No biometric templates, photos or card numbers are copied from the terminal.
  Raw payloads are sanitized; only event metadata (device user ID, timestamp,
  event type, verification mode, similarity) is retained.
- Device passwords are encrypted at rest; they are never returned by the API
  and never written to logs.
- The system reports only probed capabilities. `event_search_supported=false`
  means automatic ingestion cannot work for that firmware; the UI does not hide
  this. `alert_stream_supported` is informational — the poller uses `AcsEvent`
  search, not the stream.
- Manual event entry is a deliberately labelled escape hatch. Such rows are
  flagged as manual/simulated and must not be presented as device-verified
  attendance.
- Protect terminals: change default admin passwords, create a dedicated
  account if the firmware allows least privilege, put them on a restricted
  VLAN, disable unused services, and keep firmware updated.
- Device clocks must be accurate; a large drift changes the calculated
  attendance day. Diagnostics shows the drift. Use NTP on terminals.

**Not tested on hardware.** Firmware behaviour varies. Run diagnostics on each
model before relying on it and verify a known check-in/check-out pair.

---

## 11. Host and service hardening

- `facesys.service` runs as `facesys` (system user, no shell) with:
  `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome`,
  `ProtectKernelTunables/Modules`, `ProtectControlGroups`, `RestrictSUIDSGID`,
  `LockPersonality`, `UMask=0027`, and write access only to backup paths.
- Uvicorn binds `127.0.0.1` with **one worker** and trusts proxy headers only
  from `127.0.0.1`. Do not raise the worker count while polling runs inside the
  app (duplicate pollers).
- Nginx runs as its own user and serves only the frontend; the backend is not
  directly reachable from the LAN.
- Keep the OS, PostgreSQL, Nginx and Python dependencies patched. Rebuild the
  venv after dependency updates and restart the service.
- Restrict SSH to administrators, use keys, and keep the server on a management
  VLAN if possible.
- Firewall: expose only Nginx (80/443) to clinic workstations; do not expose
  PostgreSQL or uvicorn.

---

## 12. Incident response checklist

1. **Contain:** if an account is compromised, deactivate it in
   `Foydalanuvchilar` (do not rely on logout; tokens are stateless) and change
   its password. Restrict network access to the server if needed.
2. **Preserve evidence:** export the audit journal (requires `audit:export`),
   copy `journalctl -u facesys` and Nginx logs, and keep a database backup
   before changing data. Do not delete the audit table.
3. **Assess:** identify actions taken by the account/IP, affected employees and
   attendance corrections, and whether device credentials were exposed.
4. **Rotate:** database password; `REFRESH_SECRET_KEY` to end refresh sessions;
   `SECRET_KEY` only with the device-password caveat above. Re-enter device
   passwords if `SECRET_KEY` is rotated. Restart the service.
5. **Recover:** restore the last known-good dump using `restore.sh` on a
   maintenance window, verify row counts and attendance, then re-enable users.
6. **Notify:** follow clinic policy and applicable personal-data regulations.
7. **Review:** fix the root cause, add controls, and record the incident and
   recovery time.

---

## 13. Known limitations (explicit)

1. **No JWT revocation / server-side logout.** Deactivate users to revoke.
2. **Password change does not end existing sessions.**
3. **No MFA.**
4. **Login rate limiting is in-process**, per worker, resets on restart; the
   global `API_RATE_LIMIT` setting exists but is not enforced (only login is
   limited). Do not enable multiple workers without a shared limiter.
5. **HTTP by default**; TLS must be configured. Credentials/tokens are exposed
   to LAN sniffing until then.
6. **Tokens live in `localStorage`**, so a same-origin XSS could steal them.
   CSP and output escaping reduce, but do not eliminate, this risk.
7. **No automatic audit retention job**; `AUDIT_LOG_RETENTION_DAYS` is not
   applied automatically.
8. **API restore requires a service restart** and is inferior to
   `restore.sh`; it can invalidate the running process's DB connections.
9. **Backups are not encrypted** and there is no off-site replication built in.
10. **No hardware validation** of the Hikvision client; capability flags are
    probe results only.
11. **`alertStream` is not used for ingestion**; polling `AcsEvent` is the only
    implemented path.
12. **No WAF, IDS, antivirus or file-integrity monitoring** is included.
13. **Single worker** architecture for polling; scaling requires redesign.
14. **No per-field encryption of employee PII**; rely on OS/DB/disk controls.

---

## 14. Security verification checklist (before go-live)

- [ ] `DEBUG=false`, `ENVIRONMENT=production`; `/api/docs` is not public.
- [ ] `SECRET_KEY` and `REFRESH_SECRET_KEY` are unique, ≥ 32 chars, different.
- [ ] `/etc/facesys/facesys.env` is `0640 root:facesys`; no secrets in git.
- [ ] PostgreSQL listens on localhost; `facesys` is not a superuser.
- [ ] HTTPS configured with a trusted/internal certificate; HSTS enabled.
- [ ] Admin password changed from the installer value; test accounts removed.
- [ ] Roles reviewed; no unnecessary Super Admin/HR accounts; department heads
      have a department assigned (fail-closed otherwise).
- [ ] Login audit entries appear for success/failure; lockout after 10 failures.
- [ ] Department-head account cannot read another department (expect `404`).
- [ ] Backup timer enabled; a manual backup succeeds; `pg_restore --list`
      works; restore test into a scratch DB passes.
- [ ] HDD is mounted at `/mnt/backup_hdd` and the HDD copy exists.
- [ ] Reboot test: `facesys`, `nginx`, `postgresql` start automatically;
      `/health` returns 200.
- [ ] Device diagnostics: `reachable=true`, `event_search_supported=true`,
      clock drift acceptable; a test scan produces one raw event and one daily
      record.
- [ ] Logs contain no device password or bearer token.
- [ ] `pytest` suite passes on PostgreSQL (verified on Windows/PostgreSQL 17.10
      in this repository: 87 passed, 1 skipped; re-run on the target Kali host).
