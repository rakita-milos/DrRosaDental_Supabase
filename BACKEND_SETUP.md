# Backend Setup Guide - Produkcija

Backend je sada podesen da radi samo sa PostgreSQL/Supabase bazom.

## 1. Konfigurisi `backend\.env`

Primer:

```env
NODE_ENV=production
PORT=3000
JWT_SECRET=promeni-ovo-u-jedinstven-tajni-kljuc-od-minimum-32-karaktera
CORS_ORIGIN=https://adresa-vaseg-frontenda.example
TRUST_PROXY=loopback
REQUIRE_PRODUCTION_READY=true
DB_CLIENT=postgres
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require
PG_SEARCH_PATH=app,public
PGSSL=true
UPLOAD_DIR=C:\DrRosaData\uploads
SCANNER_IMPORT_DIR=C:\DrRosaData\scanner-inbox
STAFF_DEFAULT_PERMISSIONS=patients:read,patients:write,records:read,records:write,calendar:read,calendar:write,documents:read,documents:write
INITIAL_DIRECTOR_PASSWORD=postavi-jaku-direktor-lozinku
INITIAL_STAFF_PASSWORD=postavi-jaku-staff-lozinku
```

Pravila:
- `DATABASE_URL` je obavezan i mora pokazivati na Supabase/PostgreSQL bazu.
- `PG_SEARCH_PATH` treba da bude `app,public`.
- `DB_CLIENT`, ako je postavljen, mora biti `postgres`.
- `JWT_SECRET` mora biti jedinstven i dug najmanje 32 karaktera.
- `INITIAL_DIRECTOR_PASSWORD` i `INITIAL_STAFF_PASSWORD` koriste se samo kada je tabela `users` prazna.
- `CORS_ORIGIN` mora biti tacna HTTPS adresa frontenda.
- `TRUST_PROXY` mora odgovarati reverse proxy topologiji.
- `UPLOAD_DIR`, `SCANNER_IMPORT_DIR` i `STAFF_DEFAULT_PERMISSIONS` su obavezni u produkciji.

## 2. Instaliraj dependency-je

```powershell
cd C:\Users\milos\DrRosaWebApp\backend
npm.cmd install
```

## 3. Inicijalizuj PostgreSQL semu

```powershell
cd C:\Users\milos\DrRosaWebApp\backend
npm.cmd run db:postgres:init
```

## 4. Pokreni backend

```powershell
cd C:\Users\milos\DrRosaWebApp\backend
npm.cmd start
```

Prvi login koristi:
- `director@drosa.com` i lozinku iz `INITIAL_DIRECTOR_PASSWORD`
- `staff@drosa.com` i lozinku iz `INITIAL_STAFF_PASSWORD`

## 5. Backup baze

Backup i restore PostgreSQL baze se rade van aplikacije: Supabase managed backups ili dogovoreni `pg_dump`/restore maintenance postupak. Director panel prikazuje da aplikacija ne pravi lokalne database backup fajlove.

## 6. Brzi API test

```powershell
curl http://localhost:3000/api/health
```

Health odgovor treba da vrati `database: "postgres"`.

## 7. Deploy napomene

- Ne kopiraj lokalne `backend/uploads` foldere u deploy osim ako namerno migriras stvarne fajlove.
- Pokreni `npm.cmd audit --audit-level=moderate` i testove pre deploy-a.
- Za Playwright koristi posebnu test PostgreSQL bazu preko `DATABASE_URL`.
- Rollback baze radi kroz Supabase restore ili dogovoreni PostgreSQL maintenance prozor.
