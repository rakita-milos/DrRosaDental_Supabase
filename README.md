# Dr Rosa Dental Dashboard

A dental clinic management system with role-based access control, patient tracking, visit records, payment status, tooth-map treatments, appointment scheduling, patient documents, financial reports and director-only analytics.

## Features

**Staff interface**
- Patient dashboard with visit history, medical profile, documents, imaging metadata and clinical workflow tabs
- New patient registration
- Patient edit/delete with protected deletion when visit history exists
- Visit/treatment logging with FDI tooth mapping
- Calendar page for chairs, doctors, appointments and visit creation from an appointment
- Public booking request page
- Payment tracking: Placeno, Delimicno, Dugovanje
- Patient filtering, search and detail pages
- Excel/PDF export from filtered records

**Director panel**
- Financial report: revenue, debt, payment percentage
- Patient report: total, regular/new patients, debts
- Doctor productivity report
- Procedure distribution report
- Excel-style report tabs: PAZARI, Hirurgija, Protetika, Ortodoncija, Troskovi, Ukupno
- Excel/PDF export for opened report tables
- Admin area for codebooks: activities, procedures, visit/payment statuses, currencies and shifts
- Shift codebook stores working time and one or more weekdays
- Currency codebook stores exchange-rate metadata instead of group/price fields
- Google Calendar settings and sync status
- Backup, restore-test, audit-log, sessions, 2FA and legal-export tools

**Security**
- Role-based access control: director/staff
- JWT authentication
- bcrypt credential hashing
- Helmet security headers
- CORS allow-list
- SQLite prepared statements
- Login rate limiting
- Encrypted SQLite backup files

## Project Structure

```text
DrRosaWebApp/
  index.html
  README.md
  DIRECTOR_PANEL_GUIDE.md
  BACKEND_SETUP.md
  database_schema.sql  (legacy reference; active schema is backend/database.sql)
  sql/
  backend/
    server.js
    database.sql
    package.json
    data/
    backups/
    scripts/
    uploads/
  src/
    pages/
      login.html
      index.html
      new-entry.html
      all-records.html
      patient-dashboard.html
      new-patient.html
      director-panel.html
      calendar.html
      public-booking.html
    scripts/
      api.js
      login.js
      script.js
      new-entry.js
      all-records.js
      patient-dashboard.js
      new-patient.js
      director-reports.js
      export-utils.js
      procedure-catalog.js
      calendar.js
      public-booking.js
    styles/
      styles.css
    assets/
      logo.svg
  tests/
    playwright/
      package.json
      playwright.config.js
      pages/
      utils/
      tests/
      README.md
```

## Quick Start

### 1. Install backend dependencies

```bash
cd backend
npm install
```

### 2. Configure backend

Create or update the backend environment file. Keep local credentials and runtime secrets only in that file, outside README documentation.

Required runtime settings include:

```text
SQLITE_DB_PATH
BACKUP_DIR
UPLOAD_DIR
SCANNER_IMPORT_DIR
BACKUP_ENCRYPTION_KEY
STAFF_DEFAULT_PERMISSIONS
PORT
NODE_ENV
JWT_SECRET
API_URL
CORS_ORIGIN
TRUST_PROXY
```

The initial director and staff login values are also configured through backend environment variables and are used only when the users table is empty.

For production, `NODE_ENV=production` enforces explicit `CORS_ORIGIN`, `UPLOAD_DIR`, `SCANNER_IMPORT_DIR`, `BACKUP_ENCRYPTION_KEY` and `STAFF_DEFAULT_PERMISSIONS`. Production `CORS_ORIGIN` must point to the real HTTPS frontend origin, not localhost.
Set `TRUST_PROXY` explicitly for live deployments (`loopback` for a local reverse proxy, a hop count such as `1` for a trusted upstream proxy, or `false` only without a proxy). `REQUIRE_PRODUCTION_READY=true` can be used as an extra guard so production checks run even if `NODE_ENV` is misconfigured.

### 3. Start the app

```bash
cd backend
npm start
```

Open:

```text
http://localhost:3000/src/pages/login.html
```

### Production container smoke

Use `docker-compose.example.yml` as the deployment template. Create a real
`backend/.env.production` from `backend/.env.example`, rotate all secrets and
credentials, then run:

```bash
docker compose -f docker-compose.example.yml up --build
```

The container healthcheck calls `/api/health`. Keep SQLite data, uploads,
scanner inbox and encrypted backups on persistent volumes.

### Optional development server

```bash
cd backend
npm run dev
```

## Access

Default role accounts are created from the backend environment configuration.

**Director**
- Email: `director@drosa.com`
- Role: Direktor Ordinacije

**Staff**
- Email: `staff@drosa.com`
- Role: Zaposlenik

## Useful Runtime Checks

```bash
# Health check with curl
curl http://localhost:3000/api/health

# Health check in PowerShell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/health

# See running Node processes in PowerShell
Get-Process | Where-Object { $_.ProcessName -eq 'node' } | Select-Object Id,ProcessName,Path
```

## Authentication

1. User submits login data on `login.html`.
2. Frontend calls `POST /api/auth/login`.
3. Backend validates the user in SQLite.
4. Server sets HttpOnly SameSite cookies for browser clients.
5. Frontend stores only non-secret session display metadata in `localStorage['drrosa-session']`.
6. Protected pages call `POST /api/auth/verify`.
7. Director-only pages additionally require the database-backed `director` role.

## Data Persistence

Primary data is stored in SQLite.

- Default database: `backend/data/drosa.sqlite`
- Schema: `backend/database.sql`
- Config: backend environment file
- Uploaded patient files: `backend/uploads`
- Encrypted backups: `backend/backups`

Browser storage is only used for active auth/session state.

## Export Behavior

Excel/PDF export utilities live in `src/scripts/export-utils.js`.

- Excel export creates an `.xls` file from the provided table headers and rows.
- PDF export opens a print window with the same table content; use browser print/save as PDF.
- `Sve evidencije` export follows the currently filtered table rows.
- Director report export follows the currently opened report/table.
- If there are no rows, export shows `Nema podataka za export.`

## Playwright Tests

Automated Playwright tests live in `tests/playwright`.

### Covered flows

- Staff and director login
- Staff and director page smoke coverage
- Unauthenticated, staff and director access rules
- Staff navigation
- New patient creation
- New visit creation
- Full patient CRUD: create, read, update, delete
- Full visit CRUD: create, read, update, delete
- Delete protection: patient deletion is blocked while linked visit history exists
- Calendar API and UI smoke coverage
- Public booking flow coverage
- Patient document upload, view/download metadata and soft delete API coverage
- Advanced workflow API/UI coverage for treatment plans, charts, notes, consents, invoicing, claims and ledger
- Director panel reports
- Director admin codebooks: open, create and delete smoke item
- Backup/security API coverage: encrypted backups, restore tests, audit log, sessions, 2FA and legal export
- Cross-role integration: staff-created data is visible in director reports
- Cross-role integration: director-created data is visible in staff evidence screens
- Director-created codebook activity/procedure is available in staff visit entry
- Excel/PDF export content checks for all records, financial reports and PAZARI reports

### Install test dependencies

```bash
cd tests/playwright
npm install
```

### Run tests

```bash
cd tests/playwright
npm test
```

### Run grouped tests

```bash
cd tests/playwright
npm run test:smoke
npm run test:integration
npm run test:exports
npm run test:regression
```

### Run with visible browser

```bash
cd tests/playwright
npm run test:headed
```

### Open Playwright HTML report

```bash
cd tests/playwright
npm run report
```

### Test notes

- `playwright.config.js` uses isolated default base URL `http://localhost:3010`.
- `npm test` in `tests/playwright` starts `backend/server.js` through `scripts/run-with-server.js` with isolated SQLite, backup, upload and scanner directories, then stops that backend after the run.
- Test login values are read from the backend environment file.
- Tests use Page Object Model classes from `tests/playwright/pages`.
- For a different host/port, run tests with `PLAYWRIGHT_BASE_URL`, for example `PLAYWRIGHT_BASE_URL=https://your-server.example npm test`.
- CRUD, integration, export and regression tests clean up created test patients, visits and codebook items through API cleanup.

## Maintenance Commands

```bash
# Backend dependency audit
cd backend
npm audit

# Backend SQLite backup
cd backend
npm run backup

# Seed demo data
cd backend
npm run seed:demo

# Playwright dependency audit
cd tests/playwright
npm audit

# Git status
git status --short
```

`npm run backup` creates an encrypted `.sqlite.enc` backup. `BACKUP_DIR` controls the backup directory; `SQLITE_BACKUP_DIR` is supported as a legacy fallback.

## Runtime Logs

Runtime log files are kept under `logs/`.

- `logs/backend.out.log` stores backend standard output when using `start-app.bat`.
- `logs/backend.err.log` stores backend errors when using `start-app.bat`.
- Old local logs can be archived under `logs/archive/`.
- `scripts/cleanup-logs.ps1` deletes `.log` files older than the configured number of days.

Recommended retention for runtime file logs is 30 days. Keep database audit/security records according to legal and clinic policy; they are not the same as runtime `.log` files.

## Security Test Summary

Recent local checks cover:

- Health endpoint
- Auth-required API routes
- Invalid login rejection
- SQLi-style login payload rejection
- Staff blocked from director report routes
- Director report access
- CORS disallowed origin rejection
- Login rate limiter returning `429`
- npm audit with `0` known vulnerabilities
- Patient and visit CRUD integration
- Backup/security director routes
- Patient document routes
- Calendar routes
- Advanced clinical and billing workflow routes

## Technologies

- HTML5
- CSS3
- Vanilla JavaScript
- Node.js
- Express
- SQLite
- JWT
- bcrypt
- Helmet
- Playwright

Backend runtime requires Node.js 24.x because it uses the built-in `node:sqlite` module.

## Production Hardening Notes

- Rotate `JWT_SECRET` and all initial login credentials before production use.
- Use HTTPS.
- Keep JWT storage in HttpOnly Secure SameSite cookies; do not reintroduce browser localStorage token persistence.
- Remove inline styles where possible and tighten CSP by removing `style-src 'unsafe-inline'`.
- Add user-management UI for staff accounts.
- Add automated database backup scheduling.
- Set `BACKUP_ENCRYPTION_KEY` separately from `JWT_SECRET`; production startup fails if it is missing or reused.
- Verify the `schema_migrations` table after deploy and keep the pre-deploy encrypted backup for rollback.

## Support

For director panel documentation, see [DIRECTOR_PANEL_GUIDE.md](DIRECTOR_PANEL_GUIDE.md).

---

**Version:** 2.3  
**Last Updated:** May 2026  
**Status:** Demo with backend integration, SQLite persistence, calendar, documents, backup/security, advanced workflow support, export support and Playwright tests; production deployment template and migration ledger are present, but live deployment still requires real secrets, HTTPS reverse proxy configuration, monitored backups and a tested rollback drill.
