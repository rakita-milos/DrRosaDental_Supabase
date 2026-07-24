# Database migrations

The canonical PostgreSQL schema is `backend/database.postgres.sql`.

Supabase migration files live in:

```text
supabase/migrations/
```

Runtime schema compatibility is also guarded by idempotent DDL in `backend/database.postgres.sql`, which is applied during backend initialization.

Production deploy checklist:

1. Run a Supabase managed backup or agreed `pg_dump` backup before deploy.
2. Deploy to staging with a copy of production data when possible.
3. Apply new Supabase migrations or run the backend schema initializer against the target database.
4. Verify `/api/health`.
5. Verify required columns exist in the `app` schema, especially new Google Calendar fields.
6. Keep the pre-deploy backup available for rollback.

Current Google Calendar doctor color migration:

```text
supabase/migrations/20260721193000_add_doctor_calendar_colors.sql
```

Required `doctors` columns:

```sql
google_color_id text
calendar_color text
calendar_text_color text
```
