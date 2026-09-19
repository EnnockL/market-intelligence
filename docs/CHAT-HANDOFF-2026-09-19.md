# Återstart efter full chattkontext

**CURRENT STATE - production 2026-09-19, code 5878cca:** Historical checkpoints
below are superseded by [DEMO-ROLLOUT-2026-09-19.md](DEMO-ROLLOUT-2026-09-19.md).
Production has migrations 0001-0101, the multiasset OKX demo baseline, KNOWN
account/risk captures, active DEMO orders with unchanged limits and LIVE disabled.
The new resumable wallet engine completed both formerly blocked histories:
2,409 transactions / 873 assets / 865 cycles and 11,884 transactions / 2,552 assets /
3,260 cycles. Atomic publication succeeded; missing evidence remains unverified.
Wallet cron also completed at 16:40:48 UTC (3 wallets, 272 cycles, no blocked
histories); the enabled job is HEALTHY. The forecast timeout recovered: its v2 bundle exists, and recent scheduled runs
completed. Execution now explains account limits and the prospective test window.
BTC-EUR five-minute data collects for the registered 19 September-19 October test.
No eligible proposal or exchange order yet. Existing inventory exceeds entry
limits and strategy approval remains required. All six balances are preserved.
AI explanations still lack a key. Do not repeat baseline registration or apply
already-recorded migrations. 994 unit and 60 actual integration tests passed,
as did migration role/lease/rollback checks, the 101-migration upgrade and build.



Sammanställd 2026-09-19 från slutet av den lokalt sparade tråden **Bygg Market Intelligence Engine**, projektfiler och Git. Detta är en kort överlämning, inte hela historiken. Den gamla tråden har inte ändrats eller raderats.

**Uppdatering efter fortsättningen:** Den tidigare blockerade lokala testuppgiften är nu klar: 56 integrationstester, sju SQL-kontrollgrupper (även återkörning) och samtidighetskontroller med tre anslutningar godkända. Se `LOCAL-BACKEND-VALIDATION-2026-09-19.md` för aktuellt nuläge, lokala testfixar och återkörning. Beskrivningen nedan av var gamla tråden stannade är historik.

**Senaste kodetapp:** Anv?ndaren valde uttryckligen befintligt demokonto med alla innehav. Lokal kod st?djer nu observerad startbalans f?r BTC, XRP, EUR, USD, USDC och ETH, avst?mning av alla saldon och v?rdering av samtliga innehav. Faktisk GET-l?sning mot kontot lyckades. Endast EUR r?knas som k?pkraft f?r valt BTC-EUR; ?vriga innehav r?knas som exponering. Historisk ink?pskostnad ?r ok?nd och PnL m?rks som relativt observerat startv?rde. 943 enhetstester, lokal SQL inklusive multiasset-startbalans, f?rska 94 migrationer och bygge/typecheck godk?nda. Se `DEMO-ACCOUNT-RECONCILIATION-2026-09-19.md`. Inga produktionsmigrationer, baslinjer eller b?rsorder har skickats. Strategiproveniens/OOS och separat exitpolicy ?terst?r; generell handel mellan alla valutapar ing?r ?nnu inte.

**Latest implementation:** See `STRATEGY-OOS-AND-SPOT-EXITS-2026-09-19.md`. Safety v2 and migration 0095 allow ledger-covered spot exits above entry limits while preserving other gates. Migration 0096 adds future-only strategy windows, immutable source manifests, atomic evaluation and verified OOS research. 979 unit tests, 58 actual integration tests, local SQL checks, 96-migration upgrade and production build passed. A real prospective test and normal validation are still required; no strategy was promoted. Generic MARKET/USD proposals still do not match BTC-EUR LIMIT. Nothing deployed to production and no exchange orders sent.

## Uppdrag och principer

Projekt: `C:\Users\djnoc\Desktop\Trading`, Market Intelligence Engine. Next.js 16.3.1, React, TypeScript, Supabase. Läs `AGENTS.md` och relevanta installerade Next.js-guider före kodändringar.

Produkten omfattar marknadsdata, signaler, strategilabb/historisk simulering, paper-portfölj och execution-infrastruktur. Evidens, datakvalitet, risk och faktisk avkastning ska hållas isär. Deterministisk kod äger priser och bokföring. Saknad evidens ska förbli UNKNOWN; historiska tester får inte använda framtida information. Se `MASTER-PLAN.md` och `MASTER-ARCHITECTURE.md`.

## Exakt var arbetet stannade

Senaste konkreta uppgiften i gamla tråden var att starta en **isolerad lokal Supabase-miljö i Docker** och köra databas-/backendtester. Användaren meddelade att Docker var igång och bad sedan att försöka igen.

Den 8 september rapporterade föregående agent att Docker slutat svara och att C: hade 0 GB ledigt (`ENOSPC`). Testmiljön var förberedd men integrationstesterna hade inte körts enligt senaste slutrapporten. Därefter finns ett löfte att kontrollera Docker/disk igen, men ingen senare lyckad slutrapport i de granskade slutmeddelandena. Den 19 september misslyckades både fortsättning och `/compact` med `context_window_exceeded`.

Ny kontroll den 19 september: C: har cirka **16,6 GiB ledigt**. Den gamla uppgiften om full disk är alltså inte längre aktuell. Dockerhälsa och lokala databastester har inte kontrollerats/körts i denna återställning.

## Aktuellt repo och verifieringsläge

- Gren `main`, HEAD `45831e8` (`feat: add execution ledger v2, provenance guards, and data-gap revisit queue`). Arbetskatalogen var ren innan denna överlämningsfil skapades.
- Föregående commits omfattar mobil-labbläsbarhet (`52262e9`), isolerad frontend-databaskontroll (`f9f65f2`) och frontend-streaming/bevarade labbresultat (`a52ebff`).
- `BACKEND-HARDENING-2026-09-07.md` rapporterar historiskt 723 godkända tester, 56 överhoppade, godkänd typecheck/build och 90 migrationer i PGlite. Detta är tidigare rapporterade resultat, inte en ny testkörning eller bevis för verklig Supabase-integration.
- Vissa dokument säger fortfarande ”inte committat” eller ”frontend återstår”. Git visar senare commits: läs dessa formuleringar som historiska etappnoteringar. Produktionsstatus och tillämpade migrationer är inte nyverifierade.

## Nästa steg för den pågående testuppgiften

1. Kontrollera Dockerhälsa och lokalisera den tidigare separata Supabase-testkatalogen. Projektroten saknar `supabase/config.toml`; skapa inte oavsiktligt en ny produktionskoppling.
2. Läs `scripts/run-local-supabase-tests.mjs`. Den kräver projekt-ID `market-intelligence-backend-local`, API `127.0.0.1:57421` och databasport `57422`. Den tar en separat projektkatalog och CLI-sökväg, filtrerar miljövariabler och använder endast lokala testnycklar.
3. Återuppta isolerade SQL-/roll-/rollback- och integrationstester när stacken är frisk. SQL-läget förväntar 93 applicerade migrationer; jämför faktiska filer och databas före körning. `scripts/check-local-backend-concurrency.mjs` finns också för fortsatt granskning.
4. Rapportera faktiska resultat och återstående fel. Ändra inte produktionsdatabasen och aktivera inte handel som del av testuppgiften.

## Viktiga kvarvarande produktfrågor

Se `EXECUTION-LEDGER-V2-2026-09-07.md`, `EXECUTION-RECONCILIATION-2026-09-07.md` och aktuell kod innan nästa implementation: kontoidentitet, funding/valutasaldon, komplett extern orderlista, instrumentvärdering, atomisk kontoreservation och riskreducerande exits kräver verifiering. Äldre dokument beskriver luckor som senare kod kan ha ändrat; kontrollera dem innan de behandlas som aktuella.

Andra öppna verifieringsområden i dokumentationen är atomisk wallet-publicering, förhandslåst dataset/OOS-proveniens och visuell/prestandamätning. Frontendens separata release och migrationsurval finns i `FRONTEND-RELEASE-2026-09-07.md`. Kör inte en generell produktionsmigration för att få tester gröna.

## Historikkälla vid behov

Tråd-ID: `01a00bd0-bb44-7c21-bfca-0e8845686808`.
Lokal logg: `C:\Users\djnoc\.codex\sessions\2026\08\16\rollout-2026-08-16T20-23-43-01a00bd0-bb44-7c21-bfca-0e8845686808.jsonl`.

Läs bara relevanta delar vid behov; hela loggen är cirka 300 MB. Lägg inte hela historiken i nästa prompt. Inga hemligheter har kopierats till denna sammanfattning.
