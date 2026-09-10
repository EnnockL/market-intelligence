# Fills och kontoledger v2

Lokal backendetapp. Inte committad, pushad, migrerad eller publicerad. Inga riktiga eller demo-order har skickats. Verifiering använder isolerade testfixtures, inte påhittade affärer i appen. Frontendens prestandaarbete väntar fortfarande.

## Implementerat

- Read-only OKX-demo `fills-history`, begränsade sidor och återupptagning med `billId`. Faktiska fills sparas atomiskt tillsammans med checkpointen. En orders ack eller ackumulerade fyllda kvantitet används aldrig för att hitta på enskilda fills.
- Identitet omfattar konto, provider, miljö, instrument och provider-fill-ID. Ett trade-ID ensamt är inte global identitet. Externa manuella fills bevaras utan att låtsas ha en lokal order. Äldre rader får inte gissad kontotillhörighet och uppgraderas inte till verifierade.
- Raw provideravgift bevaras. Normaliserad avgift är positiv kostnad/negativ rebate. BASE-avgifter ändrar tokenkvantiteten; de debiteras inte dessutom som quote-cash. QUOTE-avgifter påverkar cash/kostnadsbas. Okänd avgift/annan avgiftsvaluta ger UNKNOWN.
- SEK-konvertering kräver direkt, tidskorrekt, tillgänglig och tillräckligt färsk FX-evidens. USD, USDT och USDC är inte samma valutakurs. Källreferenser sparas. Ett aktuellt kontosaldo initierar aldrig automatiskt startkapitalet.
- Kontoledger v2 håller varje instrument för sig och läser inköpshistoriken från en uttrycklig nollinnehavs-/cash-baseline. Dagens realiserade PnL skiljs från PnL sedan baseline. Positioner värderas i domänen med explicita markpriser, inte senaste fill eller inköpspris.
- Kvarvarande orderkvantitet används för reservation, inte hela ursprungsordern. Avgiftsbufferten måste vara uttrycklig. Slutkontrollen räknar bort bara den order som kontrolleras; redan genomförda fills räknas aldrig bort. SELL kräver rätt instruments tillgängliga kvantitet.
- Nyaste snapshot läses före kontroll av version/status. Ingen fallback från ny UNKNOWN till äldre KNOWN. Payload, konto, ekonomisk tidpunkt, kunskapstidpunkt och integritet måste stämma. Bridge v2 och slutkontrollen använder v2-kontraktet.
- Databasens sammanfattning av sammanhängande fill-fönster har ett begränsat svar även efter tusentals checkpoints. Ingen tyst REST-trunkering och ingen växande ID-lista i frontend/API.
- Wallet-PnL `weighted-average-v2` kräver fullständig evidens på **varje** händelse. 200 kompletta köp följt av en ofullständig sälj får inte bli verifierade genom avrundning till 100 %. Delprocent kan avrundas för presentation; ofullständig cykel får högst dataQuality 99.

## Viktiga gränser: detta är inte en handelsklar pipeline

Migrationerna 0089–0090 är kontrakt och säkerhetsgränser, inte bevis för att kontot är avstämt. Att sätta flaggor enbart för att passera kontrollerna är inte en giltig lösning.

1. **Finansiering och cash i flera valutor:** import/reconciliation av deposits, withdrawals, transfers, öppningsinnehav och verkliga valutasaldon saknas. `ledger_history_verified_through` behöver ett verkligt underlag; en avslutad fill-sida bevisar inte detta. Nuvarande producer markerar icke-SEK-saldon `MULTI_CURRENCY_CASH_RECONCILIATION_REQUIRED`.
2. **Samtliga öppna providerorder:** lokal orderlista bevisar inte att inga manuella order finns på börsen. DEMO får därför `PROVIDER_OPEN_ORDERS_COVERAGE_UNKNOWN` tills en komplett producer är byggd. Kontots externa identitet behöver också bindas/verifieras vid credentialbyte.
3. **Aktuell värdering:** rena v2-domänen och testen stöder instrumentmärken, men capture-producenten skickar ännu inga påstått verifierade markpriser. Öppna innehav får därför UNKNOWN. Bygg en exakt instrument-/valutamappad producent och avstäm mot providerbalanser, inte symbolgissningar.
4. **Retention och tid:** `COMPLETE_WINDOW` betyder fullständigt sidläst provider-recorded-time-fönster inom OKX:s retention, inte komplett ekonomisk kontohistorik. Ekonomisk cutoff sparas separat från när uppgifterna blev kända. Historisk capture har ingen historisk pending-orderinventering och kan inte bli en nutida riskapproval. Gamla fills utanför retention kräver oberoende historik/baseline, inte en grön tom lista.
5. **Order/exit-policy:** nuvarande generella positions-/exponeringsgrindar kan även blockera SELL när kontot ligger vid en gräns. Ett separat, verifierat riskreducerande exit-flöde återstår; aktivera inte automatisk handel innan detta är testat. En single-claim för samma order bevisar inte att två olika samtidiga order delar en atomisk kontoreservation. Den gränsen, osäkra externa svar och samtidiga kontoförändringar behöver kompletterande implementation och stagingprov.
6. **Wallet-historik:** rå Solana-transaktion kan innehålla användbar evidens, men nuvarande normalisering är inte en verifierad swap-decoder. Ny engineversion löser inte atomisk publicering av cykler/kurva/metrics/verifiering. Gamla curve-deletes och samtliga readers behöver samma versionerade wallet-build. Ingen ny API-prenumeration är motiverad av dessa kodluckor ensam.

## Drift och test

- Ingen automatisk aktivering eller schema-backfill av konton. `ledger_opening_status` börjar UNKNOWN; fee-buffer börjar null. Gamla konton, riskrader och fills blir inte godkända genom migrationen.
- Verifierade read-budgetar är avsiktligt begränsade. Överskriden fill-/order-/FX-budget stoppar capture med fel, aldrig ett godkänt delresultat. För större konton behövs beständiga, atomiskt avstämda incremental-ledgers; skruva inte bara upp Node/REST-gränser.
- Fill-ingestion har en lokal sidbudget och timeout. Globalt delad providerbudget mellan workers återstår.
- Enhetstester och `scripts/check-data-value-migrations.mjs` kontrollerar bland annat avgiftstecken, basavgifter, dubbletter, konflikter, transaktionsrollback, konto-/instrumentseparering, historisk kostnadsbas, avsaknad av FX, reservationer, versionerade riskgrindar och privata RPC-rättigheter.
- Se verifieringsloggen i `BACKEND-HARDENING-2026-09-07.md`. Isolerad PGlite ersätter inte ett separat Supabase/PostgREST-stagingprojekt, realistisk samtidighetsbelastning eller en read-only avstämning mot användarens demokonto.

## Nästa backendleverans

Bygg ett read-only kontoreconciliation-paket: verifierad extern kontoidentitet → funding/balances → samtliga pending orders → explicita instrumentmärken → atomisk avstämd ledger. Först därefter kan de namngivna UNKNOWN-spärrarna få verkliga underlag. Därefter säkert exit-flöde, atomisk wallet-build och tidskorrekt labbrapport/OOS enligt huvudplanen. Frontendprestanda är fortfarande en egen mätbar leverans.

## Providerkällor

OKX beskriver tre månaders fill-historik, avgiftstecken och separat `ts`/`fillTime` i [officiella API-dokumentationen](https://www.okx.com/docs-v5/en/#order-book-trading-trade-get-transaction-details-last-3-months). [Pagineringen](https://www.okx.com/docs-v5/trick_en/#pagination) och [ID-scope](https://www.okx.com/docs-v5/trick_en/#identifiers) ligger till grund för cursors och fill-identitet. Dessa externa kontrakt är inte bevis för att ett visst demokonto redan är korrekt synkat.
