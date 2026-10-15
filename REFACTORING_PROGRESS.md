# Refaktorizacija: prvi paket ispravki

Datum: 2026-10-14. Grana: `refactor/audit-remediation-20261014`.
Početna revizija: `c0ff2c0`. Izmene su lokalne; produkcija nije korišćena.

## Urađeno

| Nalaz iz analize | Izmena | Dokaz |
| --- | --- | --- |
| A01 | Izmena posete, tretmana i naplate koristi jednu transakciju i vezu | HTTP test izaziva grešku pri upisu uplate i poredi sve prethodne redove posete, tretmana i naplate |
| A03–A04 | Kanonski statusi `Plaćeno`/`Delimično`; karton prepoznaje pozitivan dug nezavisno od stare oznake | Funkcionalni testovi obračuna i stvarni API odgovor |
| A05 | Autocomplete pamti ID pacijenta; dvosmisleno ime bez izbora nije prihvaćeno | Browser bira drugu od dve istoimene osobe i proverava zapis po ID-ju |
| A06, deo | Dodatne uplate i izmene zaključavaju isti red posete pre čitanja i obračuna | Šest paralelnih EUR uplata, očuvani ID-jevi uplata i tačan dug; zaključavanje preko dve nezavisne konekcione grupe |
| A09, deo | Kreiranje i izmena kliničkih beleški i zubnog statusa proveravaju pripadnost posete pacijentu | HTTP odbija tuđu posetu sa 400 i ne menja prethodnu vezu |
| A10 | Preostalih 16 asinhronih ruta bez lokalnog try/catch koristi postojeći `asyncRoute` | Greška stvarnog SQL upita vraća JSON 500; sledeći health zahtev uspeva |
| A11 | Neuspela početna provera baze može se ponoviti; paralelni zahtevi dele isti pokušaj | Prvi pokušaj pada, naredni uspeva i ostaje keširan |
| A13 | Podrazumevani poslovni datum koristi postojeći helper za Europe/Belgrade | Test oko lokalne ponoći |
| A15, deo | `/api/records` podržava `patientId`/`patient_id`; karton sa ID-jem učitava samo posete tog pacijenta | API izolacija rezultata i desktop/mobile testovi kompletne istorije |

Valutni upiti unutar izmene koriste istu transakcijsku konekciju. Time se izbegava čekanje na drugu konekciju kada je `PG_POOL_MAX=1`.

API odgovori i postojeće nefiltrirano učitavanje ostaju kompatibilni. Nema nove migracije niti automatskog prepisivanja istorijskih statusa.

## Provere

- Početno stanje: 173 backend testa prolaze, 2 integraciona preskočena.
- Završna backend provera sa izolovanom PostgreSQL bazom: **200 prolazi, 0 pada, 0 preskočenih**.
- Sintaksa: **120 JavaScript fajlova**, bez grešaka.
- Browser: 20 od 21 scenarija prolazi pri prvom pokretanju `new-entry`, `patient-visits` i `primary-teeth` testova.
- Preostali scenario je zavisio od podrazumevanih permisija osoblja. Test sada eksplicitno uklanja `clinical:write`, proverava zabranu i u `finally` vraća prethodne permisije; ponovljeni scenario prolazi.
- Potvrđeno: 10 poseta po strani, filtriranje cele istorije od 52 posete, jedan otvoren detalj, desktop/mobile, mešovita denticija i sačuvane izmene.
- `git diff --check` prolazi.

Testovi koriste nov Docker kontejner `drrosa-audit-20261014`, bazu `drrosa_test` i port `127.0.0.1:55414`. Svi podaci su sintetički.

Backend integracione i browser suite treba pokretati redom, ili sa zasebnim bazama. Istovremeno pokretanje nad istom bazom može omogućiti da browser izabere privremenog doktora iz backend fixture-a, pa njegovo naknadno brisanje pada zbog stranog ključa. Završna backend provera izvršena je nakon završetka browser suite-a.

Novi backend integracioni test koristi eksplicitni `SESSION_TEST_DATABASE_URL` i bezbednosnu proveru lokalne test baze. Bez tog parametra se preskače. Njegovo uključivanje u CI posle migracija ostaje naredni zadatak.

## Preostali plan

Ovo je prvi paket, ne završetak celog plana.

1. T02: definisati izvore prihoda/cene/duga i ispraviti finansijske izveštaje, uključujući valute.
2. T06–T07: atomska numeracija računa i identitet/idempotentnost ERA događaja; prvo karakterizacioni testovi, zatim aditivne migracije.
3. T05/T08: zaštita od ponovljenih zahteva za uplatu, saldo po valuti i baza kao dodatna zaštita kliničkih veza nakon provere postojećih podataka.
4. T10: finansijske Joi šeme, atomski rate limiter i ostale vremenske granice.
5. T11–T12: objediniti čiste formule i postepeno izdvojiti domenske rute/UI module, bez promene javnog interfejsa.
6. T13: grupno učitavanje računa/planova/osiguranja, filtriranje pri unosu posete i merenje SQL upita/veličine odgovora.
7. T14: potvrditi kandidate za uklanjanje, uskladiti dependency lockfile-ove i ponoviti dostupnu proveru ranjivosti.
8. A18: razlikovati grešku od praznog rezultata i odbacivati zastarele odgovore pretrage.

Pre objavljivanja su potrebne odvojene provere stvarnog stanja podataka, konfiguracije i eventualnih novih migracija. Lokalni testovi nisu potvrda produkcione spremnosti.
