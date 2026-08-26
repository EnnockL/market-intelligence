# Strategy Validation Protocol v1

En strategi godkänns inte för att ett backtest ser bra ut. Den måste passera en låst, versionshanterad kedja:

`LEARNING → FROZEN → OUT_OF_SAMPLE → DEMO_VALIDATION → APPROVED_SHADOW`

- Hypotes, ekonomisk mekanism och invalideringsvillkor registreras innan freeze.
- Ändringar under freeze loggas men implementeras först i nästa learning window.
- Resultat rapporteras efter kostnader som optimistic demo, modeled live och stress.
- Varje grind är `PASS`, `FAIL` eller `UNKNOWN`; ingen totalscore kan dölja ett kritiskt fel.
- Minsta sample är en golvnivå, inte ett mål som får tvinga fram trades. Positivt konfidensintervall, oberoende perioder och regimtäckning krävs också.
- Robusthet mäts utan bästa trade, per asset-koncentration, drawdown och stressad expectancy.
- Historiska runs, hypoteser, protokoll och beslut är immutable och point-in-time.

`INSUFFICIENT_DATA` är ett korrekt slutresultat. Livehandel aktiveras inte av protokollet.

## Operativt kontrollplan

`/strategy-validation` kan registrera en fryst hypotes och validera en eller flera historiska evaluation-runs för samma strategiversion. Flera assets aggregeras i samma immutable run så att asset-koncentration faktiskt kan prövas.

- Hypotes och evaluation-runs måste tillhöra samma strategi.
- Faser får inte hoppas över och föregående fas måste vara godkänd för samma hypotes.
- Ett senare valideringsfönster får inte överlappa föregående fas.
- Candle-kvalitet mäts point-in-time; saknade kvalitetsobservationer blir `UNKNOWN`.
- Modeled-live- och stresskostnader ingår i datasetets idempotency-hash.
- Varje validering skapar en säker runtime-bedömning i `RESEARCH`; ofullständig runtime-evidens ger `NO_TRADE`.
