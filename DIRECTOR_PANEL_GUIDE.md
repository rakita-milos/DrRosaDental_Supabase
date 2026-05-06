# Director Panel - Korisniški Vodič

## 📋 Pregled

Dr Rosa web aplikacija sada ima **kompletnu director-only sekciju** sa role-based pristupom. Samo direktoristi mogu pristupiti reporting sistemu.

---

## 🔐 Sistem Autentifikacije

### Login Kredencijali

#### Direktor (Director Access)
- **Email:** `director@drosa.com`
- **Lozinka:** vrijednost iz `backend/.env` -> `INITIAL_DIRECTOR_PASSWORD`
- **Pristup:** Director Panel sa svim izvještajima

#### Zaposlenik (Staff Access)
- **Email:** `staff@drosa.com`
- **Lozinka:** vrijednost iz `backend/.env` -> `INITIAL_STAFF_PASSWORD`
- **Pristup:** Samo glavni dashboard, unos novih pacijenata i zapisa

### Kako se Prijatelj

1. Otvorite `login.html` stranicu
2. Unesite email i lozinku
3. Odaberite odgovarajuću ulogu:
   - **Zaposlenik** - Za obične radnike i medicinski ličnjak
   - **Direktor Ordinacije** - Za direktoriste ordinacije
4. Kliknite "Prijavi se"

---

## 📊 Director Panel - Dostupni Izvještaji

### 1. Finansijski Izvještaj (💰)
Detaljno finansijsko stanje ordinacije.

**Prikazuje:**
- ✅ Ukupan prihod (sve procedure)
- 💸 Ukupno dugovanja (neplaćeni iznosi)
- 📈 Procenat naplaćenih sredstava
- 📋 Tabela po pacijentima sa:
  - Broj pregleda
  - Ukupan iznos
  - Plaćeno
  - Dugovanje
  - Procenat plaćanja

**Koristit ćete za:**
- Praćenje cash flow-a
- Identifikovanje pacijenata sa velikim dugovanjima
- Analizu profitabilnosti

---

### 2. Pacijenti Izvještaj (👥)
Detaljni pregled pacijentske baze.

**Prikazuje:**
- 👥 Ukupan broj pacijenata
- 🔄 Redovni pacijenti (ponovljeni posjeti)
- ✨ Novi pacijenti (prvi posjeti)
- 📋 Tabela sa:
  - Pacijent ime
  - Broj posjeta
  - Datum zadnje posjete
  - Status plaćanja (✅ ili 🔴)
  - Iznos dugovanja

**Koristit ćete za:**
- Praćenje rasta pacijentske baze
- Identifikovanje lojalnih pacijenata
- Analiziranje retencije pacijenata
- Planiranje marketinške kampanje

---

### 3. Doktori Izvještaj (👨‍⚕️)
Produktivnost i opterećenje doktora.

**Prikazuje:**
- 👨‍⚕️ Imena doktora
- 📊 Broj pregleda po doktoru
- 👥 Broj pacijenata koje tretira
- 📈 Procenat od ukupnog rada

**Koristit ćete za:**
- Praćenje produktivnosti doktora
- Identifikovanje preopterećenosti
- Planiranje radnog vremena
- Evaluacija performansi

---

### 4. Postupci Izvještaj (🔧)
Raspodjela i učestalost različitih procedura.

**Prikazuje:**
- 🔧 Vrsta postupka/procedure
- 🔢 Broj izvršenih procedura
- 📊 Procenat od ukupnog rada
- 💰 Prosječna naplata po procedure

**Koristit ćete za:**
- Analiziranje popularne procedure
- Planiranje opreme i materijala
- Pricing strategija
- Specijalizacija ordinacije

---

## 🔒 Sigurnosne Mjere

✅ **Implementirane Zaštite:**

1. **Session-based Authentication**
   - Sesija se čuva u `localStorage`
   - Automatski logout kada se obrišu kredencijali

2. **Role-Based Access Control**
   - Zaposlenik NIKAD ne može pristupiti director panelu
   - Direktan pristup URL-u `director-panel.html` automatski preusmjerava na login

3. **Session Validation**
   - Sve stranice provjeravaju validnost sesije pri učitavanju
   - Bez sesije = automatski preusmjerna na login

4. **Logout Dugme**
   - Dostupno na svim zaposlenima stranicama
   - Briše sesiju iz localStorage-a
   - Redirekcija na login stranicu

---

## 📱 Funkcionalnosti po Stranici

### Login Stranica (`login.html`)
- Email/Password unos
- Role selection (Zaposlenik/Direktor)
- Demo kredencijali prikazani na stranici
- Validation poruke za pogrešne kredencijale

### Director Panel (`director-panel.html`)
- 4 izvještaj kartice sa ikonama
- "Ulogovani kao" informacija
- Odjava dugme
- Interaktivni izvještaji sa povratkom na početak

### Zaposlenike Stranice
- `index.html` - Dashboard sa statistikom
- `new-entry.html` - Kreiranje novog zapisa
- `all-records.html` - Pregled svih pacijenata
- `patient-dashboard.html` - Individualni pacijent
- `new-patient.html` - Registracija novog pacijenta

---

## 📊 Primjer Podataka

Aplikacija dolazi sa 10 demo zapisa za testiranje:

| Pacijent | Procedure | Doktor | Status | Plaćanje |
|----------|-----------|--------|--------|----------|
| Ana Kovač | Kontrola i čišćenje | Dr Rosa | Zakazano | ✅ Plaćeno |
| Marko Petrović | Plomba | Dr Rosa | Završeno | ✅ Plaćeno |
| Ivana Babić | Izbeljivanje | Dr Rosa | U tijeku | 🔴 Delimično |
| Luka Horvat | Most | Dr Novak | Zakazano | ✅ Plaćeno |
| Petar Jurić | Endodontija | Dr Novak | U tijeku | 🔴 Dugovanje |

---

## 🔄 Workflow za Director

### Dnevni Pregled
1. Prijavite se kao direktor
2. Pregledate Financial Report za gotovinu situaciju
3. Provjerite Patients Report za nove pacijente
4. Analizirate Doctors Report za produktivnost
5. Gledate Procedures Report za raznolikost usluga

### Nedeljena Analiza
1. Uporedite prihod sa prethodnom nedelj om
2. Analizirate redovne vs nove pacijente
3. Gledate opterećenje doktora
4. Planira te promociju popularne procedure

### Mesečan Pregled
1. Totalni prihod i troškovi
2. Rast pacijentske baze
3. Performanse doktora
4. ROI na procedure i oper acije

---

## ⚙️ Tehnički Detalji

### Fajlovi Sistema
- `src/pages/login.html` - Login forma
- `src/pages/director-panel.html` - Director panel
- `src/scripts/login.js` - Autentifikacija logika
- `src/scripts/director-reports.js` - Izvještaji i data processing

### Data Storage
- Sve sesije: `localStorage['drrosa-session']`
- Svi zapisi: `localStorage['drrosa-records']`
- Svi pacijenti: `localStorage['drrosa-patients']`

### Security Checks
Svaka stranica poziva `checkDirectorAccess()` ili `checkStaffAccess()` pri učitavanju

---

## 🚀 Pokretanje Aplikacije

```bash
# U root foldera aplikacije
python -m http.server 8000

# Otvorite browser na:
http://localhost:8000/src/pages/login.html
```

---

## 📝 Bilješke za Dalje Razvoja

- [ ] Integracija sa pravom bazom podataka umjesto localStorage
- [ ] PDF export za izvještaje
- [ ] Email slanje izvještaja
- [ ] Grafički prikazi izvještaja (charts)
- [ ] Kalendar pregleda
- [ ] Integracija sa kasa/billing sistemom
- [ ] Backup i restore funkcije
- [ ] Auditlog svih operacija

---

**Verzija:** 1.0  
**Zadnje ažurirano:** Maj 2026  
**Stanje:** ✅ Production Ready
