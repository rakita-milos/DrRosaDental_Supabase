# Dr Rosa Backend API

Express backend for the Dr Rosa dental clinic application.

The runtime is PostgreSQL-only and is intended for Supabase PostgreSQL using the
schema in `database.postgres.sql`.

## Production Environment

Create the backend environment file and keep local credentials out of documentation and source control.

Required settings:

```text
NODE_ENV
PORT
JWT_SECRET
CORS_ORIGIN
TRUST_PROXY
DB_CLIENT
DATABASE_URL
PG_SEARCH_PATH
PGSSL
UPLOAD_DIR
SCANNER_IMPORT_DIR
STAFF_DEFAULT_PERMISSIONS
```

Optional runtime settings include Google Calendar OAuth values and initial director/staff login values.

Notes:
- `JWT_SECRET` is required. The server validates it at startup.
- Initial login values are used only when the `users` table is empty.
- `CORS_ORIGIN` is an allow-list. Use comma-separated origins if needed. In production it must be explicit and must not use localhost origins.
- `TRUST_PROXY` must be set explicitly for production. Use `loopback` for a local HTTPS reverse proxy, a hop count such as `1` for a trusted upstream proxy, or `false` only when Express is directly exposed.
- `REQUIRE_PRODUCTION_READY=true` can be used as an extra deployment guard; it enables the production-required startup checks even before `NODE_ENV=production` is set.
- `DB_CLIENT` must be `postgres` if set.
- `DATABASE_URL` is the Supabase PostgreSQL connection string.
- `PG_SEARCH_PATH` should be `app,public` for the Supabase schema in this repo.
- Supabase PostgreSQL backups are managed outside the application by Supabase or a `pg_dump`/restore maintenance workflow.
- `UPLOAD_DIR`, `SCANNER_IMPORT_DIR` and `STAFF_DEFAULT_PERMISSIONS` are required in production so live deploys do not inherit development defaults.
- `STAFF_DEFAULT_PERMISSIONS` is a comma-separated allow-list, for example `patients:read,patients:write,records:read,records:write,calendar:read,calendar:write,documents:read,documents:write`.

## Commands

```powershell
cd backend
npm.cmd install
npm.cmd start
npm.cmd run db:postgres:init
```

`npm run db:postgres:init` applies `database.postgres.sql` to the Supabase database configured by `DATABASE_URL`.

## Auth

Clients authenticate with `POST /api/auth/login`. The server sets HttpOnly SameSite cookies for browser clients. Non-production responses also include explicit tokens for automated tests and local tooling. If a token is provided explicitly, send it as:

```text
Authorization: Bearer <token>
```

## Main Endpoints

- Auth: login, verify, refresh and logout
- Patients: list, detail, create, update and delete
- Medical profile: get/update profile per patient
- Patient documents: upload, scan import, view, download, imaging metadata and soft delete
- Records: list, create, update and delete visit records
- Chairs and appointments: list/create/update/delete appointments and create visit from appointment
- Public booking: options, availability and request creation
- Treatment plans, clinical chart, clinical notes, consents, perio charts, invoices, claims and ledger
- Director backups: status, list, create, download, restore and test restore
- Director security: audit log, sessions, permissions, legal export, status, unlock, 2FA setup/verify/disable
- Director Google Calendar: settings, OAuth exchange, sync status, retry and test sync
- Director reports: financial, patients, doctors and procedures
- Codebooks: public codebooks and director codebook CRUD
- Doctors and health check

## Security

- Credentials are hashed with bcrypt.
- JWT secret is mandatory and validated at startup.
- Login is rate-limited in memory.
- CORS is restricted to configured frontend origins.
- Helmet security headers are enabled.
- Request body size is limited.
- User input is normalized before storage.
- SQL queries use prepared statements.
- Supabase PostgreSQL target schema uses a private `app` schema instead of exposed `public` tables.
- Health checks do not expose database connection details.
- Application backup/restore endpoints report that Supabase PostgreSQL backups are managed outside the application.
- Legal export is paginated by a `limit` query parameter with a production safety cap; the response includes `meta.counts` and `meta.truncated`.

## Delete Rules

- Patient delete returns `409 Conflict` when the patient has linked visit history or payments.
- Visit record delete removes the selected history entry and its owned payment/treatment rows through PostgreSQL foreign keys.
- Document delete is soft-delete.
- The UI asks for confirmation before every exposed delete action.

## Codebook Notes

- Shift codebook items can store `metadata.timeFrom`, `metadata.timeTo` and `metadata.days`.
- `metadata.days` supports one or more weekday keys: `monday` through `sunday`.
- Currency codebook items can store `metadata.exchangeRate`, `metadata.rateDate`, `metadata.rateBase` and `metadata.rateSource`.
- The exchange-rate endpoint uses Frankfurter as a best-effort provider; rates can still be entered manually.
