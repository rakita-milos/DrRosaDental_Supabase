# Dr Rosa Backend API

Express + SQLite backend for the Dr Rosa dental clinic application.

## Production Environment

Create the backend environment file and keep local credentials out of documentation and source control.

Required settings:

```text
NODE_ENV
PORT
JWT_SECRET
CORS_ORIGIN
SQLITE_DB_PATH
SQLITE_BACKUP_DIR
```

Optional runtime settings include upload and backup directories, backup encryption key, Google Calendar OAuth values and initial director/staff login values.

Notes:
- `JWT_SECRET` is required. The server validates it at startup.
- Initial login values are used only when the `users` table is empty.
- `CORS_ORIGIN` is an allow-list. Use comma-separated origins if needed.
- Relative SQLite paths are resolved from the `backend` directory, so the project can move between computers and servers.

## Commands

```powershell
cd backend
npm.cmd install
npm.cmd start
npm.cmd run backup
```

## Auth

Clients authenticate with `POST /api/auth/login`. The API returns a JWT. Send it as:

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
- Health checks do not expose the SQLite file path.
- Backup files are encrypted.

## Delete Rules

- Patient delete returns `409 Conflict` when the patient has linked visit history or payments.
- Visit record delete removes the selected history entry and its owned payment/treatment rows through SQLite foreign keys.
- Document delete is soft-delete.
- The UI asks for confirmation before every exposed delete action.

## Codebook Notes

- Shift codebook items can store `metadata.timeFrom`, `metadata.timeTo` and `metadata.days`.
- `metadata.days` supports one or more weekday keys: `monday` through `sunday`.
- Currency codebook items can store `metadata.exchangeRate`, `metadata.rateDate`, `metadata.rateBase` and `metadata.rateSource`.
- The exchange-rate endpoint uses Frankfurter as a best-effort provider; rates can still be entered manually.
