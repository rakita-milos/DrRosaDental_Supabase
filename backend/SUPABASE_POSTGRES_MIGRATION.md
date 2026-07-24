# Supabase PostgreSQL Runtime

The backend now runs only against Supabase/PostgreSQL.

## Active State

- Active schema: `backend/database.postgres.sql`
- Connection helper: `backend/db/postgres.js`
- Required runtime variable: `DATABASE_URL`
- Recommended search path: `PG_SEARCH_PATH=app,public`

The app schema is intentionally created under the private `app` schema, not
directly in `public`. Backend connections should use `search_path=app,public`.

## Setup

1. Create or open the Supabase project.
2. Copy the PostgreSQL connection string from Supabase.
3. Put it in `backend/.env` as `DATABASE_URL`.
4. Add `PG_SEARCH_PATH=app,public`.
5. Initialize the schema:

```bash
cd backend
npm run db:postgres:init
```

## Backup And Restore

Database backup and restore are handled outside the application through
Supabase managed backups or a planned PostgreSQL maintenance workflow.

## Current Google Calendar Columns

The `doctors` table must include calendar color columns:

```sql
google_color_id text
calendar_color text
calendar_text_color text
```

They are present in `backend/database.postgres.sql` and in Supabase migration:

```text
supabase/migrations/20260721193000_add_doctor_calendar_colors.sql
```

If production reports missing columns, verify the deployment points to the same Supabase project and that `PG_SEARCH_PATH=app,public`.

Google Calendar OAuth tokens and sync state are stored in `google_calendar_settings`. The OAuth code itself is not stored permanently.
