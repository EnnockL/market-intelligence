import type { FxObservation, HistoricalFxProvider } from "./provider";
export class EcbHistoricalFxProvider implements HistoricalFxProvider {
  readonly name = "ecb-reference-rates-v1";
  constructor(private fetcher: typeof fetch = fetch) {}
  async fetchRange(start: string, end: string) {
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.USD+SEK.EUR.SP00.A?startPeriod=${start}&endPeriod=${end}&format=csvdata&detail=dataonly`,
      response = await this.fetcher(url, { headers: { Accept: "text/csv" } });
    if (response.status === 429) throw new Error("ECB_RATE_LIMITED");
    if (!response.ok) throw new Error(`ECB_HTTP_${response.status}`);
    return normalizeEcbCsv(await response.text(), this.name);
  }
}
export function normalizeEcbCsv(
  csv: string,
  provider = "ecb-reference-rates-v1",
): FxObservation[] {
  const lines = csv.trim().split(/\r?\n/),
    headers = split(lines.shift() ?? "");
  const rows = lines.map((line) =>
      Object.fromEntries(headers.map((h, i) => [h, split(line)[i]])),
    ),
    byDate = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const date = row.TIME_PERIOD,
      currency = row.CURRENCY,
      value = Number(row.OBS_VALUE);
    if (!date || !currency || !Number.isFinite(value)) continue;
    const item = byDate.get(date) ?? {};
    item[currency] = value;
    byDate.set(date, item);
  }
  const out: FxObservation[] = [];
  for (const [date, rates] of byDate) {
    if (!(rates.USD > 0 && rates.SEK > 0)) continue;
    const effectiveAt = `${date}T15:00:00.000Z`,
      availableAt = `${date}T16:00:00.000Z`;
    out.push({
      baseCurrency: "USD",
      quoteCurrency: "SEK",
      rate: rates.SEK / rates.USD,
      effectiveAt,
      observedAt: effectiveAt,
      availableAt,
      provider,
      sourceReference: `EXR:D.USD+SEK.EUR.SP00.A:${date}`,
      dataQuality: 95,
    });
  }
  return out.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
}
function split(line: string) {
  return line.split(",").map((x) => x.replace(/^"|"$/g, "").trim());
}
