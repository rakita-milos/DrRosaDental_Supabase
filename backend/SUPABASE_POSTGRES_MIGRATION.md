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
