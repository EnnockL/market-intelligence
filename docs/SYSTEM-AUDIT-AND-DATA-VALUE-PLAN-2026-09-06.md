# Webbplatsgranskning och plan för verklig datanytta

Datum: 6 september 2026. Underlag: kod vid `0c254c9`, läsningar av produktionen och publicerade sidor cirka 23:40–23:58 Europe/Stockholm. Siffrorna är ögonblicksbilder; schemalagda jobb fortsätter att köras.

## Slutsats och beslut

Systemet har en omfattande grund: verklig datainsamling, sparad evidens, versionshanterade regler, backtester, valideringsregler och demo-integration. Huvudproblemet är inte brist på fler sidor eller fler agenter. Det är att flera producenter, konsumenter och resultatvyer inte är korrekt ihopkopplade.

Prioritera ett smalare men sammanhängande flöde som går att följa och mäta. Börja med befintliga aktiecandles och fungerande backtestmotor, samtidigt som wallet-kedjans kontraktsfel rättas. Behåll crypto-research separat från låg-latenshandel. Köp inte ytterligare data enbart för att nuvarande resultatvyer är tomma: mät först vilka konkreta uppgifter som faktiskt saknas.

Utvecklingsmålet är att kunna svara: **Vad lärde vi oss av datan, vad testades, vad blev utfallet och hur tillförlitligt är det?** Ett högre antal trades är inte ett godkännandekriterium. Förbättringarna kan ge bättre beslutsunderlag och mindre slöseri, men kan inte garantera lönsamhet.

## Vad som har kontrollerats

- 17 huvudsidor: publicerat HTML-innehåll och HTTP-svar. Samtliga svarade 200 vid kontrollen.
- Fyra representativa detaljsidor: tillgång, wallet, möjlighet och Jackpot-kandidat. Samtliga svarade 200. Signal- och paper-tradedetaljer har granskats i kod; hela deras klickflöde är inte verifierat.
- Frontendens datafrågor, backendproducenter, schemaläggning, labb, validering, wallet-berikning, risk och execution.
- Läsande produktionsfrågor för att skilja kodens avsikt från den data som faktiskt finns.
- `npm run typecheck`: godkänd. `npm test`: 375 godkända, 57 integrationstester överhoppade. Integration mot produktion var uttryckligen avstängd.
- Ingen ändring av produktionsdata, inga manuella worker-körningar, inga nya backtester, inga order och ingen deploy gjordes i denna granskning.

Browser-färdigheten användes för anslutningsförsök, men ingen webbläsare fanns ansluten. Därför är detta **inte** en verifierad visuell mobil-/tillgänglighetsgranskning. HTTP 200 bevisar inte att knappar, formulär, responsiv layout eller hela affärsflödet fungerar. Produktionsbygget och migrationshistoriken har inte omverifierats fullständigt denna gång.

## 1. Genomgång av hemsidan

| Sida | Nuläge och viktigaste förbättring |
| --- | --- |
| Market Radar `/` | Visar många fullständiga delpaneler trots separata sidor. Övergripande status säger att marknadsdata saknas, men aktiepriser visas längre ned. Indexrutorna är hårdkodat otillgängliga. Gör startsidan till en kort resultatöversikt med tydliga källor och länkar. |
| Watchlist `/watchlist` | Visar fem hårdkodade aktier, inte ett gemensamt konfigurerat universum. Pris, signaltillstånd och färskhet behöver skiljas åt per tillgång. Visa MARKNAD STÄNGD separat från trasig datakälla. |
| Signals `/signals` | Läser den äldre tabellen `signals`, som saknar identifierad aktuell producent. Strategikedjan skriver till `strategy_runtime_signals`. Koppla respektive signaltyp till rätt producent; blanda inte researchsignaler med orderbehörighet. |
| Tillgång `/assets/[id]` | AMD-sidan saknar pris när signal saknas, trots befintliga marknadspriser och candles. Pris/historik ska inte kräva en tradingsignal. |
| Research `/research` | Endast länkhub. Gör den till ingång för senaste resultat, datatäckning och nästa möjliga experiment. |
| Agent Center `/agents` | Visar 36 registrerade jobb och mycket detaljer, men vissa agentkort söker output i fel tabell och säger NO RECENT OUTPUT trots aktivitet. Visa funktion → input → senaste användbara output → konsument. |
| Data Operations `/data-collection` | 35/35 aktiverade jobb ser friska ut, men detta är inte samma sak som användbar data. Flera antal kan bli falska nollor vid queryfel, och begränsade resultatlistor används som dygnsantal. Visa riktiga aggregat, köålder och konsumerad evidens. |
| Fast Flow `/fast-flow` | Inga verifierade konvergenser. Nuvarande pollingkapacitet är inte ett verifierat sub-30-sekundersflöde. Visa faktiskt observerad fördröjning och saknade bevis. |
| Jackpot `/jackpot` | Kandidater finns; senaste stickprov har okänd wallet-/riskinformation. Listan väljer revision ur en osorterad relation. Visa deterministiskt aktuell revision och vad som väntas härnäst. |
| Wallet `/wallets/[address]` | Kan visa LIVE med uppdatering flera dagar gammal. Skilj upptäckt aktivitet från full historik, verifierad PnL och aktuell bevakning. |
| Möjlighet `/opportunities/[id]` och Jackpot-detalj | Evidens-/revisionstidslinjer finns. Ett produktionsstickprov var uttryckligen av typen `integration`; testartefakter behöver separeras från verklig research. |
| Strategy Lab `/strategy-lab` | Backtester fungerar för vissa dataset. Äldre användbara resultat döljs av senaste 30 globala körningar. Kapitalruta och kurva följer globalt senaste körning, inte en beständigt vald rapport. |
| Strategy Validation `/strategy-validation` | Omfattande funktioner men svåröverskådlig global kontrollsida. Samla per hypotes/strategi och rätta återprövning av otillräckligt learningunderlag. |
| Simulation `/simulation` | Simulerar Jackpot-policyer, inte samma candle-strategier som Strategy Lab. Visar senaste globala körning och rå blocker-JSON. Sparade riskmått och tydlig körningsidentitet behöver visas. |
| Historical Replay `/replay` | Visar ett äldre globalt replay-resultat med senaste 100 händelser. Backend kan skapa kopplad simulation utan att UI visar den. Lägg till filter, paginering och länk till kopplad körning. |
| Forecasts `/forecasts` | Statuslistor dominerar. Förväntad avkastning, intervall, observerat utfall och konkreta orsaker är inte synliga. Datakällan för aktiebaseline behöver först rättas. |
| Knowledge `/knowledge` | Sex grundregler visas. Existerande retrieval-spår och vilka analyser som använder reglerna syns inte. Koppla kunskapen till evidens och faktisk användning. |
| Paper Portfolio `/paper` och tradedetalj | Policyportföljer finns men inga fyllda order i visat underlag. Bokföring, valutaomräkning och retry-säkerhet måste rättas innan resultaten används som bevis. |
| Execution Guard `/execution` | DEMO och live-förbud syns tydligt. Kontouppgifter visas utan login. Submission, fills och riskledger har säkerhetsluckor som måste stängas före ordertest. |
| System Map `/systems` | Påståendet 39 system med backend + UI mäter katalogreferenser, inte ett verifierat komplett flöde. Vissa schemalagda system står som MANUAL/NOT RUN. Använd samma systemregister som scheduler och Agent Center. |
| Health `/api/health` | Svarar ok för webbprocessen. Det är inte ett test av databas, datafärskhet, risk eller användbara resultat. Separera liveness från skyddad readiness. |

Gemensamt: ingen automatisk siduppdatering hittades i appens komponenter. `force-dynamic` innebär färsk läsning vid laddning/navigation, inte att en öppen sida uppdateras live. Engelska och svenska blandas. Startsidan har bland annat en All assets-knapp utan handling; kommandopalett/profilknappar i layouten saknar också kopplad funktion.

## 2. De viktigaste bekräftade orsakerna

### A. Data finns, men stora delar når inte bearbetningen

Vid kontrollen fanns 16 908 crypto-tokenposter och 24 651 köp/säljtransaktioner. Relevanta repositoryfrågor returnerade bara 1 000 rader. Wallet-berikningens urval innehöll endast två wallets och historik från juli–oktober 2024. Rättvis fördelning tillämpas efter detta begränsade urval och kan därför inte hjälpa de wallets som aldrig kommer med.

Åtgärd: paginerad kö för obehandlade eller ändrade poster, stabil cursor och status per wallet. **Att rätta paginering får inte leda till att alla 16 908 tokens plötsligt pollas dyrt varje körning.** Skilj bevakade tillgångar, aktiva kandidater och långsam bakgrundsrotation.

Kod: `src/repositories/ingestion-repository.ts:83,120,127,150`, `src/workers/wallet-pnl.ts:28`.

### B. Wallet-verifiering har ett omöjligt producent-/konsumentkontrakt

Aktuell producent sätter `informationCompleteness` till 0 eller 50. Cykelns kvalitet beräknas som `0.4*pricing + 0.2*transaction + 0.2*execution + 0.2*information`. Högsta möjliga total blir 90, samtidigt som verifierade trades kräver exakt 100.

Samtliga 640 enrichmentposter kontrollerades: information var högst 50. Samtliga 30 rekonstruerade cykler var incomplete, med kvalitet 20–90.

Åtgärd: definiera den verkliga evidens som krävs för varje komponent och bygg saknade producenter. Saknas historisk information hos leverantören ska det framgå som ett avgränsat hinder. Sätt inte poäng till 100 och sänk inte gränser för att skapa aktivitet.

Kod: `src/repositories/ingestion-repository.ts:135`, `src/domain/wallet-pnl.ts:67,88`, `src/domain/wallet-performance.ts:7`.

### C. Ny evidens hämtas men används inte i nästa beslut

En spårad kandidat fick riskdata 10,6 sekunder efter berikningskörningens cutoff. Återläsningen använde fortfarande den äldre cutoffen och ignorerade den nyhämtade posten. Under senaste 24h hade 220 olika kandidater varsin gap-utvärdering, utan stängda safety-/konvergens-/oberoendegap i det kontrollerade underlaget.

Åtgärd: bestående väntkö och senare revision när evidens blivit tillgänglig. Bevara äldre beslut och deras cutoff. Ett senare svar får inte retroaktivt göras tillgängligt i ett äldre backtest. Korrekt konsumtion garanterar inte godkännande: riskdatan i exemplet var fortfarande ärligt UNKNOWN.

Kod: `src/services/data-gap-closure/service.ts:4,7`.

### D. Aktiebaseline använder cryptodata och gamla begränsade urval

Kontrollen visade 9 587 baselines och inga AVAILABLE. Nästan alla gällde aktier, men observationshämtningen läser `crypto_market_observations`. Det stigande tidsurvalet begränsas dessutom till de första 1 000 raderna av serverns radtak.

Åtgärd: typade aktie-/cryptofeatures, rätt tillgång och tidsfönster, fullständig paginering samt separat modellversion. Återanvänd data bara när den fanns tillgänglig vid prognosens cutoff. Avsaknad av positiv prognos får fortsatt vara ett giltigt resultat.

Kod: `src/services/baseline-forecast/service.ts:128`.

### E. Databasfel presenteras som att inget har hänt

Den exakta detaljfrågan för Qualification gav PostgreSQL `57014`/statement timeout, samtidigt som den separata aggregatfrågan lyckades med DISCOVERED 950, WATCHING 4, QUALIFIED 0. Gemensam felhantering kastar bort även den fungerande sammanfattningen. Startsidan visade därför 0 och uppmanade till första worker-körningen.

Jackpot-listan lyckades vid en separat kontroll; orsaken till dess tillfälliga degraded-status på startsidan är inte slutligt fastställd.

Åtgärd: separat status per fråga, små indexerade läsmodeller och tydlig skillnad mellan noll, saknas, laddfel och gammalt. Bevara fungerande paneler när en annan fråga misslyckas.

Kod: `src/data/qualification-data.ts:5`, `src/data/jackpot-data.ts`, `src/app/data-collection/page.tsx`.

### F. Jobben körs, men inte med de intervall användaren tror

36 jobb är registrerade, varav 35 aktiverade. En kontroll av fyra timmar visade omkring 32,5 minuters faktisk genomsnittlig kadens för flera jobb konfigurerade för 1–5 minuter. Cron kör varje minut men standardkonfigurationen tar ett jobb per anrop.

Åtgärd: kapacitetsbudget, separata köer för tidskritiska jobb och tung historik, begränsad parallellism, leases och providerbudget. Mät faktisk median/p95, inte enbart deklarerat intervall. Eventdrivet sub-30s Fast Flow är en separat framtida kapabilitet, inte något som nuvarande polling redan uppfyller.

Kod: `src/app/api/cron/forecast/route.ts:45`, `src/services/forecast-scheduler/service.ts`, `vercel.json`.

### G. Användbara labbresultat finns men presentation och validering släpar

Vid första stickprovet fanns 539 backtester. En äldre AMD/EMA-körning hade 80 trades, EV cirka +0,123 R och profit factor cirka 1,19. Det är historisk research, inte verifierad framtida edge. Senaste 30 globala körningar dolde den. Senare under kontrollen visade kapitalrutan i stället en annan körning med två trades och +69 kr på hypotetiska 10 000 kr, utan tydlig beständig vald rapport.

Strategy Intelligence-snapshots och selectorresultat var senast uppdaterade den 25 augusti. De schemalagda researchkörningarna uppdaterar inte automatiskt denna kedja. Valideringsautomatiken behandlar ett INSUFFICIENT_DATA-resultat som avslutad learningfas men kräver APPROVED för nästa fas: ny data kan därmed inte driva en korrekt återprövning. Testtillgången NEWSINT skapar dessutom upprepade körningar utan candles.

Kod: `src/app/strategy-lab/page.tsx:11,23`, `src/domain/validation-automation.ts:39`, `src/workers/strategy-pattern-lab.ts:17`.

## 3. Säkerhets- och bokföringsgränser

Detta är kodgranskade risker, inte genomförda exploateringstester. Inga skrivande anrop gjordes.

1. **Åtkomst före nya funktioner.** Lab-import, backtest och valideringsactions saknar identifierad autentisering och använder service-role. Ingen övergripande sessionskontroll hittades. Publicerad Execution Guard visar demokontodata utan inloggning; RLS-policyer tillåter också publika läsningar av delar av kontodata. Bestäm uttryckligen vad som får vara offentlig research respektive privat operatörsyta, och skydda både serveractions och databasen.
2. **Separera testdata från produktion.** NEWSINT och en möjlighet av typen integration finns i produktionsunderlaget. Integrationstester kan skriva till databasen som miljövariablerna pekar på. Kräv separat testprojekt och skydd mot produktionsanslutning. Märk och avgränsa befintliga testartefakter; radera inte historiska beslut eller data slentrianmässigt.
3. **Kill switch måste gälla vid själva orderanropet.** Nuvarande `submitReady` kan behandla tidigare SAFETY_PASSED-order utan ny kontroll av `kill_switch`/`new_orders_enabled`. Stop/target sparas men finns inte i providerorderns kontrakt. Exitansvar måste därför verifieras uttryckligen.
4. **Fills och riskledger måste vara kompletta.** Ingen aktuell writer till `execution_fills` hittades. Ledgern sammanför tillgångar och läser endast dagens fills, utan tillräcklig konto-/instrumentseparation; fyllda innehav ingår inte korrekt i total exponering.
5. **Paper-PnL är inte tillförlitligt förrän bokföringen är rättad.** Flera orders kan använda samma gamla cashsaldo, retries kan duplicera positioner, valuta använder hårdkodad USD/SEK 10,5 och exit-slippage sätts till noll.

Kodankare: `src/app/strategy-lab/actions.ts:24`, `src/app/strategy-validation/actions.ts:18`, `supabase/migrations/0058_account_state_risk_ledger_v1.sql:13`, `src/workers/execution.ts:8`, `src/services/execution/service.ts:16`, `src/services/execution/account-state-service.ts:14`, `src/domain/risk-ledger.ts:10`, `src/services/paper-portfolio/service.ts:13,205`.

Livehandel ska förbli förbjuden. Att koppla korrekt data till fler godkända förslag får inte användas som anledning att börja skicka order innan dessa gränser är verifierade. Inga ändringar av nuvarande controls har gjorts i granskningen.

## 4. Så får vi större nytta av samma data

Inför gemensamma kontrakt ovanpå befintliga tabeller och outbox; ingen ny infrastrukturplattform behövs som första steg.

`Källdata → normaliserad evidens → gemensamma features → research/beslut → validerade utfall → begriplig rapport`

- **Ett tillgångsregister:** asset-ID, kedja/instrument, provider-ID, handelssession, valuta och stödda tidsupplösningar. Symbolen AMD får inte ensam identifiera både en aktie och en token med liknande namn.
- **Ett täckningsregister:** tillgängliga tidsintervall, luckor, källa och senast verifierade data. En likviditetsrad betyder inte att en hel historisk period är täckt.
- **Gemensamma beräkningar:** beräkna candles/tekniska features och walletcykler inkrementellt en gång; låt labb, agenter och förklaringar återanvända samma versionerade resultat. Cache måste inkludera tillgång, upplösning, cutoff, kodversion, indata-/datasetrevisionens hash inklusive tillgänglighet samt relevanta regel- och kostnadsparametrar.
- **Gemensam anropsbudget:** registrera provider, endpoint, tidsintervall, förbrukning och konsument. Samordna dubbla samtidiga anrop, återanvänd verifierad historik och använd tidsbegränsad cache för färsk data. Providerbegränsningar och fallbackfel ska synas, inte sväljas.
- **Behovsdriven prioritering:** komplettera konkreta bevis för aktiva kandidater och bevakade tillgångar före ytterligare bred upptäckt. Behåll en begränsad utforskande rotation för att undvika att hela universumet blir för snävt.
- **Beroendestyrda jobb:** ny candlebatch kan trigga berörda features och relevanta experiment; ny wallethistorik kan trigga just den walletens PnL/verifiering. En oförändrad datamängd ska inte skapa ännu en informationslös resultatrad.
- **Billiga UI-läsningar:** använd paginerade listor och små aggregat per tidsfönster. Förkorta återkommande tunga nested joins; mät frågorna innan index införs. UI-cache får inte återanvändas som beslutsunderlag efter dess cutoff.
- **Bevara revisionsspåret:** arkivering/retention införs först efter volymmätning och separat policy. Underlag för frysta tester och historiska beslut ska förbli reproducerbart.

### Mät nytta, inte bara antal rader

| Mått | Varför det behövs |
| --- | --- |
| API-anrop/förbrukning per källa och jobb | Visar vart budgeten går. |
| Hämtat → nytt sparat → berikat → konsumerat | Avslöjar dubbletter och data som aldrig når ett resultat. |
| Täckning per tillgång, timeframe och datum | Visar vad som faktiskt går att testa. |
| Äldsta obehandlade post och p95-väntetid | Visar svält och kapacitetsproblem. |
| Unika trades och nya oberoende utfall | Skiljer lärande från upprepade körningar av samma data. |
| UNKNOWN per namngiven delkomponent | Gör nästa datainsats konkret. |
| Kostnad per användbar evidens/utvärdering | Gör leverantörsval och prioritering mätbara. |
| Prognosfel och nettoresultat efter kostnader | Visar om analysen faktiskt hjälper, inte bara producerar text. |

## 5. Prioriterad byggplan: sex avgränsade leveranser

Ordningen nedan är beroendestyrd. Delar kan byggas parallellt, men säkerhetsgränser får inte passeras av en snabbare del. Tiden till eventuell verifierad edge kan inte lovas i timmar eller dagar.

### Leverans 1 — Ärlig och skyddad produkt

Bygg gemensam åtkomstkontroll för operatörsactions/kontodata, skydd mot integrationstester i produktion, samt datastatus `CURRENT / MARKET_CLOSED / STALE / EMPTY / ERROR / UNSUPPORTED` där relevant.

Rätta Qualification-falsknollan, separera panelernas felhantering och visa senaste lyckade uppdatering. Skapa ett gemensamt register för Agent Center, System Map och schemaläggning. Ta bort eller koppla knappar som inte gör något.

**Godkänt när:** anonym användare inte kan utlösa privilegierade actions eller läsa privat kontodata; ett framkallat queryfel i test visas som fel, aldrig som noll eller READY; dashboardaggregat stämmer mot samma tidsfönster i databasen. Inga produktionsskrivningar används för säkerhetstestet.

### Leverans 2 — Reparera datan fram till konsumenterna

Inför fullständiga men budgeterade pending-urval. Rätta walletkvalitetskontraktet, risksvarens statusnormalisering och evidensens återbesök. Ge aktieprognoser rätt källdata. Avgränsa testtillgångar från det verkliga researchuniversumet. Lägg regressionstester runt varje bekräftat fel.

**Godkänt när:** testdata bortom rad 1 000 behandlas; alla bevakade wallets har redovisad status; full evidens kan passera verifiering och saknad kritisk evidens blockeras; nyhämtade bevis konsumeras i senare revision eller har uttrycklig oanvändbarhetsorsak; aktiebaseline läser aktieobservationer utan framtidsläckage.

Positivt resultat eller kvalificerad trade är **inte** ett krav för att kalla denna leverans korrekt.

### Leverans 3 — Gör resultat begripliga och beständiga

Inför resultat-ID i URL och en rapport per körning. Bind formulär, kapitalmodell, kurva, trades och validering till exakt samma körning. Visa testad strategi/version, tillgång, faktisk dataperiod, antal unika trades, kostnadsmodell och databrister.

Visa startkapital → slutkapital, vinst/förlust i kronor och procent, största nedgång samt enkel förklaring. Skilj en R-baserad kapitalillustration från en full kontosimulation med valutaväxling, positionsstorlek och avgifter. Noll trades ska ge en konkret orsak, inte ett skenbart bevis på att strategin är riskfri.

Lägg till historik/filter/paginering, import kopplad till valt asset och val av bara kompatibla dataset. Spara datumval. Lägg en tydlig Research-start med senaste resultat och nästa möjliga åtgärd. Befintliga snapshots/prognosorsaker ska kunna öppnas direkt.

**Godkänt när:** användaren når vald rapport på högst två klick; en senare bakgrundskörning ändrar inte den öppna rapportens resultat; äldre AMD-resultat går att hitta; faktiska tillgängliga datum syns före test; rätt källa och körning följer med till valideringen.

### Leverans 4 — Effektiv kontinuerlig bearbetning

Inför köklasser för tidskritisk bevakning, evidenskomplettering och tung research/backfill. Beräkna kapacitetsbehov från uppmätt jobbtid, önskat intervall och providerbudget. Använd begränsad parallellism, atomiska claims, leases, retries och gemensam anropscache. Kör om berörda beräkningar när deras indata ändras.

Lägg till lätt automatisk uppdatering av översikter när sidan är synlig, med tydlig tidsstämpel. Frys däremot valda historiska rapporter. Visa marknadens session och stängda dagar korrekt.

**Godkänt när:** faktisk median/p95 och köålder visas; överenskomna intervall hålls under uppmätt last; inga dubblettkörningar vid överlapp/omstart; inget jobb kan övertrassera gemensam providerbudget. Sätt exempelvis 2 sekunder som initialt mätmål för sammanfattningsfrågor och verifiera det, inte som utlovad prestanda.

### Leverans 5 — Från research till ärlig validering

Koppla färdiga backtester till Strategy Intelligence och valideringskön. Återpröva INSUFFICIENT_DATA i rätt learningfas när **ny** evidens finns. Behåll REJECTED och frysta OOS-fönster intakta. Identifiera datasetversion och överlapp, så upprepade körningar inte räknas som nya oberoende trades. Den befintliga `src/workers/strategy-intelligence.ts:9` hårdkodar split till VALIDATION: detta måste rättas innan arbetet automatiseras. Learning-/explorationresultat får aldrig bli OOS-underlag genom ommärkning; split ska härledas från fryst protokoll och datasetets tidsgränser.

Börja med ett litet antal befintliga regelklasser på tillgångar med tillräckliga candles. De positiva AMD-observationerna kan granskas som hypoteser; de ska inte automatiskt få etiketten bäst eller godkänd. Skilj forskningsprioritet från uppmätt prestationsranking. Koppla senare prognosutfall, regim, kostnader och stresstest till samma strategiidentitet.

**Godkänt när:** en körning kan följas från hypotes och data till resultat, fryst validering och senare utfall; granskaren ser samplekrav, osäkerhet, avgifter och varför resultat godkänns/avvisas; ändringar under freeze går till nästa learningversion. NO_STRATEGY_ELIGIBLE/NO_TRADE är fullt giltiga utfall.

### Leverans 6 — Verifierad paper- och demokedja

Rätta atomisk paperbokföring och byt fast valutaomräkning mot faktisk historisk FX där det krävs. Implementera idempotenta providerfills, konto-/instrumentseparerad riskledger, övernattspositioner och korrekt exponering. Kontrollera aktuella säkerhetsgränser omedelbart före orderanrop och definiera verifierat exitansvar.

Testa först isolerat med realistiska fixtures och felinjektion: två samtidiga köp, flera instrument/konton, partiella fills, timeout, restart, midnatt, kill switch efter köläggning och bortfallen pris-/FX-data. Därefter kan ett separat uttryckligen godkänt demotest verifiera providergränsen. Livehandel ingår inte i denna leverans.

**Godkänt när:** cash, innehav, avgifter, reserver och PnL går att stämma av; omkörning skapar inte extra order/fills/positioner; kill switch stoppar även redan köade order; okänd kritisk data blockerar nya order utan att stoppa nödvändig säker avstämning.

## 6. Frontendens föreslagna arbetsflöde

Behåll egna sidor men gruppera dem efter användarens uppgift. Återanvänd befintliga vyer, undvik ytterligare separata kontrollpaneler.

1. **Översikt:** vad har uppdaterats, vad finns att granska, vad är blockerat och varför?
2. **Marknad:** bevakade tillgångar, aktie-/tokenhistorik, wallets, kandidater och evidens.
3. **Labb:** förbered data → testa → öppna resultat → jämför → validera. Simulation märks tydligt som Jackpot-policy när det är dess scope.
4. **Resultat:** sparade rapporter, utfallsjämförelser, paper/demosammanställning med tydlig miljömärkning.
5. **Drift:** agenter, datakällor, köer, kostnader, fel och skyddad executionadministration.

Varje sammanfattning ska besvara: **Vad gäller detta? När uppdaterades det? Vad blev resultatet? Hur säkert är det? Vad kan jag göra härnäst?**

Mobil- och tillgänglighetstest måste göras i ansluten webbläsare: 320/375/390/768 px och desktop, långa tokennamn/adresser/feltexter, datumval, numeriska fält, navigation med tangentbord, fokus i mobilmeny och båda teman. Innehåll ska brytas eller få lokal scroll; global overflow-klippning får inte användas för att gömma nödvändig information. En öppen navigationsmeny ska inte lämna tangentbordsfokus bakom sig.

## 7. Vad vi inte prioriterar nu

- Fler agenter innan befintliga outputs har rätt konsument och mätbart värde.
- Fler dataköp utan ett dokumenterat täckningsgap och kostnadsbudget.
- Fler strategivarianter som enbart omtestar samma period tills någon ser bra ut.
- Lägre risk-/kvalitetsgränser för att skapa fler gröna rutor eller trades.
- AI-förklaringar som ersätter saknade fakta; förklaringar ska senare läsa verifierad evidens och dess begränsningar.
- Större kapital eller livehandel innan bokföring, säkerhet och separat validering är klara.
- Omskrivning av hela systemet till en ny teknikplattform.

## Rekommenderat nästa byggsteg

Starta med leverans 1, samtidigt med de avgränsade pagination-/verifieringsreparationerna i leverans 2. Ta därefter fram den beständiga resultatvyn i leverans 3 så förbättringen blir synlig för användaren. Säkerhets- och ledgerarbetet kan förberedas parallellt, men ingen ny orderväg bör aktiveras under tiden.

Efter varje leverans: visa exakt vilken kedja som nu fungerar, nya regressionstester, en spårbar produktionsläsning och kvarstående begränsningar. En ny grön testsvit eller en grön deploy ersätter inte detta bevis.
