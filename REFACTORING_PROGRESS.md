# Status refaktorizacije

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

Novi backend integracioni test koristi eksplicitni `SESSION_TEST_DATABASE_URL` i bezbednosnu proveru lokalne test baze. Bez tog parametra se preskače. Uključivanje u CI posle migracija završeno je u drugom paketu.

## Drugi paket — finansijski izveštaji i CI, 2026-10-15

Grana: `refactor/financial-reports-20261015`, od revizije `cfd5a63` na `main`.

Završeni T02 / A02 i povezane finansijske ispravke:

- Prihod obuhvata stvarne uplate za posete, uključujući delimične uplate. Računi i osiguranje se ne sabiraju ponovo jer mogu predstavljati isti rad.
- Cena posete posle popusta je sačuvani plaćeni deo + preostali dug. Prosečna cena postupka koristi celu cenu posete, umesto samo duga.
- Jedan SQL iskaz učitava konzistentan snapshot poseta, grupisanih delova uplata i kursnih metapodataka; podeljene uplate ne umnožavaju posete ni dug.
- Novi servis `financial-report-service.js` obračunava finansijski i proceduralni izveštaj. Postojeća uspešna API polja i njihovi tipovi ostaju dostupni; dodate su mape po valutama, redovi pacijenata i opis vrednovanja.
- Iznosi se u UI prikazuju odvojeno po valutama. Prihod koristi valutu stvarne uplate; tabela koristi valutu posete. Istoimeni pacijenti ostaju odvojeni po ID-ju.
- RSD prihod koristi sačuvani `amount_rsd` / kurs uplate. Za stare zbirne uplate bez delova koristi se važeći kurs. Dug, cena i procenat naplate vrednuju se po istim važećim kursevima; procenat je vrednosni udeo plaćenog dela, ne broj poseta.
- Zajednički backend podrazumevani kursevi ostaju postojeći EUR=117 i USD=108 kada nisu podešeni. Neispravan eksplicitni kurs ili nepodešena nestandardna valuta vraćaju kontrolisan 409, umesto pogrešnog RSD iznosa.
- KPI kartice, tabela i Excel/PDF finansijski izvoz koriste isti API rezultat. Greška uklanja stare iznose i onemogućava izvoz; finansijski prikaz ima ponovni pokušaj.
- Proceduralni izveštaj više nema rezervni lokalni obračun koji dug pogrešno prikazuje kao cenu u RSD.

Završen je i CI korak: backend HTTP/PostgreSQL testovi dobijaju eksplicitni lokalni test URL i izvršavaju se posle migracija i sintetičkog seed-a. GitHub Actions nije pokretan na udaljenom repozitorijumu.

Provere drugog paketa:

- **216 backend provera prolazi; 0 pada, 0 preskočenih**, na izdvojenoj lokalnoj PostgreSQL bazi.
- **8 Playwright scenarija prolazi**: finansijski prikaz/izvoz, ostali postojeći izvozi i razmena podataka između osoblja i direktora. Novi finansijski scenario je nakon završnih izmena ponovljen i dopunjen proverom prosečne cene i neuspešnog proceduralnog izveštaja.
- **124 JavaScript fajla prolazi sintaksnu proveru**; `git diff --check` prolazi.
- Pregledan je desktop screenshot novog finansijskog prikaza sa sintetičkim podacima. Posebna mobilna vizuelna provera ovog paketa nije izvođena.
- Novi kontejner: `drrosa-financial-20261015`; baza `drrosa_test`, port `127.0.0.1:55415`. Backend i browser suite pokretani su redom.

Nema nove SQL migracije, promene produkcionih podataka, novih zavisnosti, push-a ili deploymenta. Istorijski statusi i iznosi nisu prepisivani.

## Pregled preostalih nalaza

Završena su dva paketa, ne ceo plan.

1. T02 je završen za finansijski i proceduralni izveštaj; eventualno usklađivanje preostalih mesečnih tabela sa istim definicijama treba proveriti zasebno.
2. T06–T07: atomska numeracija računa i identitet/idempotentnost ERA događaja; prvo karakterizacioni testovi, zatim aditivne migracije.
3. T05/T08: zaštita od ponovljenih zahteva za uplatu, saldo po valuti i baza kao dodatna zaštita kliničkih veza nakon provere postojećih podataka.
4. T10: finansijske Joi šeme, atomski rate limiter i ostale vremenske granice.
5. T11–T12: objediniti čiste formule i postepeno izdvojiti domenske rute/UI module, bez promene javnog interfejsa.
6. T13: grupno učitavanje računa/planova/osiguranja, filtriranje pri unosu posete i merenje SQL upita/veličine odgovora.
7. T14: potvrditi kandidate za uklanjanje, uskladiti dependency lockfile-ove i ponoviti dostupnu proveru ranjivosti.
8. A18: razlikovati grešku od praznog rezultata i odbacivati zastarele odgovore pretrage.

Pre objavljivanja su potrebne odvojene provere stvarnog stanja podataka, konfiguracije i eventualnih novih migracija. Lokalni testovi nisu potvrda produkcione spremnosti.

## Završna provera za objavljivanje — 2026-10-16

Korisnik je odobrio commit, spajanje i push na `main`. Pre objavljivanja ponovljene su provere nad izolovanom bazom `drrosa_test`, port 55415:

- Backend: **216 prolazi, 0 pada, 0 preskočenih**; memorandum: **4 prolazi**; sintaksa: **124 JavaScript fajla**.
- Odabrani desktop Playwright testovi: **8 prolazi** (izvozi i razmena podataka između uloga).
- Finansijski scenario prolazi i na širini **390 px**. Vizuelna provera otkrila je sečenje teksta u tri fiksne kolone; kartice sada koriste prilagodljiv raspored. Posle ispravke ponovljen mobilni scenario prolazi i screenshot prikazuje cele iznose. Dodata je provera da naslovi i iznosi ne prelaze širinu svog elementa.
- Migracije, zavisnosti i produkcioni podaci nisu menjani. Preostale mesečne tabele ostaju zaseban zadatak; ovaj paket ih ne predstavlja kao završene.

Rezultat push-a, udaljenog CI-ja i eventualnog automatskog deploymenta proverava se zasebno nakon objavljivanja. Gornje tvrdnje o lokalnom stanju prethodnih paketa opisuju trenutak njihovih provera.

## Operativni plan daljeg rada — 2026-10-16

Ovaj odeljak određuje redosled narednog rada; prethodni pregled ostaje veza sa nalazima prvobitne analize. Status svih narednih faza je **planirano**, osim već navedenih završenih paketa. Izrada ovog plana ne predstavlja sprovedenu refaktorizaciju.

### Cilj i pravila

- POM primenjujemo na Playwright testove: Page Object čuva selektore i radnje, test opisuje scenario i proverava poslovni ishod. Zajedničke komponente izdvajamo kada postoji stvarno ponavljanje; priprema podataka i API fixture-i ne pripadaju Page Object klasama.
- CRUD ujednačavamo za evidencije pacijenata, termina, šifarnika i drugih resursa. Ovlašćenja i dozvoljene operacije ostaju specifični za resurs; medicinska i finansijska istorija ne dobija fizičko brisanje samo radi potpunog CRUD-a.
- Složene operacije, poput knjiženja, imaju eksplicitne poslovne servise i transakcije. Ciljni backend tok je ruta → validacija/ovlašćenja → servis → repository → baza. Jednostavna čitanja ne zahtevaju servis bez poslovne logike.
- Frontend postepeno razdvaja API pristup, stanje/poslovna pravila i prikaz. Ne uvodimo framework, ORM, TypeScript niti novi generički CRUD sloj kao uslov ovog plana.
- Čuvamo postojeće API ugovore, permisije, kliničku istoriju i finansijske iznose. Promenu ponašanja odvajamo od premeštanja koda, gde je praktično.
- Svaki paket ostavlja aplikaciju upotrebljivom. Koristimo postojeće transakcijske, asinhrone i datumske helpere; ne pravimo paralelne implementacije istih pravila.

### Faza 0 — zatvaranje trenutnog paketa

**Obuhvat:** pregled lokalnog diff-a finansijskih izveštaja i CI-ja, potvrda definicija prihoda/cene/duga, mobilna provera finansijskog prikaza i izvoza. Posebno popisati preostale mesečne tabele i proveriti njihove formule.

**Završeno kada:** poznat je tačan obuhvat paketa i sva odstupanja imaju zaseban zadatak; mobilni prikaz nema prelivanje ili neupotrebljive kontrole; API, tabela i izvoz daju usklađene iznose za delimične uplate, mešovite valute i istoimene pacijente. Ranije uspešne backend provere ostaju dokaz prethodne revizije; ponavljaju se kada nova izmena utiče na njih.

**Baza:** bez planirane migracije. Trenutna grana je `refactor/financial-reports-20261015`; rad nije objavljen.

### Faza 1 — pouzdanost računa i knjiženja (T06–T07, T05)

**Redosled:**

1. Snimiti postojeća pravila numeracije računa, godišnje/poslovne opsege, ručni broj i ponašanje pri otkazivanju. Odlučiti da li su praznine dozvoljene pre izbora brojača ili sekvence.
2. Zameniti `COUNT+1` atomskim dodeljivanjem broja; uskladiti jedinstvenost u bazi sa stvarnim opsegom numeracije. Sačuvati istorijske brojeve.
3. Definisati identitet ERA događaja i postupanje prema ponovljenim ili ispravljenim događajima; tek zatim uvesti idempotentno knjiženje.
4. Za uplate definisati ključ ponovljenog zahteva: isti ključ i isti sadržaj vraćaju prethodni ishod, a isti ključ sa drugim sadržajem daje kontrolisan konflikt. Provera ključa i finansijski upis moraju biti atomski; dve legitimne jednake uplate ostaju dozvoljene sa različitim ključevima.

**Završeno kada:** paralelno kreiranje ne proizvodi isti broj računa; ponovljen ERA događaj/uplata ne knjiži nov iznos; neuspeh vraća sve povezane promene; test pokriva i ponovno slanje posle prekida odgovora. Testovi koriste nezavisne konekcije, ne samo mock-ove.

**Baza:** očekivane aditivne migracije za brojač/ograničenja i identitet zahteva ili događaja; tačna struktura sledi nakon pregleda postojećih podataka i pravila.

### Faza 2 — valute, validacija i kliničke veze (T08–T10)

**Obuhvat:** saldo po valuti i dokumentovana politika konverzije/zaokruživanja; finansijske Joi šeme; pripadnost posete pacijentu i dodatna zaštita baze; vremenske granice i atomski limiter u stvarnom modelu izvršavanja aplikacije.

**Završeno kada:** različite valute se ne sabiraju bez eksplicitnog preračuna; neispravan iznos/kurs/datum se odbija pre upisa; tuđa poseta ne može biti povezana ni zaobilaženjem HTTP provere; ponašanje limita je provereno pri paralelnim zahtevima. Eventualne postojeće neusaglašene veze prvo se prijavljuju, bez automatskog prepisivanja istorije.

**Baza:** moguća aditivna ograničenja/indeksi i promena evidencije salda; potreba za migracijom određuje se za svaki zadatak zasebno. Ne menjati istorijske iznose na osnovu današnjeg kursa.

### Faza 3 — ujednačavanje POM-a

**Obuhvat:** prvo `DirectorPanelPage` i `reports-export.e2e.spec.js`, zatim unos posete, karton pacijenta, kalendar i prijava. Postojeće Page Object klase proširivati po potrebi. Ukloniti ponovljene selektore, predavanje internih CSS selektora iz scenarija i proizvoljna čekanja gde postoje stabilni signali spremnosti.

**Završeno kada:** obrađeni scenariji koriste imenovane radnje/elemente Page Object-a; provere poslovnih iznosa i ovlašćenja ostaju jasne u testovima; izmena rasporeda jednog ekrana ne zahteva promenu istog selektora u više testova. Mrežni mock-ovi i test podaci ostaju u spec-u ili odgovarajućim fixture-ima.

**Baza:** bez migracija. Ovo je prvi mali paket čistog organizacionog refaktoringa posle prioritetnih zaštita podataka.

### Faza 4 — backend moduli i dosledan CRUD (T11–T12)

**Redosled oblasti:** izveštaji → računi/uplate → posete/klinički podaci → pacijenti/termini → administracija. Pomerati jednu oblast po paketu iz `backend/server.js` u rute i odgovarajuće servise uz postojeće repository-je. Zavisnosti prosleđivati eksplicitno gde to olakšava testiranje.

Za svaku oblast popisati dostupne CRUD i poslovne operacije, validaciju, ovlašćenja, HTTP statuse i greške. Ujednačavanje ugovora raditi kompatibilno ili kao zasebnu dokumentovanu promenu. SQL držati u repository-jima, poslovne formule u servisima, a HTTP obradu u rutama.

**Završeno kada:** izdvojena oblast nema duplirane rute/formule; endpoint-i, tipovi odgovora, permisije i rollback ponašanje ostaju provereni; `server.js` zadržava povezivanje aplikacije i postepeno gubi domensku logiku. Nema proizvoljnog cilja broja fajlova ili dužine funkcije.

**Baza:** samo premeštanje koda ne zahteva migraciju.

### Faza 5 — frontend moduli i pouzdana pretraga (T12, A18)

**Obuhvat:** prvo `src/scripts/director-reports.js`, zatim veliki moduli kartona i unosa posete. Odvojiti pozive API-ja, obračune/stanje, renderovanje i povezivanje događaja prema stvarnim odgovornostima. Centralizovati zajedničko formatiranje novca/datuma gde se ponavlja. U pretrazi razlikovati grešku od praznog rezultata i sprečiti stariji odgovor da zameni noviji.

**Završeno kada:** UI i izvoz koriste iste poslovne podatke; učitavanje, greška, prazan rezultat i ponovni pokušaj imaju jasna stanja; test sporog starog i brzog novog odgovora potvrđuje ispravan prikaz; desktop i mobilni ključni tokovi ostaju upotrebljivi.

**Baza:** bez migracija za organizaciju UI koda.

### Faza 6 — performanse i provereno čišćenje (T13–T14)

**Obuhvat:** izmeriti broj SQL upita, trajanje i veličinu odgovora za izabrane tokove; ukloniti N+1 pri učitavanju računa/planova/osiguranja; suziti proceduralni izveštaj koji sada učitava i nepotrebne delove uplata/podatke pacijenata. Koristiti grupno učitavanje i ciljane indekse tek prema nalazu. Proveriti duple zavisnosti i lockfile-ove, dinamičke potrošače i ručne tokove pre uklanjanja koda.

**Završeno kada:** postoji poređenje pre/posle nad istim sintetičkim skupom, bez promene rezultata; uklonjeni kod ima dokaz da nije korišćen; relevantne provere prolaze. Ranjivosti se procenjuju po upotrebi i dostupnosti ispravke, bez slepog velikog ažuriranja svih paketa.

**Baza:** mogući indeksi, sa procenom troška kreiranja i uticaja na upis.

### Faza 7 — objavljivanje i Supabase

Za svaki paket odvojeno evidentirati: lokalna implementacija, lokalne provere, commit/push, udaljeni CI, migracije, deployment i provera aplikacije. Uspešan merge ne znači da je migracija primenjena ili da je produkcija proverena.

Pre migracija: proveriti ciljni projekat, istoriju migracija i kompatibilnost sa starom/novom verzijom aplikacije; obezbediti plan oporavka i proveru stanja podataka. Migracije prvo proveriti na novoj lokalnoj bazi i na sintetičkom skupu koji predstavlja prethodnu verziju. Na izdvojenom staging okruženju proveriti aplikaciju i pristup novim objektima, uključujući RLS/privilegije prema stvarnom načinu pristupa.

**Završeno kada:** odobreno objavljivanje ima uspešan CI, potvrđenu migraciju ako je potrebna i proverene tokove prijave, posete, uplate, računa i izveštaja na ciljnom okruženju. Provera produkcije ne koristi automatsko generisanje pacijenata ili finansijskih knjiženja bez posebnog dogovora.

### Provere i evidencija po paketu

- Za poslovnu promenu dodati test koji reprodukuje konkretan problem; za samo premeštanje koda koristiti postojeće testove i dopuniti ih samo gde postoji stvarna praznina.
- Backend/DB testove i Playwright pokretati redom nad istom izolovanom bazom ili koristiti zasebne baze; isključivo sintetički podaci.
- Pokretati relevantne provere posle svake celine, a puni backend suite i dogovorene ključne E2E tokove pre zatvaranja paketa. Sintaksa i `git diff --check` su dopunske provere, ne dokaz poslovne ispravnosti.
- U ovaj dokument zapisati obuhvat, rezultat, preskočene provere, migracije i šta ostaje. Broj ranije uspešnih testova ne predstavljati kao rezultat nove revizije.
- Naredni konkretan korak je **Faza 0**, pa **Faza 1**. Ne otvarati paralelno više velikih refaktoringa nad istim finansijskim tokom.
