# 🚀 Backend Setup Guide - Brza Instalacija

## Korak 1: SQLite konfiguracija

Backend sada koristi SQLite. Baza je jedan fajl i putanja se podesava u `backend\.env`:

```env
SQLITE_DB_PATH=./data/drosa.sqlite
SQLITE_BACKUP_DIR=./backups
```

Ako zelis bazu na USB-u, koristi apsolutnu putanju, na primer:

```env
SQLITE_DB_PATH=E:\DrRosaData\drosa.sqlite
SQLITE_BACKUP_DIR=E:\DrRosaData\backups
```

Server automatski pravi folder, bazu, tabele i demo naloge pri prvom pokretanju.

Demo nalozi:

```text
director@drosa.com / password123
staff@drosa.com / password123
```

Za backup baze:

```powershell
cd C:\Users\milos\DrRosaWebApp\backend
npm.cmd run backup
```

---

## Staro PostgreSQL uputstvo

Sekcija ispod je zastarela i ostaje samo kao istorijska referenca.

## Korak 1: PostgreSQL Instalacija

### Na Windows:
1. Preuzmi [PostgreSQL](https://www.postgresql.org/download/windows/)
2. Pokreni installer, prosledi do kraja
3. Zapamti password za `postgres` korisnika (npr: `postgres`)
4. Prihvati default port: **5432**

### Provjera instalacije:
Otvori PowerShell/CMD i pokušaj:
```powershell
psql -U postgres
```

Ako radi, unesi: `\q` za izlazak

---

## Korak 2: Kreiraj Bazu Podataka

U PowerShell/CMD kao Administrator:

```powershell
# Kreiraj novu bazu
createdb -U postgres drosa_clinic

# Provjera da li je kreirana
psql -U postgres -l | findstr drosa_clinic
```

---

## Korak 3: Popuni Shemu

```powershell
# Prijeđi u backend direktorij
cd C:\Users\milos\DrRosaWebApp\backend

# Učitaj SQL shemu
psql -U postgres -d drosa_clinic -f database.sql
```

**Trebao bi vidjeti:**
```
CREATE TABLE
CREATE INDEX
INSERT 0 3
INSERT 0 2
```

Provjera podataka:
```powershell
psql -U postgres -d drosa_clinic -c "SELECT * FROM users;"
```

---

## Korak 4: Node.js & Dependencije

### Instalacija Node.js:
Preuzmi [Node.js LTS](https://nodejs.org/) i instaliraj

Provjera:
```powershell
node --version
npm --version
```

### Instalacija dependencija:
```powershell
cd C:\Users\milos\DrRosaWebApp\backend
npm install
```

Trebao bi vidjeti `added XX packages` bez grešaka.

---

## Korak 5: Konfiguraj .env

Uredi `backend\.env` sa tvojim PostgreSQL passwordom:

```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres          # 👈 ZAMIJENI sa tvojim passwordom
DB_NAME=drosa_clinic
PORT=3000
JWT_SECRET=your-secret-key-change-in-production
```

---

## Korak 6: Pokreni Server

```powershell
# Za development (auto-reload)
npm run dev

# Ili obična verzija
npm start
```

**Trebao bi vidjeti:**
```
✓ Database connected successfully
🏥 Dr Rosa Backend API running on http://localhost:3000
```

---

## 🧪 Testiranje API-ja

### 1. Test Login (sa Postman ili curl)

```powershell
curl -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"director@drosa.com","password":"password123"}'
```

Trebao bi vidjeti `token` u odgovoru.

### 2. Test Pacijenata

```powershell
# Zamijeni TOKEN sa stvarnim tokenom iz login odgovora
curl -X GET http://localhost:3000/api/patients `
  -H "Authorization: Bearer TOKEN"
```

---

## 🔗 Frontend Integracija

### Update login.js:
```javascript
// Stara verzija: localStorage
// Nova verzija: API

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const response = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('drrosa-token', data.token);
      localStorage.setItem('drrosa-user', JSON.stringify(data.user));
      
      // Redirect based on role
      if (data.user.role === 'director') {
        window.location.href = 'director-panel.html';
      } else {
        window.location.href = 'index.html';
      }
    } else {
      alert('Pogrešan email ili password');
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('Greška pri logiranju');
  }
}
```

---

## 🆘 Problemi i Rješenja

### Problem: "psql is not recognized"
**Rješenje:** Dodaj PostgreSQL u PATH
- Windows: Pretraži "Environment Variables" → Edit System Environment Variables
- Path → New: `C:\Program Files\PostgreSQL\15\bin` (verzija može varirati)
- Restart PowerShell

### Problem: "connect ECONNREFUSED"
**Rješenje:** PostgreSQL nije pokrenut
```powershell
# Windows - pokreni PostgreSQL servis
Get-Service postgresql-x64-15 | Start-Service

# ili koristi Services.msc i pronađi PostgreSQL
```

### Problem: "password authentication failed"
**Rješenje:** Pogrešan password u `.env`
- Resetiraj password:
```powershell
psql -U postgres -c "ALTER USER postgres PASSWORD 'nova-lozinka';"
```
- Ažuriraj `.env`

### Problem: "npm install greške"
**Rješenje:** Obriši node_modules i pokušaj ponovno
```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

---

## ✅ Provjera Instalacije

Sve bi trebalo biti OK ako vidiš:

```powershell
✓ Database connected successfully
🏥 Dr Rosa Backend API running on http://localhost:3000
```

I ako login vraća token:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "director@drosa.com",
    "name": "Dr Rosa Bašić",
    "role": "director"
  }
}
```

---

## 📚 Dalje Korake:

1. ✅ Backend je running
2. ⏭️ Update frontend da koristi API umjesto localStorage
3. ⏭️ Test login/logout flow sa API-jem
4. ⏭️ Test director reports sa API-jem
5. ⏭️ Deploy na produkciju

Pitanja? Provjerite `backend/README.md` za detalje API-ja.
