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
SQLITE_BACKUP_DIR=E:\DrRosaData\backups
INITIAL_DIRECTOR_PASSWORD=postavi-jaku-direktor-lozinku
INITIAL_STAFF_PASSWORD=postavi-jaku-staff-lozinku
```

Pravila:
- `JWT_SECRET` mora biti jedinstven i dug najmanje 32 karaktera.
- `INITIAL_DIRECTOR_PASSWORD` i `INITIAL_STAFF_PASSWORD` moraju biti dugi najmanje 12 karaktera i koriste se samo kada je baza prazna.
- `CORS_ORIGIN` mora biti tacna adresa frontenda. Za vise adresa koristi zarez.
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
