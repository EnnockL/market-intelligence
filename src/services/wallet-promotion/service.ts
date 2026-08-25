import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateWalletPromotion,
  WALLET_PROMOTION_POLICY,
} from "@/domain/wallet-promotion";

export class WalletPromotionService {
  constructor(private db: SupabaseClient) {}

  async run(cutoffAt = new Date().toISOString(), limit = 100) {
    const candidatesResult = await this.db
      .from("wallet_discovery_candidates")
      .select("*")
      .lte("last_observed_at", cutoffAt)
      .order("last_observed_at")
      .limit(limit);
    if (candidatesResult.error) throw candidatesResult.error;
    const candidates = candidatesResult.data ?? [];
    const addresses = candidates.map((candidate: any) => candidate.address);
    const walletsResult = addresses.length
      ? await this.db
          .from("wallets")
          .select("id,address")
          .eq("chain", "solana")
          .in("address", addresses)
      : { data: [], error: null };
    if (walletsResult.error) throw walletsResult.error;
    const walletByAddress = new Map(
      (walletsResult.data ?? []).map((wallet: any) => [wallet.address, wallet]),
    );
    const walletIds = (walletsResult.data ?? []).map(
      (wallet: any) => wallet.id,
    );
    const verificationResult = walletIds.length
      ? await this.db
          .from("wallet_verification_evaluations")
          .select("id,wallet_id,eligible_status,evaluated_at")
          .in("wallet_id", walletIds)
          .lte("evaluated_at", cutoffAt)
          .order("evaluated_at", { ascending: false })
      : { data: [], error: null };
    if (verificationResult.error) throw verificationResult.error;
    const latestVerification = new Map<string, any>();
    for (const evaluation of verificationResult.data ?? [])
      if (!latestVerification.has(evaluation.wallet_id))
        latestVerification.set(evaluation.wallet_id, evaluation);

    const counts = {
      candidate: 0,
      tracked: 0,
      reviewing: 0,
      verified: 0,
      rejected: 0,
    };
    let evaluationsCreated = 0;
    for (const candidate of candidates as any[]) {
      let wallet = walletByAddress.get(candidate.address) as any;
      const verification = wallet ? latestVerification.get(wallet.id) : null;
      const result = evaluateWalletPromotion({
        candidateId: candidate.id,
        currentState: candidate.status,
        score: candidate.score,
        dataQuality: candidate.data_quality,
        observedTransactions: candidate.observed_transactions,
        successfulTransactions: candidate.successful_transactions,
        activeDays: Number(candidate.active_days),
        riskFlags: stringArray(candidate.risk_flags),
        walletId: wallet?.id ?? null,
        verificationStatus: verification?.eligible_status ?? null,
        verificationEvaluationId: verification?.id ?? null,
      });
      if (result.shouldCreateWallet) {
        const saved = await this.db
          .from("wallets")
          .upsert(
            {
              chain: "solana",
              address: candidate.address,
              label: "discovered candidate",
              is_tracked: true,
              first_seen_at: candidate.first_observed_at,
            },
            { onConflict: "chain,address", ignoreDuplicates: false },
          )
          .select("id,address")
          .single();
        if (saved.error) throw saved.error;
        wallet = saved.data;
        walletByAddress.set(candidate.address, wallet);
      }
      const evaluation = await this.db
        .from("wallet_promotion_evaluations")
        .upsert(
          {
            input_hash: result.inputHash,
            candidate_id: candidate.id,
            wallet_id: wallet?.id ?? null,
            verification_evaluation_id: verification?.id ?? null,
            policy_version: WALLET_PROMOTION_POLICY.version,
            previous_state: candidate.status,
            decided_state: result.state,
            requirements: result.requirements,
            blockers: result.blockers,
            information_cutoff_at: cutoffAt,
            available_at: cutoffAt,
          },
          { onConflict: "input_hash", ignoreDuplicates: true },
        );
      if (evaluation.error) throw evaluation.error;
      if (!evaluation.error) evaluationsCreated++;
      const update = await this.db
        .from("wallet_discovery_candidates")
        .update({
          status: result.state,
          reviewed_at: cutoffAt,
          updated_at: cutoffAt,
        })
        .eq("id", candidate.id);
      if (update.error) throw update.error;
      counts[result.state]++;
    }
    return {
      evaluated: candidates.length,
      evaluationsCreated,
      ...counts,
      policyVersion: WALLET_PROMOTION_POLICY.version,
    };
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
