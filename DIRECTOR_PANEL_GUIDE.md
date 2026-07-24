# Director Panel Guide

## Pregled

Director panel je administratorski deo Dr Rosa aplikacije. Dostupan je samo korisniku sa `director` rolom i koristi isti backend, Supabase PostgreSQL bazu i HttpOnly cookie sesiju kao ostatak aplikacije.

Panel se otvara na:

```text
/src/pages/director-panel.html
```

## Pristup

Prvi direktor i staff nalog se kreiraju iz backend environment vrednosti samo kada je tabela `users` prazna.

- Director email: `director@drosa.com`
- Staff email: `staff@drosa.com`
- Lozinke: vrednosti iz `INITIAL_DIRECTOR_PASSWORD` i `INITIAL_STAFF_PASSWORD`

Frontend u `localStorage` cuva samo prikazne podatke sesije. Pravi access/refresh tokeni su u HttpOnly cookie-jima koje postavlja backend.

## Glavne Sekcije

Director panel sadrzi:

- finansijski izvestaj
- izvestaj o pacijentima
- izvestaj o doktorima
- izvestaj o postupcima
- Excel-style tabove: PAZARI, Hirurgija, Protetika, Ortodoncija, Troskovi, Ukupno
- dnevnu kasu
- administraciju sifarnika
- administraciju doktora
- javno/onlajn zakazivanje
- Google Calendar integraciju
- backup/security status, audit log, sesije, 2FA i legal export

## Administracija Doktora

U sekciji `Doktori` direktor moze da dodaje i menja doktore.

Polja za kalendar:

- `Google color ID`: Google Calendar `colorId` ili event label ID koji se koristi za mapiranje Google event-a na doktora.
- `Boja u kalendaru`: lokalna boja termina za tog doktora.
- `Boja teksta`: lokalna boja teksta na terminu.

Kalendar aplikacije koristi boju doktora pri prikazu termina. Kada se Google event uvozi u aplikaciju, backend pokusava da prepozna doktora preko Google boje ili label ID-a. Ako ne moze da prepozna doktora, koristi prvog aktivnog doktora kao fallback.

## Google Calendar Integracija

Google Calendar podesavanja su u direktor panelu u sekciji `Google Calendar`.

Obavezna podesavanja:

- Gmail nalog ordinacije
- Google Calendar ID, npr. `primary` ili konkretan calendar ID
- OAuth Client ID
- OAuth Client Secret
- Redirect URI
- smer sinhronizacije
- sync enabled toggle

Za dvosmernu sinhronizaciju smer mora biti:

```text
two_way
```

### OAuth Tok

OAuth kod se ne cuva kao trajno podesavanje. On je jednokratan Google authorization code.

Tok je:

1. Sacuvati OAuth Client ID, Client Secret i Redirect URI.
2. Kliknuti `Otvori Google autorizaciju`.
3. Google vraca callback URL sa `code=` parametrom.
4. Uneti taj kod u polje `OAuth kod`.
5. Kliknuti `Povezi OAuth kod`.
6. Backend menja kod za Google access/refresh tokene i cuva tokene u `google_calendar_settings`.

Kada je OAuth povezan, polje `OAuth kod` je sakriveno. Dugme prikazuje `Ponovo povezi OAuth`; tek tada se otvara unos novog koda.

Za proveru postojece veze koristi se `Proveri OAuth konekciju`. To dugme ne trazi novi kod; backend koristi sacuvani refresh/access token i poziva Google Calendar API.

### Dugmad Za Sync

`Testiraj sinhronizaciju`

- obradjuje lokalni sync queue iz aplikacije ka Google Calendar-u
- ako vrati `Obradjeno: 0`, to znaci da trenutno nema lokalnih pending stavki za slanje
- ne znaci da je Google pull izvrsen

`Povuci izmene iz Google-a`

- povlaci evente iz Google Calendar-a u lokalni kalendar aplikacije
- koristi ogranicen prozor da ne probije Vercel timeout:
  - 1 dan unazad
  - 14 dana unapred
  - do 50 Google event-a po pozivu
- ne forsira veliki full reset pri svakom kliku
- ako treba povuci starije Google evente, backend ruta podrzava `daysPast`, `daysFuture`, `limit` i `reset`, ali to treba koristiti pazljivo zbog Vercel timeout limita

### Import Google Event-a

Ako Google event nema lokalni Dr Rosa appointment ID:

- aplikacija kreira lokalni termin
- naslov Google event-a postaje naziv termina/procedure
- pacijent se postavlja na fallback pacijenta `Google Calendar Import`
- originalni Google naslov, opis i lokacija idu u notes
- ako postoji konflikt sa doktorom/stolicom, termin se i dalje importuje, ali notes dobija upozorenje o konfliktu

Ovo omogucava da se Google Calendar i lokalni kalendar poravnaju cak i kada pacijent jos nije povezan sa kartonom u aplikaciji.

## Supabase Polja Za Google Calendar

Tabela `doctors` mora imati:

```sql
google_color_id text
calendar_color text
calendar_text_color text
```

Tabela `google_calendar_settings` cuva:

- OAuth client podesavanja
- access/refresh tokene
- sync direction
- sync enabled status
- last sync timestamps
- Google events sync token

Preporuceni search path za backend je:

```text
PG_SEARCH_PATH=app,public
```

## Troubleshooting

`Test sinhronizacije je zavrsen. Obradjeno: 0.`

To je normalno ako nema lokalnih pending promena za slanje ka Google-u.

`Povuci izmene iz Google-a` vrati `504 FUNCTION_INVOCATION_TIMEOUT`

Vercel je prekinuo backend funkciju. Najcesci uzrok je prevelik Google pull. Trenutni kod koristi ogranicen prozor od 1 dan unazad do 14 dana unapred da se to izbegne.

`OAuth code is required`

To se javlja samo kada se pokusava novo povezivanje OAuth-a. Za proveru postojece veze treba koristiti `Proveri OAuth konekciju`.

`could not determine data type of parameter $1`

Ovo je bila Postgres greska u mapiranju Google boje na doktora i popravljena je eksplicitnim `text` cast-om u SQL upitu.

## Pre Deploy Provere

Pre deploy-a pokrenuti:

```powershell
npm.cmd --prefix backend test
npm.cmd run vercel-build
```

Za lokalni smoke test backend-a:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/health
```

## Status Dokumenta

Last updated: July 23, 2026
Status: current for Supabase/PostgreSQL runtime, Google Calendar OAuth, two-way pull and doctor color mapping.
