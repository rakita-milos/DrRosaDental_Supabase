# Database migrations

Runtime schema upgrades are tracked in the `schema_migrations` table.

Production deploy checklist:

1. Run an encrypted backup before deploy.
2. Deploy to staging with a copy of production data.
3. Start the app once and verify `/api/health`.
4. Verify `schema_migrations` contains the expected version.
5. Keep the pre-deploy backup available for rollback.

Do not add ad hoc `ALTER TABLE` calls outside the migration registry in `server.js`.
