import { describe, expect, it } from "vitest";
import { deduplicateTransactions, normalizeSolanaTransaction } from "../src/services/blockchain/normalize-solana-transaction";

const wallet = "Wallet111";
function transaction(preToken: number, postToken: number, preSol: number, postSol: number) {
  return { slot: 123, blockTime: 1786903200, transaction: { signatures: ["sig-1"], message: { accountKeys: [wallet] } }, meta: { err: null, fee: 5000, preBalances: [preSol], postBalances: [postSol], preTokenBalances: [{ accountIndex: 1, mint: "Mint111", owner: wallet, uiTokenAmount: { uiAmount: preToken } }], postTokenBalances: [{ accountIndex: 1, mint: "Mint111", owner: wallet, uiTokenAmount: { uiAmount: postToken } }] } };
}

describe("Solana transaction normalization", () => {
  it("identifies a token buy from positive token and negative SOL deltas", () => {
    const [result] = normalizeSolanaTransaction(transaction(0, 100, 2_000_000_000, 1_499_995_000), wallet, "2026-08-16T18:00:01.000Z");
    expect(result).toMatchObject({ signature: "sig-1", mintAddress: "Mint111", side: "buy", quantity: 100, nativeValueSol: 0.5 });
  });

  it("identifies a token sell from negative token and positive SOL deltas", () => {
    const [result] = normalizeSolanaTransaction(transaction(100, 25, 1_000_000_000, 1_399_995_000), wallet);
    expect(result).toMatchObject({ side: "sell", quantity: 75, nativeValueSol: 0.4 });
  });

  it("deduplicates by wallet, signature, and instruction index", () => {
    const item = normalizeSolanaTransaction(transaction(0, 100, 2_000_000_000, 1_499_995_000), wallet)[0];
    expect(deduplicateTransactions([item, item])).toHaveLength(1);
  });
});

