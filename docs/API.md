# FaceSys Enterprise — API Reference

Base URL: **`/api/v1`** (same origin as the frontend).
Interactive docs (only when `DEBUG=true`): `/api/docs`, OpenAPI JSON at `/api/openapi.json`.
Health check (no auth): **`GET /health`**.

All request and response bodies are JSON unless a report is exported
(`.xlsx` or `.pdf`). Timestamps are ISO-8601 UTC; business dates
(`record_date`, `date_from`, …) are calendar dates in **Asia/Tashkent**.

---

## 1. Authentication

### `POST /auth/login`

```json
{ "username": "admin", "password": "…" }
```

`username` accepts either the login name or the e-mail address.

Response `200`:

```json
{
  "access_token": "eyJ…",
  "refresh_token": "eyJ…",
  "token_type": "bearer",
  "expires_in": 900
}
```

The frontend sends the access token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

Access tokens live 15 minutes (configurable), refresh tokens 7 days.
The backend recomputes the user's roles and permissions from the database on
**every request**; permissions embedded in a token are never trusted.

| Error | Meaning |
|---|---|
| `401` | wrong credentials / unknown user |
| `403` | user is inactive or soft-deleted |
| `423` | account locked (10 failed attempts → 15 minutes) |
| `429` | login rate limit exceeded (5 attempts / 5 minutes per IP by default) |

### `POST /auth/refresh`

```json
{ "refresh_token": "…" }
```

Returns a new token pair. An access token cannot be used here (`401`).

### `GET /auth/me`

Returns the current user, effective permissions, roles, and department scope.

```json
{
  "id": 1,
  "username": "admin",
  "email": "admin@facesys.local",
  "full_name": "Tizim administratori",
  "is_superuser": true,
  "roles": ["super_admin"],
  "permissions": ["user:create", "…"],
  "department_scope": null
}
```

`department_scope` is `null` for roles that may see all departments, otherwise
it is the user's `department_id`.

### `POST /auth/change-password`

```json
{ "current_password": "…", "new_password": "…" }
```

Minimum length 8. Writes an `auth.password_change` audit entry.
**Limitation:** stateless JWTs already issued are not revoked by a password
change (see `docs/SECURITY.md`).

### `POST /auth/logout`

Client-side token discard; writes an audit entry. JWTs are stateless, so this
does not invalidate the token server-side.

---

## 2. Conventions

### Pagination

List endpoints accept `page` (≥ 1) and `page_size` (1–100; some default to 50)
and return:

```json
{
  "items": [ … ],
  "total": 1043,
  "page": 2,
  "page_size": 20,
  "pages": 53
}
```

### Errors

```json
{ "detail": "Xodim topilmadi" }
```

Validation errors (`422`) additionally contain a human-readable `errors` list:

```json
{
  "detail": "Ma'lumotlar validatsiyadan o'tmadi",
  "errors": ["name: String should have at least 1 character"]
}
```

| Status | Meaning |
|---|---|
| `400` | invalid filter value / business rule violation |
| `401` | missing, invalid, or expired token |
| `403` | authenticated but missing permission |
| `404` | object does not exist **or is outside the caller's department** |
| `409` | duplicate value / conflicting state (e.g. manual record recalc) |
| `422` | request body validation failed |
| `423` | account locked |
| `429` | rate limited |

**Department isolation:** for users whose role is restricted to one
department, objects belonging to another department return `404`, not `403`,
so IDs cannot be enumerated. Filters such as `department_id` are intersected
with the caller's scope, never used to widen it.

### Typical permissions

| Permission | Grants |
|---|---|
| `employee:read` / `employee:create` / `employee:update` / `employee:delete` / `employee:change_status` | employee lifecycle |
| `attendance:read` / `attendance:correct` / `attendance:correct_all` | daily records, corrections, approval |
| `shift:read` / `shift:create` / `shift:update` / `shift:delete` / `shift:assign` | shifts and assignments |
| `leave:read` / `leave:create` / `leave:approve` | leaves |
| `holiday:read` / `holiday:create` / `holiday:delete` | holidays |
| `device:read` / `device:create` / `device:update` / `device:delete` / `device:sync` / `device:view_logs` | Hikvision devices |
| `user:*`, `role:*` | users, roles, role permissions |
| `report:view` / `report:export` / `report:dashboard` | reports and dashboard |
| `audit:read` / `audit:export` | audit journal |
| `settings:read` / `settings:update` / `settings:backup` / `settings:restore` | system settings and backups |

The authoritative matrix is `backend/app/core/permissions.py`; a human-readable
version is in `docs/RBAC.md`.

---

## 3. Endpoints

### 3.1 Departments

| Method | Path | Permission |
|---|---|---|
| `GET` | `/departments` | `department:read` |
| `GET` | `/departments/options` | `department:read` |
| `POST` | `/departments` | `department:create` |
| `GET` | `/departments/{dept_id}` | `department:read` |
| `PATCH` | `/departments/{dept_id}` | `department:update` |
| `DELETE` | `/departments/{dept_id}` | `department:delete` |

`GET /departments` filters: `page`, `page_size`, `search`, `is_active`.
`GET /departments/options` returns `[{id, name, code}]` for select boxes, already
restricted by department scope.

Create body:

```json
{
  "name": "Kardiologiya",
  "code": "CARD",
  "description": null,
  "parent_id": null,
  "head_employee_id": null,
  "sort_order": 0,
  "is_active": true
}
```

`code` must match `^[A-Za-z0-9_-]+$` and is unique. Delete requires the
department to be empty of active employees.

### 3.2 Positions

| Method | Path | Permission |
|---|---|---|
| `GET` | `/positions` | `position:read` |
| `POST` | `/positions` | `position:create` |
| `PATCH` | `/positions/{position_id}` | `position:update` |
| `DELETE` | `/positions/{position_id}` | `position:delete` |

Filters: `page`, `page_size`, `search`, `department_id`, `is_active`.

### 3.3 Employees

| Method | Path | Permission |
|---|---|---|
| `GET` | `/employees` | `employee:read` |
| `GET` | `/employees/{employee_id}` | `employee:read` |
| `POST` | `/employees` | `employee:create` |
| `PATCH` | `/employees/{employee_id}` | `employee:update` |
| `POST` | `/employees/{employee_id}/status` | `employee:change_status` |
| `DELETE` | `/employees/{employee_id}` | `employee:delete` |

Filters: `page`, `page_size`, `search` (name, internal ID, device user ID,
phone), `department_id`, `position_id`, `status`.

Create body:

```json
{
  "internal_id": "EMP-0001",
  "device_user_id": "1001",
  "first_name": "Ali",
  "last_name": "Valiyev",
  "middle_name": "Akmalovich",
  "hire_date": "2024-01-01",
  "department_id": 1,
  "position_id": 2,
  "status": "active"
}
```

`internal_id` and `device_user_id` are **separate identifiers**:
`internal_id` is generated/used by FaceSys, `device_user_id` is the number
enrolled on the Hikvision terminal. Both are unique (`409` on duplicates).

`POST /employees/{id}/status`:

```json
{ "status": "terminated", "termination_date": "2026-01-31", "reason": "…" }
```

Delete is a soft delete: the employee disappears from lists, but attendance
history remains and is still readable.

### 3.4 Users, roles and permissions

| Method | Path | Permission |
|---|---|---|
| `GET` | `/users` | `user:read` |
| `POST` | `/users` | `user:create` |
| `GET` | `/users/{user_id}` | `user:read` |
| `PATCH` | `/users/{user_id}` | `user:update` |
| `PUT` | `/users/{user_id}/roles` | `user:assign_role` |
| `DELETE` | `/users/{user_id}` | `user:delete` |
| `GET` | `/roles` | `role:read` |
| `GET` | `/roles/{role_id}/permissions` | `role:read` |
| `PUT` | `/roles/{role_id}/permissions` | `role:assign_permission` |
| `GET` | `/permissions` | `role:read` |

Create body: `username`, `email`, `password` (min 8), `full_name`, optional
`phone`, `department_id`, `employee_id`, `role_ids`, `is_active`.

Role assignment: `{ "role_ids": [2, 4], "expires_at": null }`. The guard in
`users.py` prevents an HR user from granting `super_admin`; system roles cannot
be edited by non-Super-Admins. Deactivating a user (`is_active=false`) is the
effective way to revoke existing JWTs. You cannot delete your own account.

Role permissions update: `{ "permission_ids": [1, 2, 3] }` (full replacement).

### 3.5 Attendance

| Method | Path | Permission |
|---|---|---|
| `GET` | `/attendance` | `attendance:read` |
| `GET` | `/attendance/{record_id}` | `attendance:read` |
| `POST` | `/attendance/{record_id}/recalculate` | `attendance:correct` |
| `POST` | `/attendance/corrections` | `attendance:correct` |
| `GET` | `/attendance/corrections/list` | `attendance:read` |
| `POST` | `/attendance/corrections/{correction_id}/approve` | `attendance:correct_all` |

`GET /attendance` filters: `page`, `page_size`, `date_from`, `date_to`,
`employee_id`, `department_id`, `status`, `search`.

A record is one employee/day:

```json
{
  "id": 42,
  "employee_id": 7,
  "employee_name": "Valiyev Ali Akmalovich",
  "department_id": 1,
  "department_name": "Kardiologiya",
  "record_date": "2026-03-02",
  "shift_id": 1,
  "shift_name": "Kunduzgi smena",
  "scheduled_check_in": "08:00:00",
  "scheduled_check_out": "17:00:00",
  "actual_check_in": "2026-03-02T03:00:00Z",
  "actual_check_out": "2026-03-02T12:00:00Z",
  "status": "present",
  "late_minutes": 0,
  "early_leave_minutes": 0,
  "work_minutes": 540,
  "overtime_minutes": 0,
  "break_minutes": 60,
  "is_manual": false,
  "is_confirmed": false,
  "notes": null
}
```

Statuses: `present`, `late`, `early_leave`, `late_and_early`, `absent`,
`on_leave`, `holiday`, `weekend`, `not_scheduled`, `incomplete`, `unknown`.

`POST /attendance/{record_id}/recalculate` recomputes the day from raw events.
If the record is manual (`is_manual=true`) it returns `409` — automatic
recalculation never overwrites a human correction.

Correction body:

```json
{
  "attendance_record_id": 42,
  "correction_type": "check_in",
  "field_name": "actual_check_in",
  "new_check_in": "2026-03-02T08:45:00+05:00",
  "reason": "Xodim kechikish sababini hujjat bilan tasdiqladi"
}
```

`correction_type` is `check_in`, `check_out`, or `status`; `reason` is
mandatory (min 3 chars). The endpoint:

1. writes `AttendanceCorrection` (original and new values, author, reason),
2. updates the daily record and marks it `is_manual=true, is_confirmed=true`,
3. writes an `attendance.correct` audit entry with old/new values,
4. **never modifies or deletes raw `device_events`** — the raw log stays intact.

Corrections list filters: `page`, `page_size`, `employee_id`, `is_approved`.
Approval (`attendance:correct_all`) sets `is_approved` and the approver.

### 3.6 Shifts and assignments

| Method | Path | Permission |
|---|---|---|
| `GET` | `/shifts` | `shift:read` |
| `POST` | `/shifts` | `shift:create` |
| `PATCH` | `/shifts/{shift_id}` | `shift:update` |
| `DELETE` | `/shifts/{shift_id}` | `shift:delete` |
| `GET` | `/shift-assignments` | `shift:read` |
| `POST` | `/shift-assignments` | `shift:assign` |

Shift body (times `HH:MM`):

```json
{
  "name": "Tungi smena",
  "code": "NIGHT",
  "start_time": "22:00",
  "end_time": "06:00",
  "crosses_midnight": true,
  "late_threshold": 15,
  "early_leave_threshold": 15,
  "min_work_minutes": 480,
  "break_duration": 0,
  "applicable_days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
  "is_active": true
}
```

An empty `applicable_days` means every day. `crosses_midnight` is derived when
`end_time <= start_time`; for night shifts the logical work date is the date the
shift **started**. Morning check-outs up to the midpoint between shift end and
the next start (14:00 for 22:00–06:00) still belong to the previous work day.

Assignment body: `employee_id`, `shift_id`, `start_date`, `end_date` (nullable),
`priority`, `is_active`.

### 3.7 Leaves and holidays

| Method | Path | Permission |
|---|---|---|
| `GET` | `/leaves` | `leave:read` |
| `POST` | `/leaves` | `leave:create` |
| `POST` | `/leaves/{leave_id}/decision` | `leave:approve` |
| `GET` | `/holidays` | `holiday:read` |
| `POST` | `/holidays` | `holiday:create` |
| `DELETE` | `/holidays/{holiday_id}` | `holiday:delete` |

Leave body: `employee_id`, `leave_type` (`annual`, `sick`, `maternity`,
`paternity`, `unpaid`, `study`, `marriage`, `bereavement`, `other`),
`start_date`, `end_date`, `total_days`, `reason`.

Decision body: `{ "status": "approved" | "rejected", "decision_note": "…" }`.
Approved leave makes the attendance engine emit `on_leave` for those days.

Holiday body: `{ "name": "Navro'z", "date": "2026-03-21", "applies_to_all": true, "department_id": null, "is_working_day": false }`.
Holidays are honoured before check-in/out calculation.

### 3.8 Hikvision devices

| Method | Path | Permission |
|---|---|---|
| `GET` | `/devices` | `device:read` |
| `POST` | `/devices` | `device:create` |
| `GET` | `/devices/{device_id}` | `device:read` |
| `PATCH` | `/devices/{device_id}` | `device:update` |
| `DELETE` | `/devices/{device_id}` | `device:delete` |
| `POST` | `/devices/{device_id}/diagnose` | `device:read` |
| `POST` | `/devices/{device_id}/sync` | `device:sync` |
| `GET` | `/devices/{device_id}/events` | `device:view_logs` |
| `POST` | `/devices/events/manual` | `device:sync` (Super Admin) |

Create body: `name`, `serial_number`, `ip_address`, `port`, `username`,
`password`, `connection_type` (`http`/`https`), `device_type`, `department_id`,
`sync_enabled`, `sync_interval`, `timeout`, `retry_attempts`.

The device password is encrypted at rest (Fernet, key derived from
`SECRET_KEY`); it is never returned by the API and never logged.

`POST /devices/{id}/diagnose` performs read-only ISAPI probes and returns an
honest capability report:

```json
{
  "reachable": true,
  "model": "DS-K1T343MWX",
  "firmware": "V3.…",
  "alert_stream_supported": true,
  "event_search_supported": true,
  "time_sync_supported": true,
  "time_drift_seconds": 2,
  "capabilities": {"alert_stream": true, "event_search": true, "time_sync": true, "user_info": false},
  "errors": []
}
```

`event_search_supported=false` means the poller will not ingest from that
device; the UI shows this explicitly instead of pretending it works.

`POST /devices/events/manual` is a Super-Admin-only escape hatch used when a
terminal cannot be integrated. Manual events are clearly marked as manual in
the database and UI; they are never mixed with device events.

### 3.9 Dashboard

| Method | Path | Permission |
|---|---|---|
| `GET` | `/dashboard/stats` | `report:dashboard` |
| `GET` | `/dashboard/daily` | `report:dashboard` |
| `GET` | `/dashboard/trend` | `report:dashboard` |

`/dashboard/stats` returns employee counts, today's attendance breakdown,
department count, device online/offline counts and a `demo_data` flag.
`demo_data` is true only when explicitly flagged demo rows exist; it is not
inferred. The dashboard does not fabricate numbers when there is no data.

### 3.10 Reports

| Method | Path | Permission |
|---|---|---|
| `GET` | `/reports/attendance` | `report:view` |
| `GET` | `/reports/departments` | `report:view` |
| `GET` | `/reports/leaves` | `report:view` |

`/reports/attendance` filters: `date_from`, `date_to`, `department_id`,
`employee_id`, `status`, `format` (`json`, `excel`, `pdf`).
Excel/PDF require `report:export` in addition to `report:view`.

Exports return `Content-Disposition` with a UTF-8 filename and the proper MIME
type. A hard cap of `EXPORT_MAX_ROWS` (default 10 000) protects the server:
JSON responses include `"truncated": true` and `"limit"`, while Excel/PDF
metadata shows a warning. Narrow the date range if truncated.

### 3.11 Audit journal

| Method | Path | Permission |
|---|---|---|
| `GET` | `/audit` | `audit:read` |
| `GET` | `/audit/export` | `audit:export` |
| `GET` | `/audit/{log_id}` | `audit:read` |

Filters: `page`, `page_size`, `user_id`, `action`, `resource_type`,
`date_from`, `date_to`, `search`. Each entry contains `old_values`,
`new_values`, `changed_fields`, IP/user agent, success flag and actor name.

The audit log is append-only: no update or delete endpoints exist.

### 3.12 Settings and backups

| Method | Path | Permission |
|---|---|---|
| `GET` | `/settings` | `settings:read` |
| `PATCH` | `/settings/{key}` | `settings:update` |
| `GET` | `/backups` | `settings:backup` |
| `POST` | `/backups` | `settings:backup` |
| `POST` | `/backups/{filename}/restore?confirm=true` | `settings:restore` |

`GET /settings?category=attendance` filters by category. Read-only settings
return `409` on update. Every change is audited with old and new values.

`POST /backups` runs `pg_dump -Fc` into `BACKUP_DIR_SSD`, verifies the file can
be read by `pg_restore`, mirrors it to `BACKUP_DIR_HDD` when that directory is
available, and writes a `backup.create` audit entry.

`POST /backups/{filename}/restore` requires `confirm=true` and a plain filename
(no path separators). It runs `pg_restore --clean --if-exists
--single-transaction --exit-on-error`. **The API process keeps running with
open connections after a restore**, so the service must be restarted
immediately. For production restores use `deployment/backup/restore.sh`,
which stops the service, restores, applies migrations and starts the service
again (procedure in `docs/SECURITY.md`).

---

## 4. Hikvision integration notes (honest status)

* Implemented: Digest-authenticated ISAPI calls, device info, capability
  probes, time drift check, `AcsEvent` paginated search, idempotent ingestion
  (`UNIQUE(device_id, device_event_id)` + `ON CONFLICT DO NOTHING`), backfill
  from `last_sync` after restarts, exponential backoff when a device is
  offline.
* `alertStream` capability is **probed and reported**, but the poller uses
  `AcsEvent` search rather than a persistent stream. A device that supports
  only `alertStream` is reported as not ingestable instead of being assumed to
  work.
* Raw payloads are sanitized before storage: fields that could contain
  biometric templates, photos, card numbers, URLs or credentials are dropped.
  Events whose device user is not yet mapped stay unprocessed and are retried
  on later poll cycles (bounded batch).
* No biometric templates, face images, or card numbers are copied or stored.
  Only event metadata (device user ID, timestamp, event type, verification
  mode) is stored.
* These integrations have **not been tested against physical hardware** in this
  repository. Run `Diagnostika` on every model/firmware before relying on it.
