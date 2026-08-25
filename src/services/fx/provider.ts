export interface FxObservation {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  effectiveAt: string;
  observedAt: string;
  availableAt: string;
  provider: string;
  sourceReference: string;
  dataQuality: number;
}
export interface HistoricalFxProvider {
  readonly name: string;
  fetchRange(start: string, end: string): Promise<FxObservation[]>;
}
export type FxLookupResult =
  | { status: "FOUND"; observation: FxObservation }
  | { status: "UNKNOWN"; observation: null; reason: string };
export const FX_CONVERSION_POLICY_V1 = "point-in-time-fx-v1";
