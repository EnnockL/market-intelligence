import type { NormalizedWalletTransaction } from "./provider";

type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { uiAmount: number | null } };
type ParsedTransaction = {
  slot: number; blockTime: number | null;
  transaction: { signatures: string[]; message: { accountKeys: Array<string | { pubkey: string }> } };
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
};

export function normalizeSolanaTransaction(raw: ParsedTransaction, walletAddress: string, receivedAt = new Date().toISOString()): NormalizedWalletTransaction[] {
  if (!raw.meta || raw.meta.err || !raw.blockTime) return [];
  const signature = raw.transaction.signatures[0];
  if (!signature) return [];
  const keys = raw.transaction.message.accountKeys.map((key) => typeof key === "string" ? key : key.pubkey);
  const walletIndex = keys.indexOf(walletAddress);
  const nativeDelta = walletIndex >= 0 ? (raw.meta.postBalances[walletIndex] - raw.meta.preBalances[walletIndex] + raw.meta.fee) / 1e9 : 0;
  const pre = balancesForOwner(raw.meta.preTokenBalances ?? [], walletAddress);
  const post = balancesForOwner(raw.meta.postTokenBalances ?? [], walletAddress);
  const mints = new Set([...pre.keys(), ...post.keys()]);
  const changes = [...mints].map((mint) => ({ mint, delta: (post.get(mint) ?? 0) - (pre.get(mint) ?? 0) })).filter((item) => Math.abs(item.delta) > 1e-12);
  if (changes.length === 0) return [{ walletAddress, signature, instructionIndex: 0, mintAddress: null, side: "transfer", quantity: null, nativeValueSol: nativeDelta, slot: raw.slot, occurredAt: new Date(raw.blockTime * 1000).toISOString(), receivedAt, rawPayload: raw }];
  return changes.map((change, index) => ({
    walletAddress, signature, instructionIndex: index, mintAddress: change.mint,
    side: change.delta > 0 && nativeDelta < 0 ? "buy" : change.delta < 0 && nativeDelta > 0 ? "sell" : "transfer",
    quantity: Math.abs(change.delta), nativeValueSol: Math.abs(nativeDelta), slot: raw.slot,
    occurredAt: new Date(raw.blockTime! * 1000).toISOString(), receivedAt, rawPayload: raw,
  }));
}

function balancesForOwner(balances: TokenBalance[], owner: string) {
  const result = new Map<string, number>();
  for (const balance of balances) if (balance.owner === owner) result.set(balance.mint, (result.get(balance.mint) ?? 0) + (balance.uiTokenAmount.uiAmount ?? 0));
  return result;
}

export function deduplicateTransactions<T extends { signature: string; instructionIndex: number; walletAddress: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [`${item.walletAddress}:${item.signature}:${item.instructionIndex}`, item])).values()];
}
