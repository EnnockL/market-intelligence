# Backend före frontendens prestandaarbete

Status: fortsatt lokal implementation efter `DATA-VALUE-IMPLEMENTATION-2026-09-07.md`. Inte committat, pushat eller publicerat. Ingen produktionsdatabas, providerinställning, kontostatus eller riktig order har ändrats av denna kontroll.

Nästa lokal etapp, fills/kontoledger och kvarvarande reconciliation-gränser, beskrivs i `EXECUTION-LEDGER-V2-2026-09-07.md`. Testloggen nedan för 548 tester/88 migrationer avser föregående delsteg och behålls som historik. Senaste verifiering tillkommer i slutet av dokumentet.

## Den här etappen

1. **Ny evidens får ett återbesök.** Migration 0085 inför beständig, begränsad claim/retry-kö för data-gap-jobbet. Information som anländer efter körningens fasta cutoff väntar till en senare bedömning; den backdateras inte. Revision, utvärdering och köstatus sparas i samma databastransaktion. Revision som ändrats under arbetet eller förlorat lease ger inte en blind överskrivning. Aktiva äldre kandidater får också tur.
2. **Historisk lönsamhet är inte automatiskt oberoende validering.** Strategy Intelligence v2 sparar källkopplingar och faktisk publiceringstid. Nuvarande producent saknar ett i förväg låst datasetmanifest: dess resultat blir därför TRAIN/EXPLORATION, aldrig påstådd VALIDATION/OOS. Historiska v1-rader och utforskande resultat behålls. V2-selektorn använder inte dessa som bevis för godkänd strategiedge. Migration 0086 upprätthåller spärren även i databasen. Se `STRATEGY-INTELLIGENCE-PROVENANCE-V2.md`.
3. **Köade order måste klara en ny kontroll.** Migration 0087 versionsmärker konton och globala kontroller. Precis före provideranropet jämför en atomisk claim aktuell kill switch, konto, läge, risk-/kontosnapshot och säkerhetsbeslut. Saknade eller ändrade underlag får inte återanvända ett gammalt godkännande. SHADOW/DEMO är enda tillåtna lägen. Kontodatainsamling får inte återaktivera ett pausat konto. Upprepat skapande av samma intent återställer inte en befintlig orders tillstånd; gamla providerreferenser skickas till avstämning, inte en ny order. Även nekande av en köad order görs atomiskt för att inte skriva över en samtidig claim.
4. **Prognosjobb har aktuell kapacitet och komplett sparande.** Max 25 källprognoser per körning: vid full kö reserveras 20 platser för senaste timmen och 5 för äldre historik. Lediga platser kan lånas mellan grupperna. Ett fel stoppar inte övriga mål, men körningen rapporteras som misslyckad med antal lyckade delresultat. Migration 0088 sparar prognos, feature-snapshot, cohort-referenser och outbox-händelse atomiskt. Först en komplett bundle dränerar kön; identifieringskonflikter och gamla ofullständiga v2-rader kräver uttrycklig granskning, inte ändrad historik.

## Kontroller

Riktade enhetstester och den isolerade PostgreSQL-kontrollen körs utan provideranrop eller produktionsdata. `scripts/check-data-value-migrations.mjs` laddar alla migrationer i en ny minnesdatabas och använder separata syntetiska testfixtures. Detta är testdata i testmiljön, inte ersättning för verklig data i appen.

- `npm run typecheck`: godkänt.
- `RUN_SUPABASE_INTEGRATION=0 npm test -- --reporter=dot`: **548 godkända, 56 överhoppade** (92 testfiler godkända, 27 överhoppade). Överhoppade integrationstester är inte ett produktionsgodkännande.
- `npm run build`: godkänt på installerad Next.js 16.3.1, inklusive TypeScript och sidgenerering.
- Samtliga **88 migrationer** appliceras i en ny PGlite-minnesdatabas. SQL-regressionerna verifierar bland annat atomic rollback när sista sparsteget misslyckas, återförsök/idempotens, typed candle-källor, framtida evidens, förlorad claim, ändrad revision, utgången kandidat, TRAIN/EXPLORATION kontra falsk OOS, publiceringstid och sista orderkontrollens kill switch/kontorevisioner. Privilegier kontrolleras och privata RPC:er anropas som `service_role`.
- `git diff --check`: godkänt.

Integrationsprov mot verklig Supabase/PostgREST, verkligt samtidiga anslutningar/belastning och produktionsdrift återstår; sekventiella race-regressioner i en minnesdatabas är inte ett lasttest. Frontendens hastighet och visuella mobil-/desktopbeteende har inte mätts i denna etapp. En lokal grön kontroll bevisar inte att publiceringen är klar.

## Kvar före ett pålitligt automatiskt handelsflöde

- Verifierad wallet-executionkontext saknas fortfarande i nuvarande providerflöde. Körotation och fler priser kan inte ersätta den; ingen kvalitetströskel är sänkt.
- Ett verkligt förhandslåst datasetmanifest, split-proveniens och tidskorrekt out-of-sample-körning måste byggas. Att bara ange OOS eller välja en äldre period räcker inte.
- Fill-inhämtning, konto-/instrumentseparerad ledger, reservationer, avgifter och FX behöver fortsatt egen verifiering. Sista säkerhetskontrollen lagar inte underliggande PnL-aritmetik. En godkänd claim kan heller inte återkalla en order som redan hunnit skickas till en extern börs.
- Wallet-PnL-rebuild är fortfarande inte ett atomiskt databassparande. Gemensamma providerbudgetar och full samtidighets-/kapacitetskontroll återstår.
- Baseline kör högst en färdig batch per femminutersslot. Den reserverade historikkön saknar ännu individuell fel-backoff: permanenta legacy-partialfel kan uppta dess fem platser tills de granskats. Detta blockerar inte den separata aktuella kvoten. Ingen automatisk reparation av immutable historik görs.
- Beständig rapport per backtest-ID återstår. Frontend kan fortfarande visa äldre v1-rader som historik; versionsmärkning och vald rapport måste hållas samman utan att bakgrundsjobb byter rapport.

## Publicering och nästa arbetsordning

Granska samtliga lokala ändringar och migrationer **0081–0088** tillsammans. Kör dem först på separat Supabase-staging, inklusive roller och REST-anrop. Publicera inte endast koden: nya RPC:er krävs, och saknad migration stoppar flödena avsiktligt. Behåll handelsspärrarna. Verifiera därefter naturliga worker-körningar, faktisk återbesökstid, fel, köstorlek och providerkostnad.

Frontendens upplevda seghet är noterad men den här etappen byter inte UI-stack. Före optimering mäts långsamma sidors serversvar, databasfrågor, navigering, payload och rendering på mobil/desktop. Utifrån mätning väljs begränsade frågor, cache/laddningsgränser och eventuellt push för relevanta livefält. WebSockets, Canvas, ny tillståndshantering eller binär transport införs inte enbart för att de nämns i ett generellt stackförslag.

## Senaste lokala kontroll: fills/kontoledger v2

Detaljer och uttryckliga kvarvarande spärrar: `EXECUTION-LEDGER-V2-2026-09-07.md`. Migrationerna för hela den ännu opublicerade ändringsmängden är nu **0081–0090**, inte bara 0081–0088. Inget har migrerats till produktion eller pushats i denna etapp.

- Full testsvit: **723 godkända, 56 överhoppade**, 99 testfiler godkända och 27 överhoppade. Isolerad capture-testning omfattar konto-/providermappning, pagination efter 500 rader, historisk kostnadsbas och avgifter. Worker-testning verifierar ordningen avstämning → kontofångst/fills → slutkontrollerad submission; det sistnämnda är mockat, inga order skickas.
- TypeScript och produktionsbygge på Next.js 16.3.1: godkända.
- Alla **90 migrationer** och hela RPC-testsviten: godkända i ny PGlite-minnesdatabas. Nya tester omfattar service-role-only fill-import, externa orders, avgiftstecken, immutable konflikter/rollback, retention, mer än 1 000 sammanhängande coverage-fönster utan stort API-svar, kontoassociation samt v2-payload och färsk ekonomisk cutoff i final claim.
- `git diff --check`: godkänt.
- Ingen Supabase/PostgREST-stagingkontroll, verklig provideranslutning, produktionsdrift eller visuell/prestandamätning är genomförd i den här etappen. Ingen säkerhetsspärr har sänkts.

Nästa kontoproducent behöver verifiera extern kontoidentitet, funding/öppningsinnehav, valutasaldon, samtliga öppna providerorder och aktuella instrumentmärken. Dessa luckor anges nu som UNKNOWN, inte som en fungerande handelsmodell. Riskreducerande exit-policy och atomisk reservation mellan olika samtidiga order måste också färdigställas före automatisk handel. Den här lokala kontrollen ska inte tolkas som att hela systemet eller publiceringen är klar.
