# Orderavstämning: samma status, nya observationer

Lokal backendändring. Inga provideranrop, order, produktionsmigreringar eller
aktiveringar görs av testerna. Migration 0092 är inte en orderauktorisering.

## Kontrakt

- Varje observerad order skickas till `persist_execution_order_observation`,
  även när status fortfarande är `PARTIALLY_FILLED`. Ackumulerad fylld mängd och
  genomsnittspris kan därför uppdateras utan ett nytt statusnamn.
- Orderuppdatering och audithändelse är samma databastransaktion. Händelsens
  tidigare/nästa status får vara samma; den representerar en observation.
- En revision ökas vid varje lokal orderuppdatering. RPC:n låser ordern och
  jämför den revision som lästes före provideranropet. En samtidighetskonflikt
  skriver varken order eller missvisande audithändelse.
- Identisk observation återanvänds idempotent, även efter senare uppdateringar.
  En ny observationstid kan skapa en ny audithändelse trots samma belopp.
- Terminala order öppnas inte igen. Fylld mängd får inte minska eller överstiga
  uttrycklig beställd mängd. Okänt beställt antal tillåter inte positiva fills.
  FILLED kräver hela mängden, PARTIALLY_FILLED en strikt delmängd.
- Prisändring utan ökad fylld mängd kräver separat utredning; den antas inte
  vara en verifierad korrektion. Saknat providersvar behåller kända mängder och
  priser och markerar `RECONCILIATION_REQUIRED`, aldrig noll eller CANCELLED.
- Saknad migration, ogiltigt svar, RPC-fel, överstigen läsbudget och olösta
  konflikter stoppar avstämningen. Efter en beständig DEGRADED-körningsrapport
  kastar tjänsten `EXECUTION_RECONCILIATION_INCOMPLETE`, så execution-workern
  inte går vidare till capture eller submission i den körningen.
- Budgeten är 1–100 order. En extra läst rad upptäcker att listan inte är
  komplett; kvarvarande order får inte bli en godkänd delavstämning.

RPC:n är endast tillgänglig för `service_role`. Den skapar inga
`execution_fills`, ändrar inga kontrollflaggor och sänker inga UNKNOWN-grindar.

## Kvarstående begränsningar

- Extern kontobindning saknas fortfarande. Provider/miljö/klientorder-ID och
  befintligt providerorder-ID kontrolleras, men det verifierar inte vilket
  externt konto som nuvarande credentials tillhör.
- Kontogemensam reservation mellan olika samtidiga order är fortfarande
  separat arbete. Denna orderrevision är inte en kontoreservation.
- `observedAt` är nuvarande adapters mottagningstid, inte en verifierad
  sekvens från börsen. Revision, monotona mängder och konservativa konflikter
  skyddar lokala uppdateringar, men ersätter inte provider-sekvensering.
- Befintlig adaptermappning och write-stegen efter submission är inte
  omskrivna här. Atomiciteten i 0092 gäller reconciliation, inte alla tidigare
  transitions eller hela kontoledgerns publicering.
- Funding, multi-currency cash, samtliga externa pending orders, värderingsmärken
  och verifierad öppningshistorik kvarstår enligt ledger-v2-dokumentet.

## Verifiering

`tests/execution-reconciliation.test.ts` använder endast fake-provider/fake-DB.
`scripts/check-execution-reconciliation.mjs` exporterar
`checkExecutionReconciliation(db)` för den gemensamma minnesbaserade SQL-kontrollen.
Den kontrollerar bland annat partiella/cancelled fills, terminala regressioner,
kvantitetsgränser, replay, revisionskonflikter, rollisolering och rollback om
auditskrivningen misslyckas. PGlite serialiserar sin anslutning: detta är inte
ett verkligt samtidighetstest över flera Supabase/PostgREST-anslutningar.

Release kräver migration 0092 och hela den tidigare execution-kodens
beroendepaket (0087/0089/0090). Inget separat stagingkonto är konfigurerat lokalt;
produktionscredentials får inte användas som integrationstestets fallback.
