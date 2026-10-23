# FaceSys Enterprise

Local-network HR and Face ID attendance system for a clinic (≈1000 employees,
50 departments). Backend: FastAPI + async SQLAlchemy + PostgreSQL. Frontend:
React 19 + TypeScript + Vite 8 + Tailwind CSS 4, fully in Uzbek. Deployment
target: Kali / Debian with systemd and Nginx.

## Status and honest limitations

Implemented in this repository:

- Authentication, role/permission matrix, server-side department isolation,
  audit journal, employees/departments/positions, shifts and assignments,
  leaves and holidays, attendance calculation and corrections, reports,
  settings, backups.
- Hikvision ISAPI **read** integration: device info, capability diagnostics,
  time-drift check, paginated `AcsEvent` search, idempotent ingestion,
  retry/backfill. Device passwords are encrypted at rest.
- Kali installer, systemd units, Nginx site, daily SSD→HDD backup and a
  restore script.

Not implemented / not verified here — do not assume they work:

- **No hardware verification.** The Hikvision client has not been tested
  against a physical terminal. Use `Qurilmalar → Diagnostika` and trust only
  the reported capability flags.
- **Polling, not streaming.** The poller uses `AcsEvent` search. `alertStream`
  support is probed and displayed but is not used for ingestion.
- **No CSRF tokens.** Authentication uses an `Authorization: Bearer` header,
  not cookies, so classic CSRF does not apply. If you add cookie auth, add
  CSRF protection first.
- **No server-side token revocation.** Logout and password change do not
  invalidate already-issued JWTs. Deactivate the user (checked on every
  request) or rotate secrets deliberately (see `docs/SECURITY.md`).
- **Single uvicorn worker only.** The device poller runs in the app lifespan;
  multiple workers would duplicate polling.
- **Settings persistence is not the same as runtime consumption.** The
  Settings page stores and audits values, but the current backend attendance
  engine still takes its rules from shift settings and does not dynamically
  read every seeded `SystemSetting` key. The page states this explicitly.
- **Windows-only verification so far.** The application, migration chain, test
  suite, frontend build and a Chromium browser smoke test were executed on
  Windows with Python 3.12, Node 24.20 and PostgreSQL 17.10. The Kali
  installer, systemd/Nginx configuration and physical Hikvision integration
  were **not** executed in this environment.

### Verification performed (Windows, Python 3.12, Node 24.20, PostgreSQL 17.10)

- Backend `pytest`: **86 passed** (including the opt-in migration test),
  covering authentication/RBAC, department isolation, attendance
  (day/night/cross-midnight), corrections, exports, backups and concurrency.
- `alembic upgrade head` on an empty database followed by `alembic check`:
  **no new upgrade operations** (metadata and migration agree).
- `ruff check backend/app backend/tests database`: **clean**.
- FastAPI app import and OpenAPI schema generation: successful (52 paths).
- Frontend `npm run gen:api`, `npm run typecheck`, `npm run lint` and
  `npm run build`: successful; the production build is written to
  `frontend/dist`.
- Seed script on a fresh migrated database: roles/permissions/settings/admin
  created; re-running is idempotent; the seeded admin can log in and call
  `/auth/me`.
- Browser smoke test against the running API: login works and the main pages
  render without console errors; the employee creation form writes a real
  record.
- Responsive layout, keyboard-only navigation and browsers other than Chromium
  have not been exhaustively tested. Hikvision hardware, Kali installer,
  systemd/Nginx, HTTPS and restore drills remain unverified.

Re-run all of the above on the real Kali server, then complete the hardware and
restore drills before go-live.

## Technology

| Layer | Choice |
|---|---|
| Backend | Python 3.11+, FastAPI, Pydantic v2 |
| ORM / migrations | SQLAlchemy 2 (async, asyncpg), Alembic |
| Database | PostgreSQL 14+ |
| Frontend | React 19, TypeScript 5.9, Vite 8, Tailwind CSS 4 |
| UI data/state | TanStack Query 5, React Router 7, Recharts |
| Build output | Static SPA in `frontend/dist`, served by Nginx |
| Device integration | Hikvision ISAPI over HTTP Digest |
| Deployment | Kali/Debian, systemd, Nginx, PostgreSQL |

## Project structure

```
facesys-enterprise/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app, security headers, lifespan
│   │   ├── core/                   # config, database, security, permissions, rate limit
│   │   ├── models/                 # 18 SQLAlchemy tables
│   │   ├── schemas/                # Pydantic schemas
│   │   ├── api/                    # routers (auth, employees, attendance, …)
│   │   ├── services/               # attendance engine, exports
│   │   ├── integrations/hikvision/ # ISAPI client, ingest, diagnostics, poller
│   │   └── audit/                  # audit service
│   ├── tests/                      # pytest suite (PostgreSQL test DB)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/                    # typed client, services, generated OpenAPI types
│   │   ├── auth/                   # AuthProvider, protected routes
│   │   ├── components/             # layout, forms, shared UI
│   │   ├── lib/                    # formatting, validation, hooks
│   │   └── pages/                  # 16 React pages
│   ├── openapi.json                # exported FastAPI schema
│   ├── package.json / package-lock.json
│   └── dist/                       # production build (generated)
├── frontend-legacy/                # archived vanilla frontend (not deployed)
├── database/
│   ├── migrations/                 # Alembic env + initial migration
│   └── seed/                       # roles, permissions, settings, first admin
├── deployment/
│   ├── install.sh
│   ├── systemd/                    # facesys.service, backup service + timer
│   ├── nginx/facesys.conf
│   └── backup/                     # backup.sh, restore.sh
└── docs/                           # API, INSTALL, SECURITY, ERD, RBAC
```

## Features

### Roles

- **Super Admin** — full access, including users/roles/settings/backups.
- **Bosh shifokor** — read-only across all departments + reports.
- **Kadrlar boshlig'i (HR)** — employees, departments, attendance corrections
  with audit; cannot grant Super Admin.
- **Bo'lim boshlig'i** — own department only, enforced server-side; out-of-scope
  objects return `404` to prevent ID enumeration.
- **Kuzatuvchi (auditor)** — read-only across all departments for the permitted
  audit/report subset.

Permissions are recomputed from the database on every request; the token's
contents are never trusted.

### Attendance

- Check-in/out from raw device events; daily records separate from events.
- Late/early/work-time calculation, break and overtime fields.
- Day, night and cross-midnight shifts (logical work date follows the shift
  start; check-out after midnight maps back to the previous work date).
- Holidays, approved leave, weekends, unscheduled days.
- Duplicate scans tolerated; repeated device events are idempotent.
- Incomplete days are never auto-confirmed.
- Manual corrections preserve original values and raw events; manual records
  are never overwritten by automatic recalculation.
- Timezone: `Asia/Tashkent`.

### Hikvision privacy

- No biometric templates, face photos, or card numbers are copied or stored.
  Raw event payloads are sanitized to attendance metadata only.
- Device passwords are encrypted with Fernet (key derived from `SECRET_KEY`),
  never returned by the API and never logged.
- Diagnostics are read-only; the system never writes users/templates to a
  terminal.
- Unsupported capabilities are reported as `false`, never as working.

## Quick start (Kali / Debian server)

```bash
cd facesys-enterprise
sudo ./deployment/install.sh
```

The installer creates the `facesys` user, `/opt/facesys`, the Python venv,
`/etc/facesys/facesys.env`, the PostgreSQL role/database, runs the migration,
seeds roles/settings and the first Super Admin, installs systemd units and the
Nginx site, and verifies `/health` plus auto-start. Re-running preserves the
existing env file and admin.

Detailed steps, HTTPS, backup disk, upgrade and troubleshooting:
[docs/INSTALL.md](docs/INSTALL.md).

## Local development

Prerequisites: Python 3.11+, PostgreSQL 14+, Node.js 20.19+ (or 22.12+) and
npm 10+.

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # edit SECRET_KEY, REFRESH_SECRET_KEY, DATABASE_*

# Alembic must run from database/migrations (alembic.ini uses script_location = .)
cd ../database/migrations
alembic upgrade head

# Seed permissions, roles, settings and the first admin (from repo root)
cd ../..
SEED_ADMIN_PASSWORD='ChangeMe-12345' \
  python database/seed/seed.py --admin-username admin

# Run the API
cd backend
python -m app.main          # http://127.0.0.1:8000
```

Run the React development server (it proxies `/api` to
`http://127.0.0.1:8000`):

```bash
cd frontend
cp .env.example .env
npm ci
npm run dev                 # http://127.0.0.1:5173
```

`VITE_API_BASE_URL` defaults to `/api/v1`; set a full URL only when the API is
on a different host and that origin is allowed by `CORS_ORIGINS`.

Production build and checks:

```bash
cd frontend
npm run gen:api             # regenerate types from openapi.json
npm run typecheck
npm run lint
npm run build               # writes dist/
```

The backend default CORS list permits `http://localhost:8080`; Vite uses its
same-origin proxy, so no CORS change is needed for local development. In
production Nginx serves `frontend/dist` and proxies `/api/` on the same
origin.

## Tests

Tests need a real PostgreSQL and a database name containing `test`:

```bash
createdb -U postgres facesys_test
cd backend
TEST_DATABASE_NAME=facesys_test \
TEST_DATABASE_USER=postgres \
TEST_DATABASE_PASSWORD='…' \
pytest
```

The suite creates the schema from SQLAlchemy metadata and rolls each test back.
Opt-in migration drift check: `RUN_MIGRATION_TEST=1 pytest tests/test_migrations.py`.

Verified result in this repository (Windows, Python 3.12, PostgreSQL 17.10):

```text
86 passed
alembic check: No new upgrade operations detected.
```

The Hikvision hardware, Kali installer, systemd/Nginx and backup/restore
scripts still require execution on the target server.

## API and documentation

- [docs/API.md](docs/API.md) — endpoints, permissions, request/response examples.
- [docs/INSTALL.md](docs/INSTALL.md) — install, ops, backups, HTTPS, upgrades.
- [docs/SECURITY.md](docs/SECURITY.md) — threat model, controls, restore test,
  known limitations.
- [docs/ERD.md](docs/ERD.md) — data model.
- [docs/RBAC.md](docs/RBAC.md) — role/permission matrix.

## License

Proprietary — FaceSys Enterprise.
