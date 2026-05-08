# Dr Rosa Backend API

Express + SQLite backend for the Dr Rosa dental clinic application.

## Production Environment

Create `backend/.env`:

```env
NODE_ENV=production
PORT=3000
JWT_SECRET=use-a-unique-secret-with-at-least-32-characters
CORS_ORIGIN=https://your-frontend-origin.example
SQLITE_DB_PATH=./data/drosa.sqlite
SQLITE_BACKUP_DIR=./backups
INITIAL_DIRECTOR_PASSWORD=set-a-strong-initial-password
INITIAL_STAFF_PASSWORD=set-a-different-strong-password
```

Notes:
- `JWT_SECRET` is required. The server will not start with a missing or weak secret.
- Initial passwords are used only when the `users` table is empty.
- `CORS_ORIGIN` is an allowlist. Use comma-separated origins if needed.
- Relative SQLite paths are resolved from the `backend` directory, so the project can move between computers and servers.

## Commands

```powershell
cd backend
npm.cmd install
npm.cmd start
npm.cmd run backup
```

## Auth

`POST /api/auth/login`

```json
{
  "email": "director@drosa.com",
  "password": "configured-password",
  "role": "director"
}
```

The API returns a JWT. Send it as:

```text
Authorization: Bearer <token>
```

## Main Endpoints

- `POST /api/auth/login`
- `POST /api/auth/verify`
- `GET /api/patients`
- `GET /api/patients/:id`
- `POST /api/patients`
- `PUT /api/patients/:id`
- `GET /api/records`
- `POST /api/records`
- `PUT /api/records/:id`
- `GET /api/doctors`
- `GET /api/director/reports/financial`
- `GET /api/director/reports/patients`
- `GET /api/director/reports/doctors`
- `GET /api/director/reports/procedures`
- `GET /api/health`

## Security

- Passwords are hashed with bcrypt.
- JWT secret is mandatory and validated at startup.
- Login is rate-limited in memory.
- CORS is restricted to configured frontend origins.
- Helmet security headers are enabled.
- Request body size is limited.
- User input is normalized before storage.
- SQL queries use prepared statements.
- Health checks do not expose the SQLite file path.
