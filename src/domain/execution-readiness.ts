export function entryRiskSummary(input: {
  status?: string; openPositions?: number | null; exposureSek?: number | null;
  maxPositions?: number | null; maxExposureSek?: number | null;
}) {
  const values = [input.openPositions, input.exposureSek, input.maxPositions, input.maxExposureSek];
  if (input.status !== "KNOWN" || values.some(value => typeof value !== "number" || !Number.isFinite(value))) {
    return "Riskunderlaget är ofullständigt. Nya köp kan inte bedömas.";
  }
  if (input.openPositions! >= input.maxPositions! || input.exposureSek! >= input.maxExposureSek!) {
    return "Befintliga innehav når eller överskrider köpgränserna. Nya köp är spärrade. Försäljning av tillgängliga innehav kräver fortfarande godkänd signal och orderkontroll.";
  }
  return "Nuvarande innehav ligger under köpgränserna. Varje ny order måste även rymmas inom gränserna och klara övriga kontroller.";
}

export function prospectiveWindowSummary(endsAt: string | null, now = Date.now()) {
  if (!endsAt || !Number.isFinite(Date.parse(endsAt))) return "Ingen registrerad testperiod hittades för strategin.";
  const date = new Date(endsAt).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" });
  return Date.parse(endsAt) > now
    ? `Framåttestet samlar data till ${date} (Stockholm). Testperioden innebär inget handelsgodkännande.`
    : "Testperioden har avslutats. Resultat och strategins godkännande måste bedömas separat.";
}
