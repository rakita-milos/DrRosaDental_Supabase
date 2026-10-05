# Login i sesije — priprema za objavu

Izmene su pripremljene na grani `fix/session-lifecycle` i odobrene za lokalni `main`. Produkcija nije promenjena; push i deployment zahtevaju prethodnu produkcionu migraciju.

## Uzrok i popravka

Stari frontend je paralelno obnavljao tokene posle 401/403 odgovora, a backend je poništavao stari refresh token pre uspešnog upisa novog. Zakasneli odgovor ili privremeni kvar mogli su da obrišu prijavu. Logout je zahtevao važeći access token, a već izdat JWT nije proveravao opoziv sesije.

Nova tabela `app.auth_sessions` predstavlja nezavisnu sesiju svakog browsera/uređaja. JWT sadrži ID sesije; svaki zaštićeni zahtev proverava njen opoziv i rokove u bazi. Rotacija je transakciona sa zaključavanjem reda i kratkim prihvatanjem prethodnog tokena (30 sekundi); paralelni zahtevi dobijaju isti naslednik. Frontend objedinjuje obnovu i, gde browser podržava Web Locks, koordinira tabove. Zakasneli odgovor ne može da vrati lokalno odjavljenu sesiju.

## Ponašanje aplikacije

- Isti nalog može istovremeno da radi na više uređaja. Rokovi svakog uređaja počinju njegovom prijavom.
- Tabovi istog browsera dele sesiju. Refresh i navigacija ne zahtevaju ponovnu prijavu dok je sesija važeća.
- Posle 20 minuta neaktivnosti sesija ističe. Samo interakcija sa vidljivom aplikacijom šalje aktivnost; pozadinski zahtevi i obnova tokena je ne produžavaju.
- Posle 8 sati od prijave potrebna je ponovna prijava, bez obzira na aktivnost. Ovo je podesiva politika, a ne univerzalna bezbednosna norma.
- Minut pre isteka prikazuje se upozorenje. Istek prekriva i zaključava ekran; ponovna prijava istog korisnika čuva otvoreni nacrt u memoriji stranice. Nacrt se ne upisuje u browser skladište i neće preživeti reload/zatvaranje.
- Sign out opoziva sesiju tog browsera, uključujući njegove tabove; drugi uređaji ostaju prijavljeni. Radi i kada je access token istekao.
- Ako mreža spreči potvrdu odjave, lokalni ekran ostaje odjavljen. Sledeća prijava prvo mora uspešno da završi odjavu na serveru.
- Zatvaranje taba/browsera nije pouzdan signal za trenutnu odjavu. Pri ponovnom otvaranju proveravaju se serverski rokovi; važeća sesija može da se nastavi. Browser može da obnovi cookies i tabove.
- 403 zbog nedostatka prava i privremeni 5xx/mrežni kvar ne brišu prijavu.

## Konfiguracija

U Preview i Production okruženju proveriti:

```text
ACCESS_TOKEN_TTL=15m
SESSION_IDLE_MINUTES=20
SESSION_ABSOLUTE_HOURS=8
```

`JWT_SECRET` mora biti isti za sve instance istog okruženja; Preview mora imati zasebnu test bazu i test korisnike. Ne kopirati produkcione podatke pacijenata u test okruženje. Autentikacija ove aplikacije je prilagođeni Express/JWT sistem nad PostgreSQL bazom na Supabase-u; podešavanje Supabase Auth samo po sebi neće popraviti ovaj tok.

## Redosled uvođenja

1. Pregledati diff i obezbediti backup baze i prethodni Vercel deployment.
2. Na staging Supabase-u primeniti `supabase/migrations/20261005172026_auth_session_lifecycle.sql`. Migracija je aditivna i ne menja pacijente ni staru tabelu `refresh_tokens`.
3. Proveriti da stvarna backend DB uloga može da čita/piše `app.auth_sessions` i koristi identity sekvencu. Tabela ima RLS, a browser uloge `anon`/`authenticated` nemaju pristup. Trenutni lokalni test koristi vlasničku PostgreSQL ulogu; privilegije produkcione uloge treba potvrditi zasebno.
4. Objaviti Vercel Preview povezan isključivo sa staging bazom. Proveriti cookies, HTTPS, CORS, promenljive, više serverless instanci, runtime logove i isporuku nove verzije `api.js`. Ne keširati autentikacione API odgovore.
5. Ponoviti scenarije: dva uređaja, više tabova, paralelna obnova, privremeni 503, odjava sa isteklim JWT-om, neaktivnost, apsolutni rok, ponovna prijava i vraćanje browser stranice iz istorije.
6. Tek nakon potvrde odobriti produkcionu migraciju, zatim deployment aplikacije. Stare sesije nemaju ID nove sesije pa će svi postojeći korisnici morati jednom ponovo da se prijave. Najaviti taj prekid.
7. Proveriti produkcione login/verify/activity/refresh/logout odgovore i logove bez beleženja lozinki, tokena ili sadržaja pacijenata.

Vercel konektor je u ovoj proveri vratio 403 za projekat `drrosabasicdental`; udaljene postavke, logovi i ponašanje više Vercel instanci još nisu potvrđeni.

## Rollback

Vratiti prethodni deployment, ali ostaviti aditivnu tabelu dok se problem ne proceni. Stara verzija nema proveru opoziva po ID-u sesije; samo vraćanje koda može ponovo prihvatiti stare JWT-ove. Ako je potrebno potpuno poništiti sve prijave pri rollback-u, planirati i zasebno odobriti opoziv starih refresh tokena i promenu `JWT_SECRET`. To odjavljuje sve korisnike. Ne brisati tabele ili podatke automatski.

## Lokalna provera

Korišćeni su PostgreSQL 17 u zasebnom Docker kontejneru, baza `drrosa_test`, sintetički korisnici i lokalni Express runtime. Backend testovi proveravaju transakciono vraćanje nakon greške, paralelnu rotaciju, izolaciju uređaja, rokove i opoziv već izdatog JWT-a. Browser testovi proveravaju stvarne cookies, API i stanje u bazi, kao i zaključavanje i nacrt na 1440/768/390 px.

```powershell
# Obezbediti dependencies, lokalnu bazu i NODE_PATH ako se koriste zajednički dependencies.
$env:SESSION_TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:PORT/drrosa_test'
$env:PGSSL = 'false'
node --test backend/test/*.test.js

# Pokrenuti lokalni test server sa istom disposable bazom i test lozinkama.
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3017'
$env:PLAYWRIGHT_TEST_DATABASE_URL = $env:SESSION_TEST_DATABASE_URL
$env:PLAYWRIGHT_ALLOW_DATABASE_MUTATION = '1'
# INITIAL_DIRECTOR_PASSWORD / INITIAL_STAFF_PASSWORD moraju odgovarati test korisnicima.
npx playwright test -c tests/playwright/playwright.ci.config.js tests/session-lifecycle.spec.js
```

Ovi rezultati potvrđuju lokalno ponašanje; ne predstavljaju potvrdu produkcionog deployment-a.

Prva provera 2026-10-05: **177/177 backend testova**, **6/6 browser scenarija**.

## Refaktorizacija

- Provera sesije i korisnika koristi jedan SQL upit umesto dva. Email JWT-a se i dalje poredi sa aktuelnim korisnikom, a prava se čitaju iz baze pri svakom zahtevu.
- Ažuriranje aktivnosti i vraćanje rezultata spojeni su kroz SQL CTE. `/auth/activity` sada koristi ukupno dva SQL upita umesto četiri (autentikacija + ažuriranje). Integracioni test broji stvarne pozive i proverava vraćene podatke.
- Aktivnost se koordinira između tabova kroz Web Locks i zajedničko vreme poslednjeg slanja; fallback bez Web Locks koristi isti zapis u localStorage, ali ne garantuje atomsku koordinaciju istovremenih tabova. Serverska sigurnost ne zavisi od browser zaključavanja.
- Stalna provera svake sekunde zamenjena je zakazanim upozorenjem i istekom. Promene sesije, povratak na stranicu i promena vidljivosti ponovo računaju rokove.
- Ekran ponovne prijave izdvojen je u `src/scripts/session-lock.js`, koji se učitava pre `api.js`. To poboljšava održavanje, uz jedan dodatni mali script fajl.
- Uklonjene su stare funkcije za legacy refresh tokene i duplirano učitavanje korisnika. Stara tabela ostaje radi bezbednog redosleda migracije/rollback-a.

Smanjenje broja SQL upita je potvrđeno lokalno; procenat ubrzanja produkcione aplikacije nije meren. Refaktorizacija ne menja politiku 20 minuta/8 sati niti uvodi keširanje opoziva ili prava korisnika.

Završna provera refaktorizacije: **178/178 backend testova**, **8/8 browser scenarija**. Provere sintakse i `git diff --check` prolaze. Test server i Docker kontejner su ugašeni nakon provere; izmene su proverene pre prebacivanja na lokalni main. GitHub push i produkciona migracija nisu izvršeni.
