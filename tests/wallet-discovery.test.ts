import { describe, expect, it } from "vitest";
import { extractSignerCandidates, scoreDiscoveryCandidate } from "../src/services/blockchain/wallet-discovery";

const seed = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const candidate = "At7Nk99Ez4ajLikcUNtMwXHgmHiZ6mQRRuwFwVdz7ZHb";

describe("wallet discovery", () => {
  it("extracts unique signers and excludes configured seeds", () => {
    const result = extractSignerCandidates({ transaction: { message: { accountKeys: [
      { pubkey: seed, signer: true }, { pubkey: candidate, signer: true },
      { pubkey: candidate, signer: true }, { pubkey: "11111111111111111111111111111111", signer: false },
    ] } } }, new Set([seed]));
    expect(result).toEqual([candidate]);
  });

  it("keeps discovery scores capped below verified smart-money status", () => {
    const result = scoreDiscoveryCandidate({ address: candidate, observedTransactions: 20, successfulTransactions: 20, activeDays: 30, sourceAddresses: [seed] });
    expect(result.score).toBeLessThanOrEqual(75);
    expect(result.riskFlags).toContain("profitability_unverified");
    expect(result.dataQuality).toBe(100);
  });

  it("flags very small and new samples", () => {
    const result = scoreDiscoveryCandidate({ address: candidate, observedTransactions: 3, successfulTransactions: 3, activeDays: 0.01, sourceAddresses: [seed] });
    expect(result.riskFlags).toEqual(expect.arrayContaining(["small_sample", "very_new_or_high_frequency"]));
  });
});
