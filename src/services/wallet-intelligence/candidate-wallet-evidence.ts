import type { SupabaseClient } from "@supabase/supabase-js";

export interface CandidateWalletEvidenceRef {
  id: string;
  type: string;
  availableAt: string;
  source: string;
  dataQuality: number | null;
}

export interface CandidateWalletMetrics {
  rawWalletCount: number | null;
  verifiedWalletCount: number | null;
  confirmedIndependent: number | null;
  relationshipCoverage: number | null;
  clusterAdjustedCount: number | null;
  convergenceWindowMs: number | null;
  dataQuality: number | null;
  evidence: CandidateWalletEvidenceRef[];
}

type Membership = {
  wallet_id: string;
  cluster_id: string | null;
  relationship_status: "independent" | "clustered" | "unknown";
  cluster_confidence: number | null;
};

export function deriveCandidateIndependence(
  memberships: Membership[],
  snapshot: { status: string; relationship_coverage: unknown; data_quality: unknown } | null,
) {
  if (!snapshot || snapshot.status !== "available" || memberships.some((row) => row.relationship_status === "unknown")) {
    return {
      confirmedIndependent: null,
      relationshipCoverage: snapshot ? number(snapshot.relationship_coverage) : null,
      clusterAdjustedCount: null,
      dataQuality: snapshot ? number(snapshot.data_quality) : null,
    };
  }
  const groups = new Map<string, Membership[]>();
  for (const row of memberships) {
    const key = row.cluster_id ?? `wallet:${row.wallet_id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const adjusted = [...groups.values()].reduce((sum, group) => {
    if (group.length === 1) return sum + 1;
    const confidence = Math.max(...group.map((row) => Number(row.cluster_confidence ?? 0))) / 100;
    return sum + 1 + (group.length - 1) * (1 - confidence);
  }, 0);
  return {
    confirmedIndependent: groups.size,
    relationshipCoverage: number(snapshot.relationship_coverage),
    clusterAdjustedCount: Math.round(adjusted * 100) / 100,
    dataQuality: number(snapshot.data_quality),
  };
}

export async function loadCandidateWalletMetrics(
  db: SupabaseClient,
  assetId: string,
  windowStart: string,
  cutoff: string,
  windowMs = 3_600_000,
): Promise<CandidateWalletMetrics> {
  const windowEnd = new Date(Date.parse(windowStart) + windowMs).toISOString();
  const { data: events, error: eventError } = await db
    .from("event_outbox")
    .select("event_id,wallet_id,occurred_at,available_at,provider,data_quality")
    .eq("event_type", "wallet.buy_detected")
    .eq("asset_id", assetId)
    .gte("occurred_at", windowStart)
    .lt("occurred_at", windowEnd)
    .lte("available_at", cutoff)
    .order("occurred_at");
  if (eventError) throw eventError;
  const walletIds = [...new Set((events ?? []).map((row) => row.wallet_id).filter((id): id is string => Boolean(id)))];
  const evidence: CandidateWalletEvidenceRef[] = (events ?? []).map((row) => ({
    id: row.event_id,
    type: "wallet_buy_event",
    availableAt: row.available_at,
    source: row.provider,
    dataQuality: number(row.data_quality),
  }));
  if (!walletIds.length) return unknown(evidence);

  const occurred = (events ?? []).map((row) => Date.parse(row.occurred_at)).filter(Number.isFinite);
  const convergenceWindowMs = occurred.length > 1 ? Math.max(...occurred) - Math.min(...occurred) : 0;
  const { data: checks, error: checkError } = await db
    .from("wallet_verification_evaluations")
    .select("id,wallet_id,eligible_status,evaluated_at,data_snapshot_cutoff")
    .in("wallet_id", walletIds)
    .lte("evaluated_at", cutoff)
    .lte("data_snapshot_cutoff", cutoff)
    .order("evaluated_at", { ascending: false });
  if (checkError) throw checkError;
  const latest = new Map<string, (typeof checks extends (infer T)[] | null ? T : never)>();
  for (const row of checks ?? []) if (!latest.has(row.wallet_id)) latest.set(row.wallet_id, row);
  const verifiedWalletCount = latest.size === walletIds.length
    ? [...latest.values()].filter((row) => row.eligible_status === "verified").length
    : null;
  for (const row of latest.values()) evidence.push({ id: row.id, type: "wallet_verification", availableAt: row.evaluated_at, source: "wallet-verification-policy-v1", dataQuality: null });

  const { data: snapshots, error: snapshotError } = await db
    .from("wallet_cluster_snapshots")
    .select("id,status,relationship_coverage,data_quality,model_version,information_cutoff_at,available_at")
    .lte("information_cutoff_at", cutoff)
    .lte("available_at", cutoff)
    .order("information_cutoff_at", { ascending: false })
    .limit(50);
  if (snapshotError) throw snapshotError;
  if (!snapshots?.length) return { rawWalletCount: walletIds.length, verifiedWalletCount, confirmedIndependent: null, relationshipCoverage: null, clusterAdjustedCount: null, convergenceWindowMs, dataQuality: averageQuality(events ?? []), evidence };
  const snapshotIds = snapshots.map((row) => row.id);
  const { data: memberships, error: membershipError } = await db
    .from("wallet_cluster_memberships")
    .select("snapshot_id,wallet_id,cluster_id,relationship_status,cluster_confidence,evidence_refs")
    .in("snapshot_id", snapshotIds)
    .in("wallet_id", walletIds);
  if (membershipError) throw membershipError;
  const snapshot = snapshots.find((row) => new Set((memberships ?? []).filter((item) => item.snapshot_id === row.id).map((item) => item.wallet_id)).size === walletIds.length) ?? null;
  if (!snapshot) return { rawWalletCount: walletIds.length, verifiedWalletCount, confirmedIndependent: null, relationshipCoverage: null, clusterAdjustedCount: null, convergenceWindowMs, dataQuality: averageQuality(events ?? []), evidence };
  const selected = (memberships ?? []).filter((row) => row.snapshot_id === snapshot.id) as Membership[];
  evidence.push({ id: snapshot.id, type: "wallet_cluster_snapshot", availableAt: snapshot.available_at, source: snapshot.model_version, dataQuality: number(snapshot.data_quality) });
  const derived = deriveCandidateIndependence(selected, snapshot);
  return { rawWalletCount: walletIds.length, verifiedWalletCount, ...derived, convergenceWindowMs, evidence };
}

function unknown(evidence: CandidateWalletEvidenceRef[]): CandidateWalletMetrics {
  return { rawWalletCount: null, verifiedWalletCount: null, confirmedIndependent: null, relationshipCoverage: null, clusterAdjustedCount: null, convergenceWindowMs: null, dataQuality: null, evidence };
}
function averageQuality(rows: Array<{ data_quality: unknown }>) { const values = rows.map((row) => number(row.data_quality)).filter((value): value is number => value !== null); return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null; }
function number(value: unknown) { const parsed = Number(value); return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed; }
