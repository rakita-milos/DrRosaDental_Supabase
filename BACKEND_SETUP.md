# Backend Setup Guide - Produkcija

Ova instalacija je podesena za ordinaciju: aplikacija moze biti na serveru, a SQLite baza na USB disku.

## 1. Konfigurisi `backend\.env`

Primer za Windows server i USB disk na slovu `E:`:

```env
NODE_ENV=production
PORT=3000
JWT_SECRET=promeni-ovo-u-jedinstven-tajni-kljuc-od-minimum-32-karaktera
CORS_ORIGIN=https://adresa-vaseg-frontenda.example
SQLITE_DB_PATH=E:\DrRosaData\drosa.sqlite
BACKUP_DIR=E:\DrRosaData\backups
UPLOAD_DIR=E:\DrRosaData\uploads
SCANNER_IMPORT_DIR=E:\DrRosaData\scanner-inbox
BACKUP_ENCRYPTION_KEY=postavi-jak-kljuc-za-backup-od-minimum-32-karaktera
STAFF_DEFAULT_PERMISSIONS=patients:read,patients:write,records:read,records:write,calendar:read,calendar:write,documents:read,documents:write
INITIAL_DIRECTOR_PASSWORD=postavi-jaku-direktor-lozinku
INITIAL_STAFF_PASSWORD=postavi-jaku-staff-lozinku
```

Pravila:
- `JWT_SECRET` mora biti jedinstven i dug najmanje 32 karaktera.
- `INITIAL_DIRECTOR_PASSWORD` i `INITIAL_STAFF_PASSWORD` moraju biti dugi najmanje 12 karaktera i koriste se samo kada je baza prazna.
- `CORS_ORIGIN` mora biti tacna adresa frontenda. Za vise adresa koristi zarez.
- `BACKUP_DIR` je direktorijum za enkriptovane backup fajlove. `SQLITE_BACKUP_DIR` je podrzan kao legacy fallback.
- `BACKUP_ENCRYPTION_KEY` mora biti odvojen od `JWT_SECRET` u produkciji; backend nece startovati ako nedostaje ili je isti.
- `UPLOAD_DIR`, `SCANNER_IMPORT_DIR` i `STAFF_DEFAULT_PERMISSIONS` su obavezni u produkciji; backend nece startovati ako nedostaju.
- `STAFF_DEFAULT_PERMISSIONS` namerno navedi po principu najmanjih potrebnih prava. Billing/clinical write dodaj samo ako staff zaista treba ta ovlascenja.
- USB treba da ima stalno isto slovo diska. Na Windows-u ga podesi kroz Disk Management.

## 2. Instaliraj dependency-je

```powershell
cd C:\Users\milos\DrRosaWebApp\backend
npm.cmd install
```

## 3. Pokreni backend

```powershell
cd C:\Users\milos\DrRosaWebApp\backend
npm.cmd start
```

Prvi login koristi:
- `director@drosa.com` i lozinku iz `INITIAL_DIRECTOR_PASSWORD`
- `staff@drosa.com` i lozinku iz `INITIAL_STAFF_PASSWORD`

Posle prvog uspesnog starta, cuvaj `.env` samo na serveru i ne deli ga. Ako pravis novu praznu bazu, ponovo podesi inicijalne lozinke.

## 4. Backup baze

```powershell
cd C:\Users\milos\DrRosaWebApp\backend
npm.cmd run backup
```

Komanda pravi enkriptovan `.sqlite.enc` backup. Ne pravi plaintext kopiju baze.

Pre vadjenja USB-a zaustavi backend servis da SQLite fajl ne ostane otvoren.

## 5. Brzi API test

```powershell
curl -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"director@drosa.com","password":"vasa-direktor-lozinka","role":"director"}'
```

Zatim testiraj health endpoint:

```powershell
curl http://localhost:3000/api/health
```

Health odgovor ne prikazuje putanju baze.

## 6. Logovi

Svi runtime `.log` fajlovi treba da budu u root folderu `logs\`.

- `start-app.bat` upisuje backend output u `logs\backend.out.log`.
- `start-app.bat` upisuje backend error output u `logs\backend.err.log`.
- Stari lokalni logovi mogu biti u `logs\archive\`.
- Brisanje starih logova radi skripta:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cleanup-logs.ps1 -Days 30
```

Preporuka: runtime `.log` fajlove brisati posle 30 dana. Audit/security podatke iz baze ne brisati ovim pravilom; za njih koristi pravni/ordinacijski retention policy.

## 7. Production deploy napomene

- Ne kopiraj lokalne `backend/data`, `backend/uploads` ili `backend/backups` foldere u deploy osim ako namerno migriras stvarne podatke.
- Pokreni `npm.cmd audit --audit-level=moderate` i testove pre deploy-a.
- Za Playwright koristi izolovani default `http://localhost:3010`; ne testiraj protiv produkcione baze.

## 8. HTTPS, servis i rollback

- Aplikaciju pokreni iza HTTPS reverse proxy-ja ili load balancera koji terminira TLS za javni domen iz `CORS_ORIGIN`.
- Backend proces pokreni kroz servisni menadzer koji restartuje proces posle pada, na primer Windows Service/NSSM/PM2/systemd u zavisnosti od servera.
- Pre deploy-a napravi enkriptovan backup baze komandom `npm.cmd run backup` i proveri da backup fajl postoji u `BACKUP_DIR`.
- Rollback aplikacije: zaustavi servis, vrati prethodni git tag ili prethodni release folder, pokreni `npm.cmd ci --omit=dev` u `backend` ako se dependency set promenio, zatim startuj servis.
- Rollback baze radi samo iz direktor panela ili dogovorenog maintenance prozora, jer restore menja aktivnu SQLite bazu i zahteva da korisnici ne rade u aplikaciji.
- Tokom restore operacije backend vraca `503 Maintenance in progress` za druge API zahteve dok se aktivna SQLite baza zamenjuje.
- Legal export je ogranicen `limit` parametrom i u odgovoru prikazuje `meta.counts` i `meta.truncated`; za veliki kompletan izvoz radi ga u maintenance prozoru.
