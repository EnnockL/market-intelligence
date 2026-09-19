# Lokal backendverifiering 2026-09-19

Den blockerade Docker-/Supabase-testuppgiften är genomförd. Kontrollerna kördes mot befintlig, isolerad Docker-stack `market-intelligence-backend-local`, API `127.0.0.1:57421`, PostgreSQL `127.0.0.1:57422`. Databasen hade 93 applicerade migrationer, högsta version 0093. Inga produktionsmigrationer, provideranrop eller order genomfördes.

## Resultat

- **56 integrationstester i 27 filer godkända**, inga överhoppade i denna körning. Verkliga anrop till lokal Supabase/PostgREST.
- **Alla sju SQL-kontrollgrupper godkända**, även vid omedelbar återkörning: intelligence/proveniens, data-gap-återbesök, sista execution-kontroll, fill-proveniens, frontendens paper-snapshot, wallet-evidensfönster och orderavstämning. Kontrollerna omfattar rättigheter, immutable historik, cutoff, kvoter och rollback.
- **Samtidighetskontroll godkänd med tre oberoende anslutningar**: verkligt radlås, avvisad inaktuell revision, nytt försök, idempotenta samtidiga observationer och full rollback vid fel i audit-sparandet. Dess testdata togs bort av kontrollen.
- Fel projektkatalog avvisades före läsning av lokala nycklar eller testkörning.
- Paper-snapshot-testets transaktion återställde befintliga portföljer; de fyra systemportföljerna fanns kvar efter SQL-körningarna.
- `git diff --check` godkänt. Ingen ny produktionsbuild eller full enhetstestsvit kördes; ändringarna gäller testverktyg och testdataisolering.

## Fixar som möjliggjorde körningen

Den globalt installerade Supabase CLI 2.117.0 kraschade i Bun redan vid `init --help`. Testkatalogens `config.toml` saknades också. Den körande Docker-stacken var däremot frisk. `run-local-supabase-tests.mjs` stöder därför nu `--docker`: containeridentitet, projektetikett, arbetskatalog och portar verifieras innan befintliga lokala testnycklar läses i minnet ur gateway-konfigurationen. Nycklar loggas inte. Det befintliga CLI-läget finns kvar men har inte kunnat testas här.

SQL-kontroller från en tidigare körning hade lämnat testdata. Proveniens- och wallet-testernas fasta assetsymboler är nu unika per körning. Paper-snapshot-testet isolerar sina portföljdata inom en transaktion som alltid rullas tillbaka. Övriga SQL-testdata ligger kvar enbart i den separata testdatabasen, enligt befintligt testupplägg.

## Återkörning på denna dator

Separat projektkatalog:
`C:/Users/djnoc/AppData/Local/Temp/market-intelligence-supabase-test-869c33c386aa4b5489373919826f0b74`

Tillfällig PostgreSQL-drivrutin (pg 8.16.3 installerad från lokal npm-cache):
`C:/Users/djnoc/.codex/tmp/trading-local-test-tools-20260919/node_modules/pg`

Från reporoten i PowerShell:

```powershell
$testProject = 'C:/Users/djnoc/AppData/Local/Temp/market-intelligence-supabase-test-869c33c386aa4b5489373919826f0b74'
$testDriver = 'C:/Users/djnoc/.codex/tmp/trading-local-test-tools-20260919/node_modules/pg'
node scripts/run-local-supabase-tests.mjs sql $testProject --docker $testDriver
node scripts/run-local-supabase-tests.mjs integration $testProject --docker
node scripts/check-local-backend-concurrency.mjs $testDriver --allow-local-writes
```

Kör dessa sekventiellt. Teststacken måste redan vara igång. `--docker` återställer inte CLI-konfigurationen och startar inte nya containrar.

## Återstående gränser

Detta verifierar lokal databas/API och de specificerade konkurrensfallen. Det är inte ett produktionsgodkännande, en verklig börsavstämning, full belastningsprovning eller visuell frontendkontroll. Nästa produktarbete behöver utgå från aktuell kod och återstående krav i reconciliation-/execution-dokumenten. Ändringarna i denna etapp är lokala och inte committade eller publicerade.
