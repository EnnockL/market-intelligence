import type { WalletDiscoveryCandidate } from "./provider";

type AccountKey = string | { pubkey: string; signer?: boolean };
type DiscoveryTransaction = {
  blockTime?: number | null;
  transaction?: { message?: { accountKeys?: AccountKey[] } };
};

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function extractSignerCandidates(raw: DiscoveryTransaction, excluded: Set<string>): string[] {
  const keys = raw.transaction?.message?.accountKeys ?? [];
  return [...new Set(keys.flatMap((key, index) => {
    const address = typeof key === "string" ? key : key.pubkey;
    const signer = typeof key === "string" ? index === 0 : Boolean(key.signer);
    return signer && BASE58_ADDRESS.test(address) && !excluded.has(address) ? [address] : [];
  }))];
}

export function scoreDiscoveryCandidate(input: {
  address: string; observedTransactions: number; successfulTransactions: number;
  activeDays: number; sourceAddresses: string[]; observedAt?: string;
}): WalletDiscoveryCandidate {
  const sample = Math.min(input.observedTransactions, 20);
  const successRate = sample > 0 ? input.successfulTransactions / sample : 0;
  const dataQuality = Math.round(Math.min(100, sample * 4 + Math.min(input.activeDays, 20)));
  const activityScore = Math.min(25, sample * 1.25);
  const longevityScore = Math.min(20, input.activeDays * 2);
  const successScore = successRate * 20;
  const sourceScore = Math.min(10, input.sourceAddresses.length * 5);
  const score = Math.round(Math.min(75, activityScore + longevityScore + successScore + sourceScore));
  const reasons = [
    `${sample} recent transactions sampled`,
    `${Math.round(successRate * 100)}% successful in sample`,
    `activity spans ${input.activeDays.toFixed(1)} days`,
  ];
  const riskFlags = [
    ...(sample < 10 ? ["small_sample"] : []),
    ...(input.activeDays < 1 ? ["very_new_or_high_frequency"] : []),
    ...(input.sourceAddresses.length === 1 ? ["single_discovery_source"] : []),
    "profitability_unverified",
  ];
  return { ...input, score, dataQuality, reasons, riskFlags, observedAt: input.observedAt ?? new Date().toISOString() };
}
