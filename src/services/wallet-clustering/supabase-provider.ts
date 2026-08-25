import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceClassification, WalletRelationshipFeature } from "@/domain/wallet-clustering";
import type { WalletRelationshipDataProvider } from "./provider";

type AccountKey = string | { pubkey?: string; signer?: boolean; writable?: boolean };
type RawTransaction = {
  transaction?: { message?: { accountKeys?: AccountKey[] } };
  meta?: { preBalances?: number[]; postBalances?: number[] };
};
type WalletRow = { id: string; address: string; first_seen_at: string | null; metadata: { backfill_complete?: boolean } | null };

const KNOWN_SOLANA_INFRASTRUCTURE = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "SysvarC1ock11111111111111111111111111111111",
  "Sysvar1nstructions1111111111111111111111111",
  "So11111111111111111111111111111111111111112",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
]);

export class SupabaseWalletRelationshipProvider implements WalletRelationshipDataProvider {
  readonly name = "supabase-solana-history-v2";
  constructor(private readonly db: SupabaseClient) {}

  async loadFeatures(cutoff: string, limit: number) {
    const { data: walletData, error } = await this.db.from("wallets").select("id,address,first_seen_at,metadata").eq("chain", "solana").eq("is_tracked", true).order("created_at").limit(limit);
    if (error) throw error;
    const wallets = (walletData ?? []) as WalletRow[];
    if (!wallets.length) return [];
    const ids = wallets.map((wallet) => wallet.id);
    const [{ data: tx, error: txError }, { data: verification, error: verificationError }, { data: labels, error: labelError }] = await Promise.all([
      this.db.from("wallet_transactions").select("wallet_id,asset_id,side,occurred_at,ingested_at,raw_payload").in("wallet_id", ids).lte("ingested_at", cutoff).order("occurred_at").limit(Math.max(1000, limit * 500)),
      this.db.from("wallet_verification_evaluations").select("wallet_id,evaluated_at,evidence").in("wallet_id", ids).lte("evaluated_at", cutoff).order("evaluated_at", { ascending: false }),
      this.db.from("solana_address_classification_observations").select("address,classification,confidence,available_at").lte("available_at", cutoff).order("available_at", { ascending: false }),
    ]);
    if (txError) throw txError;
    if (verificationError) throw verificationError;
    if (labelError) throw labelError;

    const labelMap = new Map<string, SourceClassification>();
    for (const address of KNOWN_SOLANA_INFRASTRUCTURE) labelMap.set(address, "program");
    for (const row of labels ?? []) if (!labelMap.has(row.address) && Number(row.confidence) >= 80) labelMap.set(row.address, row.classification);
    const latestVerification = new Map<string, { evidence?: { dataQualityV3?: number } }>();
    for (const row of verification ?? []) if (!latestVerification.has(row.wallet_id)) latestVerification.set(row.wallet_id, row);

    return wallets.map((wallet) => {
      const rows = (tx ?? []).filter((row) => row.wallet_id === wallet.id);
      const check = latestVerification.get(wallet.id);
      const funding = findFunding(rows, wallet.address, labelMap);
      const counterparties = extractWalletCounterparties(rows.map((row) => row.raw_payload as RawTransaction), wallet.address, labelMap);
      const trades: Record<string, string[]> = {};
      for (const row of rows) if (row.asset_id && ["buy", "sell"].includes(row.side)) (trades[row.asset_id] ??= []).push(row.occurred_at);
      return {
        walletId: wallet.id,
        dataQuality: Number(check?.evidence?.dataQualityV3 ?? 0),
        // Backfill completeness is an ingestion fact. Verification is an output and
        // must not be a prerequisite for measuring wallet independence.
        historyComplete: wallet.metadata?.backfill_complete === true,
        // Database discovery time is not wallet creation time. Only a completed
        // backfill can establish the earliest transaction as a creation proxy.
        firstSeenAt: wallet.metadata?.backfill_complete === true ? rows[0]?.occurred_at ?? null : null,
        firstFundingAt: funding?.occurredAt ?? null,
        funderAddress: funding?.address ?? null,
        fundingSourceClassification: funding ? labelMap.get(funding.address) ?? "unknown" : "unknown",
        counterparties,
        tradeTimesByAsset: trades,
      } satisfies WalletRelationshipFeature;
    });
  }
}

function accountEntries(raw: RawTransaction) {
  return (raw?.transaction?.message?.accountKeys ?? []).flatMap((key) => {
    if (typeof key === "string") return [{ address: key, signer: null }];
    return key.pubkey ? [{ address: key.pubkey, signer: key.signer ?? null }] : [];
  });
}

export function extractWalletCounterparties(rawTransactions: RawTransaction[], walletAddress: string, labels = new Map<string, SourceClassification>()) {
  const result = new Set<string>();
  for (const raw of rawTransactions) {
    const entries = accountEntries(raw);
    const hasSignerMetadata = entries.some((entry) => entry.signer !== null);
    // Without signer metadata we cannot distinguish wallets from programs, PDAs
    // and token accounts. UNKNOWN is safer than a fabricated relationship.
    if (!hasSignerMetadata) continue;
    for (const entry of entries) {
      if (entry.address === walletAddress || isService(entry.address, labels)) continue;
      if (entry.signer !== true) continue;
      result.add(entry.address);
    }
  }
  return [...result].sort();
}

function findFunding(rows: Array<{ occurred_at: string; raw_payload: unknown }>, walletAddress: string, labels: Map<string, SourceClassification>) {
  for (const row of rows) {
    const raw = row.raw_payload as RawTransaction;
    const entries = accountEntries(raw);
    const keys = entries.map((entry) => entry.address);
    const walletIndex = keys.indexOf(walletAddress);
    const pre = raw?.meta?.preBalances ?? [];
    const post = raw?.meta?.postBalances ?? [];
    if (walletIndex < 0 || (post[walletIndex] ?? 0) - (pre[walletIndex] ?? 0) <= 0) continue;
    let source: string | null = null;
    let largestNegativeDelta = 0;
    for (let index = 0; index < keys.length; index += 1) {
      const delta = (post[index] ?? 0) - (pre[index] ?? 0);
      if (delta < largestNegativeDelta && keys[index] !== walletAddress && !isProgramInfrastructure(keys[index], labels)) {
        largestNegativeDelta = delta;
        source = keys[index];
      }
    }
    if (source) return { address: source, occurredAt: row.occurred_at };
  }
  return null;
}

function isProgramInfrastructure(address: string, labels: Map<string, SourceClassification>) {
  return KNOWN_SOLANA_INFRASTRUCTURE.has(address) || labels.get(address) === "program";
}
function isService(address: string, labels: Map<string, SourceClassification>) {
  return KNOWN_SOLANA_INFRASTRUCTURE.has(address) || ["program", "exchange", "bridge"].includes(labels.get(address) ?? "");
}
