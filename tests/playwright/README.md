# Playwright Smoke Tests

Automatizovani smoke testovi za Dr Rosa aplikaciju.

## Sta pokrivaju

- Login za staff i director role
- Navigaciju kroz glavne staff stranice
- Full CRUD tok za pacijenta preko UI-ja: create, read, update, delete
- Full CRUD tok za posetu preko UI-ja: create, read, update, delete
- Proveru da brisanje pacijenta sa istorijom bude blokirano uz potvrdu i poruku
- Direktor panel i sve glavne izvestaje
- Direktor admin deo za sifarnike: otvaranje, dodavanje i brisanje test sifre
- Smena u sifarniku se testira sa vremenom i vise odabranih dana
- Valute u sifarniku sakrivaju grupu/cenu i prikazuju polja za kurs
- Osnovni klik na Excel/PDF export dugmad u direktor panelu

## Struktura

Testovi koriste Page Object Model:

```text
tests/playwright/
  pages/
    LoginPage.js
    DashboardPage.js
    NewPatientPage.js
    NewEntryPage.js
    AllRecordsPage.js
    PatientDashboardPage.js
    DirectorPanelPage.js
  utils/
    auth.js
    env.js
  tests/
    smoke.spec.js
```

`smoke.spec.js` sadrzi scenarije, dok su selektori i akcije smesteni u page object klase. Non-login testovi koriste test JWT iz `backend/.env`, da ne trose login rate limiter; pravi UI login je pokriven posebnim testom.

## Pokretanje

```bash
cd tests/playwright
npm install
npm test
```

Za dodatne regression E2E scenarije:

```bash
npm run test:regression
```

Regression testovi posle testa brisu test pacijente, posete i sifarnike koje kreiraju.

Za vidljiv browser:

```bash
npm run test:headed
```

Config automatski pokrece backend iz `backend/server.js` ako lokalni health check vec nije aktivan. Lozinke cita iz `backend/.env`.

Za drugi host ili server koristi promenljivu:

```bash
PLAYWRIGHT_BASE_URL=https://your-server.example npm test
```
