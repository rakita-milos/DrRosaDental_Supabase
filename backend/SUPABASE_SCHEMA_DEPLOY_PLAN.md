# Supabase schema deploy plan

This plan is intentionally not an automatic live deploy. The schema changes affect appointment booking rules, Google Calendar import metadata, sync job locking, and app notifications.

## Scope

- Add Google Calendar import metadata to `appointments`.
- Add `google_calendar_sync_jobs` for one-running-sync locking and sync status history.
- Add `app_notifications` for multi-device sync notifications.
- Add appointment overlap protection for doctor and chair scheduling.
- Keep Google all-day/special events importable as non-blocking `google_event` rows.

## Pre-deploy checks

Run these checks against the target Supabase database before applying the schema:

```sql
select current_schema();

select a1.id as appointment_id, a2.id as overlaps_with, a1.doctor_id, a1.chair_id, a1.starts_at, a1.ends_at
from appointments a1
join appointments a2
  on a1.id < a2.id
 and coalesce(a1.google_event_type, 'appointment') = 'appointment'
 and coalesce(a2.google_event_type, 'appointment') = 'appointment'
 and a1.status in ('scheduled', 'confirmed', 'arrived')
 and a2.status in ('scheduled', 'confirmed', 'arrived')
 and (a1.doctor_id = a2.doctor_id or a1.chair_id = a2.chair_id)
 and a1.starts_at < a2.ends_at
 and a1.ends_at > a2.starts_at
order by a1.starts_at desc
limit 100;

select count(*) as running_sync_jobs
from google_calendar_sync_jobs
where status = 'running';
```

If existing overlaps are returned, review them before enabling strict exclusion constraints. The runtime trigger can still protect new writes, but historical rows should be corrected or marked with a Google warning when they are legitimate imports.

## Deploy order

1. Take a Supabase backup or confirm the latest automated backup.
2. Apply `backend/database.postgres.sql` changes in a staging database first.
3. Run the pre-deploy overlap query again.
4. Run backend tests with `DATABASE_URL` pointing to the staging database.
5. Apply the schema to production during a low-traffic window.
6. Restart/redeploy the backend so route code and schema are active together.
7. Trigger one manual Google sync from the Calendar screen.
8. Confirm one sync notification appears on another signed-in session.

## Acceptance checks after staging deploy

Run these checks after applying the schema in staging:

```sql
-- Manual appointments: same doctor and same chair at the same time must be rejected.
-- Manual appointments: same time on chair 1 and chair 2 can exist when doctor/chair rules allow it.
select tgname
from pg_trigger
where tgrelid = 'appointments'::regclass
  and tgname = 'trg_prevent_appointment_overlap';

select indexname
from pg_indexes
where tablename in ('appointments', 'google_calendar_sync_jobs', 'app_notifications')
order by tablename, indexname;

select column_name
from information_schema.columns
where table_name = 'appointments'
  and column_name in ('google_event_type', 'google_sync_warning', 'google_sync_warning_code')
order by column_name;
```

Then verify from the application:

- Create two valid same-time appointments in different chairs if the clinic workflow requires it.
- Try to create a duplicate same-chair appointment and confirm the API returns `409`.
- Import a Google all-day event and confirm it appears as `google_event`, not as a day blocker.
- Start Google sync from Calendar on a visible week and confirm the result is not `partial`.
- Open another signed-in session and confirm the sync notification appears.

## Production release gate

Do not deploy the schema to production until all of these are true:

- Staging schema checks pass.
- Existing overlap query has been reviewed.
- Backend code version includes range Google pull support.
- A fresh database backup exists.
- Rollback SQL below has been tested on staging.

## Rollback

If appointment creation starts failing unexpectedly:

```sql
drop trigger if exists trg_prevent_appointment_overlap on appointments;
drop function if exists prevent_appointment_overlap();
```

Keep the Google metadata columns and sync job tables during rollback unless they directly caused the incident. They are additive and preserve sync diagnostics.

## Approval note

Do not run this against the live Supabase database without explicit owner approval, because it changes production appointment write behavior.
