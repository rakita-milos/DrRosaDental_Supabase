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

Ovaj odeljak određuje redosled narednog rada; prethodni pregled ostaje veza sa nalazima prvobitne analize. Faza 1 je naknadno završena lokalno, kako je navedeno ispod; Faze 2–7 ostaju planirane. Izrada plana sama po sebi ne predstavlja sprovedenu refaktorizaciju.

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

**Baza:** bez migracije za taj paket. Finansijski paket je objavljen na `main` kao `71d7f74`; desktop i mobilne provere su završene. Pregled preostalih mesečnih tabela ostaje zaseban otvoren zadatak.

### Faza 1 — pouzdanost računa i knjiženja (T06–T07, T05)

**Status 2026-10-16:** implementirana lokalno na `refactor/billing-integrity-phase1-20261016`, od `71d7f74`; rezultat i granice su navedeni u završnom odeljku ovog dokumenta. Objavljivanje i produkciona migracija nisu deo ovog statusa.

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
- Posle lokalno završene Faze 1 naredni razvojni korak je **Faza 2**. Ne otvarati paralelno više velikih refaktoringa nad istim finansijskim tokom.

## Rezultat Faze 1 — 2026-10-16

Ovaj odeljak beleži stanje i provere od 16.10.2026. Naknadne ispravke i aktuelni rezultati navedeni su u odeljku „Dorada nakon pregleda” od 21.10.2026; ranije brojeve testova ne treba predstavljati kao rezultate nove revizije.

### Implementacija i pravila

- Numeracija više ne koristi `COUNT+1`. Baza dodeljuje `DR-YYYY-NNNNN` pri INSERT-u, preko godišnjeg brojača u istoj transakciji sa računom, stavkama i knjiženjem. Godina je trenutna poslovna godina u Europe/Belgrade, kao nastavak ranijeg pravila tekuće godine; datiranje računa unazad ne prebacuje brojač u raniju godinu.
- Ručni brojevi ostaju podržani; postojeće globalno UNIQUE ograničenje ostaje na snazi, a duplikat vraća 409. Ručni broj u standardnom DR formatu podiže odgovarajući brojač. Brojevi duži od pet cifara se ne skraćuju.
- Migracija inicijalizuje brojače iz postojećih računa i sačuvanih charge/storno opisa u knjizi. Istorijske brojeve i iznose ne prepisuje. Broj posle uspešnog kreiranja i naknadnog brisanja računa se ne koristi ponovo; neuspešna transakcija ne troši broj. Ranije praznine ostaju dozvoljene. Brojeve za koje više ne postoji nikakav sačuvani trag nije moguće rekonstruisati; njih treba proveriti iz spoljne evidencije pre produkcione primene ako je takva evidencija postojala.
- `financial_requests` čuva identitet, hash sadržaja i originalni JSON ishod. Identitet i finansijski upis se potvrđuju ili vraćaju zajedno. Isti ključ/sadržaj vraća sačuvani odgovor, a isti ključ sa drugim sadržajem daje 409. Naknadna uplata ne menja već sačuvani odgovor prethodne uplate.
- Uplate poseta i računa prihvataju `Idempotency-Key` (1–128 vidljivih ASCII znakova). Novi frontend šalje nasumičan ključ, spaja istovremeno slanje istog zahteva i zadržava ključ neuspelog pokušaja za ponovno slanje na istoj stranici. Nova uspešno završena uplata, čak i istog iznosa, dobija novi ključ.
- Zbog kompatibilnosti stari API klijenti mogu slati uplatu bez ključa; takav zahtev nema zaštitu od ponovnog slanja. Klijenti moraju sačuvati i ponovo poslati isti ključ kada ishod nije poznat. Frontend trenutno čuva pokušaj u memoriji stranice, bez čuvanja obrazaca; ponovno učitavanje stranice gubi taj ključ i ne predstavlja automatski bezbedan retry.
- Postojeći ERA ekran tretira jedan EOB kao kumulativni obračun za zahtev. Slanje bez identiteta koristi jedan stabilan legacy događaj po claim-u; ponavljanje ne knjiži ponovo. Korekcija zahteva novi `eventId`/`event_id` ili `Idempotency-Key`. `paidAmount` je novi kumulativni iznos, a u knjigu ide samo razlika u odnosu na prethodni iznos, uključujući povrat na nulu. Ponovljen stari događaj vraća svoj originalni odgovor. Ovo nije integracija sa spoljnim ERA providerom niti automatsko uređivanje događaja po datumu; korekcije se primenjuju redom prijema.
- Istorijski ERA obračun bez novog receipt-a prepoznaje se po postojećem stanju. Stara duplirana ili neusaglašena knjiženja se ne popravljaju automatski; njihov pregled ostaje posao provere podataka.
- Uplate računa i brisanje računa zaključavaju isti račun; dodatne uplate posete zadržavaju postojeće zaključavanje posete. Serijalizacija odgovora koristi istu transakcijsku vezu, uključujući `PG_POOL_MAX=1`.
- Precizna Joi validacija svih finansijskih operacija ostaje u Fazi 2; ovaj paket odbija neispravne/negativne ERA iznose i nepozitivne uplate računa.

### Provere

- Puna backend provera: **232 prolazi, 0 pada, 0 preskočenih** na izolovanoj bazi.
- Sintaksa: **126 JavaScript fajlova** bez grešaka; `git diff --check` prolazi.
- Novi PostgreSQL/HTTP scenariji pokrivaju nezavisne konekcione grupe, paralelne iste/različite ključeve, ručne brojeve, brisanje, rollback brojača i uplata, ERA korekcije, vraćanje na nulu, konflikt sadržaja, refund i ponavljanje posle odbačenog odgovora.
- Client testovi proveravaju zajednički zahtev pri dvostrukom slanju, isti ključ posle mrežne greške i novi ključ za novu uplatu/izmenjen sadržaj/prijavu.
- Browser provera: **16 scenarija prolazi** (`advanced-workflows-api` i `new-entry`). Dodati scenario prvo potvrđuje uplatu na serveru, namerno prekida odgovor browseru i proverava da retry ne pravi novu uplatu. To je odabrani skup, ne kompletan E2E suite.
- Provereno podizanje stare šeme kroz sve ranije migracije i nadogradnja sa sintetičkim istorijskim računima/knjigom: redovi istorije ostaju identični; broj obrisanog računa iz knjige je rezervisan; godišnji brojači su odvojeni; prelaz preko 99999 radi.
- Na novoj lokalnoj bazi postoje sintetičke `anon`, `authenticated` i `service_role` uloge radi provere privilegija. Novi objekti imaju RLS, anonimne uloge nemaju SELECT, a serverska uloga može pristupiti. Supabase CLI security advisors za tu lokalnu bazu: **No issues found**. To nije provera produkcionog Supabase projekta.
- Tokom browser provere ažuriran je postojeći fixture javnog zakazivanja: budući radni dan i doktor iz API opcija umesto fiksnog datuma 2026-07-01 i ID-ja 1.
- Baza: novi Docker kontejner `drrosa-billing-phase1-20261016`, `drrosa_test`, `127.0.0.1:55416`. Backend i browser provere se izvršavaju redom; podaci su sintetički.

### Migracija i objavljivanje

Nova aditivna migracija: `supabase/migrations/20261015223148_billing_request_integrity.sql` (ime generisano Supabase CLI-jem). Primenjena je samo lokalno. Nema novih paketa ili produkcionih promenljivih okruženja.

Pre objavljivanja ove verzije aplikacije potrebna je migracija na nameravanom Supabase projektu. Proveriti migracionu istoriju, istorijsku numeraciju, privilegije stvarne DB uloge aplikacije i plan oporavka. Migracija kratko zaključava upis u `invoices` dok inicijalizuje brojač i postavlja trigger. Internim tabelama ne davati javni pristup; prilagođena serverska uloga zahteva odgovarajuće eksplicitne privilegije. Receipt-e ne čistiti rutinski: njihovo brisanje uklanja zaštitu od kasnih ponavljanja. Pre retencione politike potreban je poseban dogovor o roku podrške za retry i zaštiti podataka.

U ovoj fazi nisu izvršeni commit/push, udaljeni CI, deployment niti migracija produkcije. **Lokalna implementacija i navedene provere Faze 1 su završene.**

### Sledeće

Sledeća razvojna celina je **Faza 2 — valute, finansijske validacije i kliničke veze**. Prvo proveriti saldo po valuti i pravila konverzije/zaokruživanja, zatim Joi šeme i DB zaštitu veze pacijent–poseta; vremenske granice i limiter ostaju deo te faze. POM i veće izdvajanje modula slede u Fazama 3–5. Pre produkcionog korišćenja Faze 1 odvojeno završiti migraciju i postupak objavljivanja iznad.

## Dorada nakon pregleda — 2026-10-21

### Obuhvat i ponašanje

- Ispravljena su tri nalaza lokalnog pregleda: nepotpun uspešan odgovor više ne završava pokušaj uplate; stari neuspešan pokušaj više ne može neprimetno zameniti novu uplatu istog iznosa; finansijski iznosi ne prihvataju boolean, niz, objekat, heksadecimalni zapis, eksponent u stringu ili prekoračenje `NUMERIC(12,2)`.
- Klijent čuva jedan nerazrešen pokušaj po resursu i prijavi. Istovremena ista slanja dele zahtev, a redosled ključeva u objektu ne menja identitet. Izmena sadržaja blokira se dok se prethodni pokušaj ne razreši; potvrđeni pokušaj se uklanja i naredna uplata dobija nov ključ. Kontrolisano odbijanje zahteva dozvoljava ispravku unosa; mrežne i serverske greške zadržavaju pokušaj.
- Oba ekrana nude „Proveri uplatu” nakon nepoznatog ishoda. Ponavlja se sačuvan sadržaj, uključujući datum i iznos. Kod prethodne posete polja su zaključana do potvrde; ponovno otvaranje forme na istoj stranici vraća nerazrešen pokušaj. Greška osvežavanja liste računa nakon potvrđene uplate prikazuje da je uplata sačuvana.
- Podaci pokušaja ostaju samo u memoriji stranice i brišu se pri čišćenju prijave. Ponovno učitavanje ili napuštanje stranice i dalje gubi ovu zaštitu klijenta; istoriju treba proveriti pre novog unosa kada ishod ostane nepoznat. Nije uvedeno čuvanje obrazaca niti promenjen standardni tok isteka sesije.
- `backend/services/financial-payment-service.js` izdvaja uplatu računa, doplatu posete i ERA obračun iz `server.js`. Servis upravlja transakcijom i poslovnom odlukom, repository SQL-om, a rute zadržavaju ovlašćenja, HTTP odgovor i kontekst audit zapisa. Koriste se postojeći obračuni i serializer-i preko prosleđenih zavisnosti.
- Svi transakcijski metodi billing repository-ja poštuju `inTransaction`, uključujući brisanje računa, priloge i slanje zahteva osiguranju. Pozivalac koji već ima transakciju ne pokušava da otvori novu preko `pg.Client`.
- Dodate su Joi šeme za uplatu računa i ERA, kao i stroža validacija dodatne uplate posete. Proveravaju tip i opseg iznosa, stvaran kalendarski datum uplate, podržan tip uplate i identitet ERA događaja. Postojeći camelCase/snake_case nazivi ostaju podržani. Ova promena ne predstavlja validaciju svih finansijskih operacija iz Faze 2.
- Prošireni su postojeći `NewEntryPage` i `PatientDashboardPage`; novi browser scenariji koriste stvarna dugmad i obrasce. Mrežni prekidi i priprema sintetičkih podataka ostaju u testovima.

### Ponovljive provere

- Puna backend provera na izolovanom PostgreSQL 17: **241 prolazi, 0 pada, 0 preskočenih**.
- Posebna finansijska PostgreSQL/HTTP provera sa `BILLING_TEST_POOL_MAX=1`: **16 prolazi, 0 pada, 0 preskočenih**; obuhvata i servis i repository koji ulazi u već otvorenu transakciju.
- Novi automatski test migracije kreira zasebnu privremenu bazu na prethodno potvrđenom lokalnom test serveru. Primenjuje sve ranije migracije, unosi sintetičku istoriju, zatim proverava novu migraciju. Istorijski redovi ostaju identični, obrisani broj iz knjige se rezerviše, godine ostaju odvojene, brojevi preko 99999 rade, a rollback vraća brojač. Proveravaju se RLS i privilegije sintetičkih uloga. Privremena baza se uklanja nakon testa; ne resetuje se zajednička integraciona baza.
- Odabrani browser skup `advanced-workflows-api` i `new-entry.e2e`: **19 prolazi**. Četiri testa proveravaju gubitak celog odgovora i neispravan JSON posle potvrđenog upisa, proveru iste uplate i novu uplatu istog iznosa, za račune i posete.
- Završna ponovljena provera uplata: **4 prolazi**, uključujući oba ekrana na širini **390 px**. Mobilna provera je otkrila širenje payment-builder grid-a zbog tabele istorije; kolone su ograničene na širinu roditelja, a tabela zadržava svoj horizontalni skrol. Dodata je provera granice prikaza pre klika na dugme. Prvi dodatni pokušaj računa vratio je `403` zbog izostavljenih testnih billing ovlašćenja; završna provera koristi istu eksplicitnu konfiguraciju kao prethodni uspešan skup.
- Sintaksa: **130 JavaScript/CJS fajlova**, bez grešaka; završni `git diff --check` prolazi. Backend provera je izvršena pre završne CSS ispravke, a relevantni browser scenariji ponovljeni su posle nje.
- Testovi su izvršavani redom nad zasebnim Docker kontejnerom `drrosa-billing-review-20261021`, bazom `drrosa_test`, na `127.0.0.1:55439`. Podaci i pristupni podaci su sintetički. Ovo nisu rezultati udaljenog CI-ja ili produkcionog Supabase projekta.

### Baza, objavljivanje i preostali plan

Ova dorada ne dodaje migraciju, zavisnosti ili produkcione promenljive. Paket i dalje zahteva postojeću necommitovanu migraciju `20261015223148_billing_request_integrity.sql` pre objavljivanja odgovarajućeg backenda. Migracija je u ovoj proveri primenjena samo na potrošnim lokalnim bazama.

Nisu izvršeni commit/push, udaljeni CI, produkciona migracija ili deployment. Pre objavljivanja proveriti ciljnu bazu, migracionu istoriju, istorijsku numeraciju i stvarnu serversku DB ulogu; lokalne sintetičke uloge ne dokazuju produkcione privilegije.

Zatvorene su ispravke pouzdanosti i ciljano izdvajanje servisa iz plana pregleda. **Faza 2 ostaje naredni zaseban paket:** saldo po valuti i konverzije/zaokruživanje, preostale finansijske šeme, DB zaštita dodatnih kliničkih veza, vremenske granice i atomski limiter. Širi POM i modularizacija ostaju Faze 3–5. Ovaj status ih ne predstavlja kao završene.

## Ispravke dva nalaza ponovljenog pregleda — 2026-10-23

### Decimalno zaokruživanje

`financialAmount` zaokružuje decimalne cifre pomoću celobrojnog iznosa u stotinkama. Time se izbegava binarno množenje koje je za `10.075` davalo `10.07`; rezultat je sada `10.08`, u skladu sa PostgreSQL `NUMERIC(12,2)`. Zadržane su provere tipa, opsega i pozitivnog iznosa. Decimalni string ostaje precizan i kada ima više cifara nego što `Number` može sačuvati; mali numerički iznosi u eksponentnom zapisu obrađuju se bez greške konverzije.

Unit test proverava decimalne polovine, iznose ispod pola stotinke, vodeće nule, precizne stringove i granicu opsega. Novi PostgreSQL/HTTP scenario poredi rezultate sa stvarnim kastovanjem u `NUMERIC(12,2)` i proverava sačuvane uplate, povraćaje, ERA knjiženja i delove uplate posete. Istorijski iznosi se ne prepisuju.

### Odgovor nakon zatvaranja ili promene obrasca

Slanje dodatne uplate čuva originalni zapis i identitet pacijenta. Zakašnjeli odgovor zatvara ili ponovo popunjava obrazac samo ako je i dalje otvorena odgovarajuća poseta istog pacijenta. Zatvoren obrazac ostaje zatvoren, a drugi otvoreni obrazac i njegov unos ostaju sačuvani. Poruke odgovora ne prikazuju se za drugog trenutno odabranog pacijenta.

Slanja koja još traju prate se po ID-ju posete; ponovno otvaranje iste posete ne omogućava novo paralelno slanje. Nakon nepoznatog ishoda sačuvani pokušaj ostaje dostupan kroz „Proveri uplatu”, sa istim ključem i sadržajem. Dugme „Otkaži” zatvara obrazac i ne predstavlja otkazivanje upisa koji je server već potvrdio.

Dodate su četiri browser regresije: uspešan ili izgubljen odgovor nakon zatvaranja obrasca ili prelaska na drugu posetu. Proveravaju odsustvo JavaScript grešaka, očuvanje drugog unosa, jedan finansijski upis i ponovno slanje istog ključa.

### Provere i granice

- Puna backend provera nad novim izolovanim PostgreSQL 17: **243 prolazi, 0 pada, 0 preskočenih**.
- Sintaksa: **130 JavaScript/CJS fajlova**, bez grešaka.
- Završni odabrani browser skup `advanced-workflows-api` i `new-entry.e2e`: **23 prolazi, 0 pada**, uključujući četiri nove regresije zatvaranja/promene obrasca i postojeće mobilne provere na 390 px. To je odabrani skup, ne kompletan E2E suite. `git diff --check` prolazi.
- Prvi širi browser prolaz dao je 22 prolaza i jedan pad u postojećem testu istoimenih pacijenata. Test je čekao unapred postojeću opciju doktora umesto učitavanja pacijenata. Čekanje je vezano za stvarno prikazanu opciju ciljnog pacijenta; provere sačuvanog ID-ja i netaknute istorije drugog pacijenta ostaju iste. Nije promenjena logika autocomplete-a radi ovog testa.
- Provere su koristile samo sintetičke podatke u potrošnom kontejneru `drrosa-billing-fixes-20261023`, `drrosa_test`, na `127.0.0.1:55441`; kontejner se uklanja nakon završenih provera.

Ove ispravke ne dodaju migraciju ili zavisnosti. Paket i dalje zahteva ranije dodatu migraciju `20261015223148_billing_request_integrity.sql` pre produkcionog korišćenja odgovarajućeg backenda. Commit/push, udaljeni CI, produkciona migracija i deployment nisu izvršeni. Preostala Faza 2 nije obuhvaćena ovim zatvaranjem dva konkretna nalaza.

## Priprema Git objavljivanja — 2026-10-23

Nakon zatvaranja oba nalaza paket se objavljuje na radnoj grani `refactor/billing-integrity-phase1-20261016`, sa prethodno navedenim rezultatima lokalnih provera: 243 backend testa, 23 odabrana browser scenarija i sintaksa 130 JS/CJS fajlova. Obuhvat uključuje novu SQL migraciju, novi repository/helper i finansijski servis, kao i prateće regresione testove; samo `git diff` nad praćenim fajlovima ne prikazuje ceo paket.

Objavljivanje radne grane ne predstavlja merge u `main`, potvrdu udaljenog CI-ja, primenu Supabase migracije ili proveru produkcije. Postojeći CI workflow pokreće se na push u `main`/`master` ili pull request prema tim granama. Pre objavljivanja backenda na produkciju zasebno primeniti i proveriti migraciju na nameravanom projektu i privilegije stvarne serverske DB uloge. Preostala Faza 2 ostaje zaseban paket.
