# Mlečni i stalni zubi

Lokalna implementacija na grani `feature/primary-teeth`. Produkciona baza i Git remote nisu menjani.

## Ponašanje

- Novi unos ima tabove **Stalni zubi** i **Mlečni zubi**. Mlečna mapa ima 20 FDI oznaka: gore `55 54 53 52 51 | 61 62 63 64 65`, dole `85 84 83 82 81 | 71 72 73 74 75`.
- Dodati radovi ostaju u nacrtu pri promeni mape. Nedovršen rad traži izbor „Dodaj rad i promeni mapu“ ili „Vrati se na unos“. Konačno čuvanje je blokirano dok postoji nedovršen rad na označenim zubima.
- Obe vrste zuba mogu pripadati istoj poseti. Ukupna cena, popusti, uplate i dug koriste postojeći obračun.
- Karton → Zubi prikazuje obe mape, zatečeno stanje, stanje prisutnosti, istoriju promena i izvršene radove. Klik na zub filtrira istoriju; „Svi zubi na ovoj mapi“ vraća ceo prikaz. „Novi rad“ prenosi pacijenta, mapu i jedan izabrani zub.
- Stanja su: nije evidentirano, prisutan, nije iznikao, ispao i izvađen. „Ispao“ važi samo za mlečne zube. Nema automatskog označavanja zdravlja, prisutnosti ili vađenja iz starijih postupaka. Ranije vađenje se prikazuje posebnom narandžastom oznakom samo dok nema eksplicitnog stanja; oznaka ne upisuje kliničko stanje.
- Svaka promena stanja je novi zapis sa datumom, napomenom i korisnikom. Retroaktivan unos ne zamenjuje kasnije stanje. Ispravka se evidentira novom promenom; brisanje istorije nema API.
- Novi pacijent podržava obe mape i nacrt stanja. Ako dopuna podataka ne uspe nakon kreiranja pacijenta, ponovni pokušaj koristi već kreiranog pacijenta. Editor se odmah povezuje sa njegovim ID-em, pa naredne izmene i brisanja koriste postojeći API. Za vreme čuvanja pacijenta editor je zaključan.
- Posete imaju filter vrste zuba. Otvaranje mešovite posete prikazuje sve radove i čuva jedinstven obračun.
- Kalendar ima pristup kartonu i već povezanoj poseti. Za sačuvan termin bez posete, „Kreiraj i otvori posetu“ koristi postojeći API za kreiranje povezane posete; sledeće otvaranje koristi isti zapis. Planirani zubi pri zakazivanju nisu deo ove izmene.
- Pravni JSON izvoz uključuje `toothStates`; pacijent sa istorijom stanja zaštićen je od brisanja.

## Podaci i pristup

Migracija: `supabase/migrations/20261009181329_add_tooth_state_history.sql`.

Nova tabela `app.tooth_state_events` ne menja postojeće radove ni finansijske tabele. Ima RLS i ukinuta prava za PUBLIC, anon i authenticated. Čitanje i upis prolaze kroz postojeću Express autentifikaciju i prava `clinical:read` / `clinical:write`. Postojeća korisnička prava nisu proširena. Novi unosi zahtevaju validne FDI oznake; pri izmeni starije posete dozvoljeno je zadržati njene ranije oznake.

Datumi stanja i datumi posete koji se vraćaju u istoriji čitaju se kao SQL DATE tekst, kako ih UTC serijalizacija ne bi pomerila na prethodni dan.

Na telefonu je mapa horizontalno pomerljiva, sa većim površinama za izbor. Provereni su prikazi na desktopu i širini 390 px.

## Lokalna provera

Testovi koriste zaseban Docker PostgreSQL 17, bazu `drrosa_test`, sintetičke pacijente i port 55434. Migracije se primenjuju isključivo lokalnim zaštitnim skriptom `backend/scripts/apply-local-migrations.js --allow-local`.

- Backend: `node --test backend/test/*.test.js`.
- Browser/API: `tests/playwright/tests/primary-teeth.spec.js`, uz postojeće testove Novog unosa, Poseta, kalendara i izvoza.
- Novi testovi proveravaju obe mape, zaštitu nedovršenog rada, mešovitu posetu, trajno čuvanje izmena, stanje posle ponovnog učitavanja, datume, prava pristupa, odbijanje nevažećih oznaka, pravni izvoz, zaštitu brisanja, popuste, više uplata i kompatibilnost ranijih oznaka.
- Postojeći test izvornog koda normalizuje CRLF pre pretrage, radi iste provere na Windowsu i Linuxu.

Rezultati prvobitne implementacije: 169 backend testova uspešno i 21 browser/API scenario. Rezultati refaktorisanja navode se ispod.

## Pre produkcione objave

Prvo primeniti i proveriti migraciju na staging bazi, zatim proveriti preview aplikacije sa staging podacima. Proveriti produkcionu rezervnu kopiju i stvarne ranije oznake zuba read-only upitom. Produkciona migracija mora biti dostupna pre objave backend/front-end koda koji čita novu tabelu. Lokalni testovi ne potvrđuju stanje produkcione Supabase baze ili Vercel deploymenta.

Novi cenovnik nije uveden: koristi se postojeći šifarnik, uz naknadne dopune koje ordinacija odredi.

## Refaktorisanje

- SVG mape ostaju u DOM-u tokom izbora zuba i promene taba; osvežavaju se oznake, liste i detalji. Skrol se zadržava prirodno, bez ponovnog pravljenja mapa.
- Gradijenti dobijaju jedinstvene identifikatore, a njihove reference se obrađuju jednim prolazom. Uklonjen je nekorišćeni izvoz `FDI_TEETH`.
- Grupni upis stanja koristi jedan parametrizovan SQL zahtev sa `INSERT ... RETURNING`, unutar postojeće transakcije: 3 poziva ukupno (BEGIN, upis/čitanje, COMMIT), umesto 42 za 20 promena.
- Istorija na kartonu koristi postojeći prikaz bez ponovnog grupisanja već filtrirane mape.
- Dodate su provere delimičnog čuvanja i ponovnog pokušaja, trajnog ažuriranja i brisanja, veze termina sa posetom, stabilnosti SVG-a i skrola, ranijeg vađenja i atomskog grupnog upisa sa greškom ograničenja u bazi.

Provera refaktorisanja: 170 backend testova uspešno, 0 neuspešnih, 2 preskočena. Svih 25 izabranih browser/API scenarija potvrđeno je u odvojenim pokretanjima: 8 za mlečne zube i refaktorisanje, 10 za Novi unos, 2 za Posete, 1 za kalendar i 4 za izvoz. Poslednje pokretanje celog skupa za mlečne zube: svih 8 uspešno. Prošla je provera sintakse svih 20 izmenjenih/dodatih JavaScript fajlova i `git diff --check`. Pregledan je i snimak prikaza na telefonu.
