# Första byggsteget efter systemkontrollen

Uppföljande backendetapp och uppdaterade begränsningar: se `BACKEND-HARDENING-2026-09-07.md`. Dokumentet nedan behåller den första etappens verifieringslogg.

Status: implementerat och kontrollerat lokalt 2026-09-07. Inte committat, pushat eller publicerat. Inga produktionsmigrationer, schemalagda jobb, kontoinställningar eller order har ändrats/körts under detta byggsteg.

Detta är en avgränsad första del av leverans 1 och 2 i `SYSTEM-AUDIT-AND-DATA-VALUE-PLAN-2026-09-06.md`, inte ett godkännande av hela planen eller av livehandel.

## Implementerat

- Operatörsinloggning på `/operator`, åtkomlig från sidopanelens kontolänk. Serververifierad, signerad tvåtimmarssession i HttpOnly-cookie, Secure i produktion, SameSite Strict. Privilegierade actions kontrollerar sessionen innan formulärvärden läses eller databasen/provider anropas. `/execution` skyddas före privata frågor. Inloggningen ändrar inte execution-läget.
- Migration 0081 tar bort publik läsning av execution-/kontodata samt rå scheduler-/providerhistorik. Generell Supabase-inloggning ger inte operatörsbehörighet. Publika servervyer visar utvalda driftfält; formulärets klientprops innehåller bara jobbnamn/typ, inte metrics eller råa fel.
- Qualification Diagnostics läser sammanfattning och en begränsad bedömningslista separat. Namn hämtas efter urvalet. Fel i ena panelen förstör inte den andra; misslyckade läsningar blir inte framgångsrika nollor.
- Data Operations använder gemensamt exakt 24-timmarsfönster och databasaggregat, inte summan av de senaste 300 raderna. Okända räknare visas som `—`, med felmeddelande. Laddfel hanteras separat, även transportfel. Providerstatus härleds inte längre från ett generiskt schedulerjobb. `HEALTHY` i databasen räcker inte om senaste lyckade körning är gammal. Paus och felaktiga framtida tidsstämplar är tydliga.
- Migration 0082 ger beständig rotation över wallets/tokens och filtrerar redan behandlade transaktioner i databasen före batchgränsen. Ett djupt äldre wallet kan inte ensamt fylla det första REST-resultatet. PnL-läsningar är wallet-/assetavgränsade och paginerade; överskriden läsbudget rapporteras utan att en trunkerad historik behandlas som komplett.
- Saknad verifierad execution-kontext anges uttryckligen i wallet-diagnostiken. Uppgifter om pool eller historiskt pris uppgraderas inte till 100 % verifiering. Riskkomponenternas små/stora bokstäver normaliseras, okända statusar räknas inte som täckning.
- Baseline v2 använder avslutade femminuterscandles för aktier och crypto-observationer för crypto. Historiken avgränsas till samma asset och högst 30 dagar/10 000 senaste rader, läses i sidor, och filtreras på både observationstid och tillgänglighet. Saknad volym/likviditet hittas inte på. En gammal stängningskurs blir inte femminutersmomentum över en marknadsstängning. V1-historik behålls; candle-referenser sparas separat från crypto-referenser via migration 0084.
- Skrivande Supabase-tester kräver explicit separat testprojekt, separata testnycklar och bekräftelse av testskrivningar. Projekt-/produktionsuppgifter används inte som fallback; ett test som tidigare laddade `.env.local` direkt gör inte längre det.

## Verifiering

- `npm run typecheck`: godkänt.
- `RUN_SUPABASE_INTEGRATION=0`, `npm test -- --reporter=dot`: **473 godkända, 57 överhoppade**. De överhoppade testerna kräver separat Supabase-miljö; de är inte bevis för att integrationsflöden fungerar i produktion.
- `npm run build`: godkänt på installerad Next.js 16.3.1.
- Lokalt produktionsläge: `/operator` svarar 200 och visar formuläret; `/execution` omdirigerar både anonyma anrop och förfalskad cookie till inloggning; `/api/health` svarar 200; cron utan behörighet svarar 401. Ingen action skickades och ingen providerorder testades.
- `scripts/check-data-value-migrations.mjs`: samtliga **84 migrationer** körda i en ny PostgreSQL-minnesdatabas via tillfällig PGlite-installation. Testet verifierar rollernas läsrättigheter, service-role RPC-anrop, över 1 000 äldre wallettransaktioner, rättvis rotation/retry, nytt wallet, tidsfönstrets gränser samt att v1-resultat inte dränerar v2-kön. Inga externa data används. Auth-schema/roller är testanpassade; detta ersätter inte Supabase-stagingkontroll eller lasttest.
- Visuell desktop-/mobilkontroll är **inte** utförd: ingen ansluten webbläsare var tillgänglig. HTML-/komponenttester är inte en visuell kontroll.

## Innan publicering

1. Granska ändringarna och kontrollera migrationsordningen 0081–0084 mot aktuell miljö. Testa på separat Supabase-projekt med dess verkliga behörigheter och REST-gränser. Minnesdatabastestet ovan kan upprepas enligt instruktionerna i skriptet.
2. Använd serverns `DATA_OPERATIONS_OPERATOR_TOKEN`: ett slumpmässigt hemligt värde med minst 32 tecken. Ingen `NEXT_PUBLIC_`-variabel, inget värde i Git/chatten. Saknad/för kort token stänger åtkomsten. Säker drift bör komplettera delad operatörstoken med individuell inloggning/MFA och rate limiting; detta är en första enoperatörsgräns, inte ett fleranvändarsystem.
3. Efter separat beslut om publicering: applicera migrationerna, publicera tillhörande kod och verifiera anonym läsning/nekade actions i målmiljön. Kontrollera att server-role fungerar men anon/authenticated inte kan läsa privata tabeller.
4. Behåll nuvarande handelsspärrar. Följ första naturliga worker-körningarnas fel, tidsåtgång, läsbudget och providerförbrukning. Kontrollera nya v2-källreferenser och pending-kön; en grön deploy är inte driftbevis.

## Viktiga begränsningar och nästa arbete

- Wallet-verifieringen blir **inte automatiskt klar** med denna ändring. Nuvarande providerflöde saknar fortfarande verifierad execution-kontext; informationskompletthet är fortfarande 0/50, inte 100. Implementera en verklig evidensleverantör/ett komplett evidenskontrakt innan detta kan passera. Sänk inte trösklar för att få trades.
- Evidens som blir tillgänglig efter kandidatens cutoff och behöver ett senare återbesök är fortfarande en separat reparation. Rotation är inte ett nytt exklusivt lease-protokoll; samtidighets-/kapacitetsarbete återstår. Wallet-PnL-rebuild är ännu inte en atomisk databastransaktion.
- V2-batchen är begränsad till 25 källprognoser per körning. Historiska v1-källor blir nya v2-uppgifter; den gamla kön kan därför ta tid. Reserverad kapacitet för aktuella mål kontra backfill, prioriterade instrument och gemensamma providerbudgetar behöver införas/mätas. Inga tidslöften eller prognos-/avkastningslöften följer av kodfixen.
- Baseline-resultat är historiska kohortbeskrivningar, inte validerad strategiedge. Antal överlappande exempel är inte antal oberoende trades. Kontinuerlig kalibrering/OOS och kostnadsmodell återstår.
- Återstående leverans 1: gemensamt agentregister, konsekventa lässtatusar på övriga sidor, session/marknadsstängningsstatus och återstående döda kontroller. Testdata är inte raderade ur produktion.
- Nästa synliga produktleverans är **en beständig resultatsida per backtest-ID**: samma strategi, asset, datum, trades, kurva och kapitalutfall i hela rapporten. Äldre resultat ska gå att hitta och en senare worker-körning ska inte byta det användaren läser.
- Strategy Intelligence får inte automatiseras som OOS medan workern hårdkodar `VALIDATION`. Säkerhet direkt före ordersändning, fills, konto-/instrumentseparerad ledger och verklig FX är fortfarande öppna uppgifter. Ingen ny orderväg eller livehandel är godkänd här.
