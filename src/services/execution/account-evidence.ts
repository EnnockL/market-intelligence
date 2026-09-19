/** Read-only provider evidence. A complete page walk is not a historical baseline. */
export interface DemoAccountEvidence {
  executionMarket?: import("@/domain/demo-market-proposal").DemoExecutionMarket;
  version: "demo-account-evidence-v1";
  externalAccountId: string;
  instrumentId: string;
  baseCurrency: string;
  quoteCurrency: string;
  startedAt: string;
  observedAt: string;
  balances: Array<{ currency: string; total: number; available: number }>;
  orders: Array<{ id: string; instrumentId: string; side: "BUY" | "SELL"; quantity: number; filled: number; price: number; updatedAt: string }>;
  bills: Array<{ id: string; currency: string; change: number; balance: number; type: string; orderId: string; occurredAt: string }>;
  mark: { price: number; observedAt: string };
  /** Exact market bids for additional holdings; fiat uses separately evidenced FX. */
  holdingMarks?: Array<{ currency: string; instrumentId: string; quoteCurrency: string; price: number; observedAt: string }>;
  feeRate: number;
  windowStart: string;
  complete: true;
}

export interface DemoAccountBaseline {
  version: "demo-account-baseline-v1";
  externalAccountId: string;
  instrumentId: string;
  baseCurrency: string;
  quoteCurrency: string;
  cash: number;
  at: string;
  evidenceHash: string;
  /** Observed quantities, not inferred acquisition history. */
  openingBalances?: DemoAccountEvidence["balances"];
  openingMarks?: DemoAccountEvidence["holdingMarks"];
  openingMark?: DemoAccountEvidence["mark"];
  valuationPolicy?: "OBSERVED_BASELINE_NOT_HISTORICAL_COST";
}
