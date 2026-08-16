import { createServiceClient } from "../lib/supabase/server";
import type { DataMode } from "./dashboard-data";

export interface DashboardWalletCandidate {
  address: string; status: "candidate" | "reviewing" | "verified" | "rejected";
  score: number; dataQuality: number; observedTransactions: number;
  successfulTransactions: number; activeDays: number; riskFlags: string[]; reasons: string[];
  lastObservedAt: string;
}
export interface DashboardWalletDiscoveryData {
  mode: DataMode; updatedAt: string | null; candidates: DashboardWalletCandidate[]; message: string;
}
type CandidateRow = {
  address: string; status: DashboardWalletCandidate["status"]; score: number; data_quality: number;
  observed_transactions: number; successful_transactions: number; active_days: number | string;
  risk_flags: unknown; reasons: unknown; last_observed_at: string;
};

export function mapWalletCandidate(row: CandidateRow): DashboardWalletCandidate {
  return {
    address: row.address, status: row.status, score: Number(row.score), dataQuality: Number(row.data_quality),
    observedTransactions: Number(row.observed_transactions), successfulTransactions: Number(row.successful_transactions),
    activeDays: Number(row.active_days), riskFlags: stringArray(row.risk_flags), reasons: stringArray(row.reasons),
    lastObservedAt: row.last_observed_at,
  };
}

export async function getWalletDiscoveryData(): Promise<DashboardWalletDiscoveryData> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return unavailable("Wallet discovery is not configured");
  try {
    const { data, error } = await createServiceClient().from("wallet_discovery_candidates")
      .select("address,status,score,data_quality,observed_transactions,successful_transactions,active_days,risk_flags,reasons,last_observed_at")
      .neq("status", "rejected").order("score", { ascending: false }).order("data_quality", { ascending: false }).limit(8);
    if (error) throw error;
    const candidates = (data ?? []).map((row) => mapWalletCandidate(row as CandidateRow));
    if (!candidates.length) return { mode: "live", updatedAt: null, candidates: [], message: "Discovery is live; no candidates found yet" };
    const updatedAt = candidates.map((item) => item.lastObservedAt).sort().at(-1) ?? null;
    return { mode: "live", updatedAt, candidates, message: `${candidates.length} unverified candidates from Solana RPC` };
  } catch (error) {
    return unavailable(`Wallet discovery unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function unavailable(message: string): DashboardWalletDiscoveryData { return { mode: "degraded", updatedAt: null, candidates: [], message }; }
