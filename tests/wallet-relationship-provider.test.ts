import { describe, expect, it } from "vitest";
import { extractWalletCounterparties } from "@/services/wallet-clustering/supabase-provider";

describe("wallet relationship feature extraction", () => {
  it("excludes Solana infrastructure and non-signer accounts", () => {
    const counterparties = extractWalletCounterparties([{ transaction: { message: { accountKeys: [
      { pubkey: "tracked", signer: true },
      { pubkey: "other-wallet", signer: true },
      { pubkey: "token-account", signer: false },
      { pubkey: "11111111111111111111111111111111", signer: false },
      { pubkey: "ComputeBudget111111111111111111111111111111", signer: false },
    ] } } }], "tracked");
    expect(counterparties).toEqual(["other-wallet"]);
  });

  it("returns no counterparties when signer metadata is unavailable", () => {
    const counterparties = extractWalletCounterparties([{ transaction: { message: { accountKeys: [
      "tracked", "other-wallet", "11111111111111111111111111111111",
    ] } } }], "tracked");
    expect(counterparties).toEqual([]);
  });
});
