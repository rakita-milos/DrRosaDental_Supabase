# Playwright Smoke Tests

Automatizovani smoke testovi za Dr Rosa aplikaciju.

## Sta pokrivaju

- Login za staff i director role
- Smoke proveru svih glavnih stranica za staff i director role
- Proveru redirect/access pravila za nezalogovane, staff i director korisnike
- Full CRUD tok za pacijenta preko UI-ja: create, read, update, delete
- Full CRUD tok za posetu preko UI-ja: create, read, update, delete
- Proveru da brisanje pacijenta sa istorijom bude blokirano uz potvrdu i poruku
- Direktor panel i sve glavne izvestaje
- Direktor admin deo za sifarnike: otvaranje, dodavanje i brisanje test sifre
- Smena u sifarniku se testira sa vremenom i vise odabranih dana
- Valute u sifarniku sakrivaju grupu/cenu i prikazuju polja za kurs
- Integracione tokove izmedju rola: staff unese podatke pa direktor vidi u izvestajima, direktor unese podatke pa staff vidi u evidenciji
- Integraciju sifarnika: direktor doda delatnost/postupak, staff ih vidi u unosu pregleda
- Excel/PDF export validaciju za kompletnu evidenciju, finansijski izvestaj i Excel-style PAZARI tab

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
    api.js
    cleanup.js
    exports.js
    env.js
  tests/
    app-smoke.spec.js
    reports-export.e2e.spec.js
    role-integration.e2e.spec.js
    regression.e2e.spec.js
    smoke.spec.js
```

Selektori i akcije su smesteni u page object klase. Non-login testovi koriste test JWT iz `backend/.env`, da ne trose login rate limiter; pravi UI login je pokriven posebnim testom.

## Test grupe

- `smoke.spec.js`: osnovni UI login, navigacija, CRUD i direktor panel smoke.
- `app-smoke.spec.js`: ucitavanje svih glavnih stranica po rolama i access pravila.
- `role-integration.e2e.spec.js`: vidljivost podataka izmedju staff i director role, plus sifarnik -> unos pregleda.
- `reports-export.e2e.spec.js`: proverava da Excel/PDF export sadrzi stvarne filtrirane i izvestajne podatke.
- `regression.e2e.spec.js`: ciljane regresije za zastitu direktor panela, filtered export i direktor-kreiran postupak.

## Pokretanje

```bash
cd tests/playwright
npm install
npm test
```

Samo smoke testovi:

```bash
npm run test:smoke
```

Integracioni tokovi izmedju rola:

```bash
npm run test:integration
```

Export validacija:

```bash
npm run test:exports
```

Za dodatne regression E2E scenarije:

```bash
npm run test:regression
```

Integration, export i regression testovi posle testa brisu test pacijente, posete i sifarnike koje kreiraju.

Za vidljiv browser:

```bash
npm run test:headed
```

Config automatski pokrece backend iz `backend/server.js` ako lokalni health check vec nije aktivan. Lozinke cita iz `backend/.env`.

Za drugi host ili server koristi promenljivu:

```bash
PLAYWRIGHT_BASE_URL=https://your-server.example npm test
```
