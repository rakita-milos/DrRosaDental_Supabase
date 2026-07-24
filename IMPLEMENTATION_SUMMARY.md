# Dr Rosa Web App - Implementation Summary

## Current State

Dr Rosa is a Supabase/PostgreSQL-backed dental clinic management app with role-based access, patient records, appointments, public booking, documents, director reports, codebooks, daily cash reporting, security tools and Google Calendar integration.

The app is no longer a static localStorage demo. Runtime data is stored in Supabase PostgreSQL, with backend access through Express and a private `app` schema.

## Runtime

- Backend: Node.js + Express
- Database: Supabase PostgreSQL
- Primary schema: `app`
- Recommended search path: `PG_SEARCH_PATH=app,public`
- Auth: JWT in HttpOnly SameSite cookies
- Frontend: HTML/CSS/vanilla JavaScript
- Deployment target: Vercel-compatible Node runtime

## Implemented Areas

### Authentication And Roles

- Director and staff roles
- Login, verify, refresh and logout endpoints
- HttpOnly cookie sessions
- Production startup checks for secrets, CORS, staff permissions and trust proxy
- Optional 2FA for director/security flows

### Patient And Clinical Workflow

- Patient registration and edit
- Medical profile
- Visit records
- Tooth/treatment workflows
- Clinical notes
- Treatment plans
- Perio charts
- Consents
- Invoices, insurance claims and ledger
- Patient documents and imaging metadata

### Calendar

- Local appointment CRUD
- Chair and doctor assignment
- Appointment conflict checks
- Visit creation from an appointment
- Public booking options and availability
- Doctor-specific calendar colors

### Director Panel

- Financial reports
- Patient reports
- Doctor productivity reports
- Procedure reports
- Excel-style report tabs
- Daily cash report
- Codebook administration
- Doctor administration
- Public booking toggle
- Backup/security status
- Audit log, sessions, legal export and 2FA controls

### Google Calendar

- Google Calendar settings in director panel
- OAuth Client ID, Client Secret and Redirect URI storage
- OAuth code exchange into saved access/refresh tokens
- OAuth verification using saved tokens
- App-to-Google sync queue processing
- Two-way pull from Google Calendar
- Import of Google-only events into local appointments
- Fallback patient `Google Calendar Import` for imported events without a matched patient
- Original Google title/description/location preserved in appointment notes
- Doctor color mapping through `google_color_id`, `calendar_color` and `calendar_text_color`
- Manual Google pull bounded to avoid Vercel function timeout:
  - default limit: 50 events
  - default range: 1 day past to 14 days future

## Database Notes

Main schema file:

```text
backend/database.postgres.sql
```

Supabase migrations:

```text
supabase/migrations/
```

Doctor color columns:

```sql
google_color_id text
calendar_color text
calendar_text_color text
```

Google Calendar settings are stored in:

```text
google_calendar_settings
```

OAuth authorization codes are not stored permanently. They are one-time codes exchanged for saved access/refresh tokens.

## Verification

Recent verification commands:

```powershell
npm.cmd --prefix backend test
npm.cmd run vercel-build
```

Current backend suite includes regression coverage for:

- Google import of external calendar events
- fallback patient behavior
- doctor color mapping
- explicit Postgres typing for nullable Google color lookup parameters
- OAuth verification without a new code
- bounded manual Google pull without forced full reset

## Operational Notes

- `Testiraj sinhronizaciju` processes local pending sync queue items from the app to Google.
- `Povuci izmene iz Google-a` imports/updates Google Calendar events into the app.
- `Obradjeno: 0` on test sync means there were no local pending items, not that Google pull failed.
- Vercel `504 FUNCTION_INVOCATION_TIMEOUT` usually means a request is doing too much work in one invocation.

## Status

Last updated: July 23, 2026
Status: active Supabase/PostgreSQL application with production-oriented backend checks and Google Calendar two-way sync support.
