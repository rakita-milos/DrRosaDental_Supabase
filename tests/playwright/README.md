# Playwright Smoke Tests

Automatizovani smoke testovi za Dr Rosa aplikaciju.

## Sta pokrivaju

- Login za staff i director role
- Navigaciju kroz glavne staff stranice
- Unos novog pacijenta preko UI-ja
- Unos nove posete preko UI-ja
- Direktor panel i sve glavne izvestaje
- Osnovni klik na Excel/PDF export dugmad u direktor panelu

## Pokretanje

```bash
cd tests/playwright
npm install
npm test
```

Za vidljiv browser:

```bash
npm run test:headed
```

Config automatski pokrece backend iz `backend/server.js` ako lokalni health check vec nije aktivan. Lozinke cita iz `backend/.env`.

Za drugi host ili server koristi promenljivu:

```bash
PLAYWRIGHT_BASE_URL=https://your-server.example npm test
```
