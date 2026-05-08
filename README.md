# Dr Rosa Dental Dashboard

A dental clinic management system with role-based access control, patient tracking, visit records, payment status, tooth-map treatments, financial reports and director-only analytics.

## Features

**Staff interface**
- Patient dashboard with visit history
- New patient registration
- Patient edit/delete with protected deletion when visit history exists
- Visit/treatment logging with FDI tooth mapping
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

**Security**
- Role-based access control: director/staff
- JWT authentication
- bcrypt password hashing
- Helmet security headers
- CORS allow-list
- SQLite prepared statements
- Login rate limiting

## Project Structure

```text
DrRosaWebApp/
  index.html
  README.md
  DIRECTOR_PANEL_GUIDE.md
  backend/
    server.js
    database.sql
    package.json
    .env
    data/
    scripts/
  src/
    pages/
      login.html
      index.html
      new-entry.html
      all-records.html
      patient-dashboard.html
      new-patient.html
      director-panel.html
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
    styles/
      styles.css
    assets/
      logo.svg
  tests/
    playwright/
      package.json
      playwright.config.js
      tests/smoke.spec.js
      README.md
```

## Quick Start

### 1. Install backend dependencies

```bash
cd backend
npm install
```

### 2. Configure backend

Create or update `backend/.env`.

```env
SQLITE_DB_PATH=./data/drosa.sqlite
SQLITE_BACKUP_DIR=./backups
PORT=3000
NODE_ENV=development
JWT_SECRET=change-this-to-a-unique-32-character-minimum-secret
API_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000
INITIAL_DIRECTOR_PASSWORD=change-this-password
INITIAL_STAFF_PASSWORD=change-this-password
```

### 3. Start the app

```bash
cd backend
npm start
```

Open:

```text
http://localhost:3000/src/pages/login.html
```

### Optional development server

```bash
cd backend
npm run dev
```

## Credentials

Passwords are read from `backend/.env`.

**Director**
- Email: `director@drosa.com`
- Password: `INITIAL_DIRECTOR_PASSWORD`
- Role: Direktor Ordinacije

**Staff**
- Email: `staff@drosa.com`
- Password: `INITIAL_STAFF_PASSWORD`
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

1. User submits credentials on `login.html`.
2. Frontend calls `POST /api/auth/login`.
3. Backend validates the user in SQLite.
4. Backend returns a JWT and user object.
5. Frontend stores:
   - `localStorage['drrosa-token']`
   - `localStorage['drrosa-session']`
6. Protected pages call `POST /api/auth/verify`.
7. Director-only pages additionally require `role === "director"`.

## Data Persistence

Primary data is stored in SQLite.

- Default database: `backend/data/drosa.sqlite`
- Schema: `backend/database.sql`
- Config: `backend/.env`

Browser storage is only used for active auth/session state.

## Export Behavior

Excel/PDF export utilities live in `src/scripts/export-utils.js`.

- Excel export creates an `.xls` file from the provided table headers and rows.
- PDF export opens a print window with the same table content; use browser print/save as PDF.
- `Sve evidencije` export follows the currently filtered table rows.
- Director report export follows the currently opened report/table.
- If there are no rows, export shows `Nema podataka za export.`

## Playwright Smoke Tests

Automated smoke tests live in `tests/playwright`.

### Covered flows

- Staff and director login
- Staff navigation
- New patient creation
- New visit creation
- Full patient CRUD: create, read, update, delete
- Full visit CRUD: create, read, update, delete
- Delete protection: patient deletion is blocked while linked visit history exists
- Director panel reports
- Director admin codebooks: open, create and delete smoke item
- Basic Excel/PDF export button checks in director reports

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

### Run full regression E2E tests

```bash
cd tests/playwright
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

- `playwright.config.js` checks `http://localhost:3000/api/health`.
- If the backend is not already running, Playwright starts `backend/server.js`.
- Test credentials are read from `backend/.env`.
- Tests use Page Object Model classes from `tests/playwright/pages`.
- For a different host/port, run tests with `PLAYWRIGHT_BASE_URL`, for example `PLAYWRIGHT_BASE_URL=https://your-server.example npm test`.
- The full CRUD smoke test creates, updates and deletes its own smoke patient/visit records.
- Regression E2E tests clean up created test patients, visits and codebook items through API cleanup.
- Last verified result: `4 passed`.

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

## Security Test Summary

Recent local checks covered:

- Health endpoint
- Auth-required API routes
- Wrong password rejection
- SQLi-style login payload rejection
- Staff blocked from director report routes
- Director report access
- CORS disallowed origin rejection
- Login rate limiter returning `429`
- npm audit with `0` known vulnerabilities
- Patient and visit CRUD integration

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

## Production Hardening Notes

- Rotate `JWT_SECRET` and all initial passwords.
- Use HTTPS.
- Consider moving JWT storage from `localStorage` to HttpOnly Secure SameSite cookies.
- Remove inline styles where possible and tighten CSP by removing `style-src 'unsafe-inline'`.
- Add user-management UI for staff accounts.
- Add automated database backup scheduling.

## Support

For director panel documentation, see [DIRECTOR_PANEL_GUIDE.md](DIRECTOR_PANEL_GUIDE.md).

---

**Version:** 2.2  
**Last Updated:** May 2026  
**Status:** Demo with backend integration, SQLite persistence, export support and Playwright smoke tests; production hardening still required.
