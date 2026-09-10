import type { SupabaseClient } from "@supabase/supabase-js";
import { buildGapClosure, DATA_GAP_CLOSURE_VERSION, type GapEvidence } from "@/domain/data-gap-closure";
import { riskCoveragePercent } from "@/domain/risk-coverage";
import type { HistoricalLiquidityProvider } from "@/services/liquidity/provider";
import type { TokenRiskProvider } from "@/services/token-risk/provider";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { loadCandidateWalletMetrics } from "@/services/wallet-intelligence/candidate-wallet-evidence";

const RETRY_DELAY_MS = 5 * 60_000;
type Claim = { candidate_id: string; claim_token: string };

export class DataGapClosureService {
  constructor(
    private db: SupabaseClient,
    private liquidity: HistoricalLiquidityProvider,
    private risk: TokenRiskProvider,
    private repo: IngestionRepository,
  ) {}

  async run(limit = 4, cutoff = new Date().toISOString()) {
    if (!Number.isFinite(Date.parse(cutoff))) throw new Error("INVALID_DATA_GAP_CUTOFF");
    const maximumCandidates = Math.max(1, Math.min(20, Math.floor(limit) || 4));
    const { data, error } = await this.db.rpc("claim_candidate_data_gaps", { batch_limit: maximumCandidates, input_cutoff: cutoff });
    if (error) throw error;
    const summaries = [];
    for (const claim of (data ?? []) as Claim[]) {
      try {
        summaries.push(await this.closeCandidate(claim, cutoff));
      } catch (failure) {
        const errors = [message(failure)];
        const { error: releaseError } = await this.db.rpc("release_candidate_data_gap", {
          target_candidate: claim.candidate_id, target_claim: claim.claim_token,
          retry_at: new Date(Date.parse(cutoff) + RETRY_DELAY_MS).toISOString(), failure_errors: errors,
        });
        if (releaseError) throw releaseError;
        summaries.push({ candidateId: claim.candidate_id, created: false, status: "FAILED", gaps: {}, errors });
      }
    }
    return {
      candidates: summaries.length, created: summaries.filter((result) => result.created).length,
      waitingEvidence: summaries.filter((result) => result.status === "WAITING_EVIDENCE").length,
      failed: summaries.filter((result) => result.status === "FAILED").length,
      bounded: true, maximumCandidates, summaries,
    };
  }

  private async closeCandidate(claim: Claim, cutoff: string) {
    const { data: candidate, error: candidateError } = await this.db.from("jackpot_candidates")
      .select("id,asset_id,current_revision,current_state,detected_at,active_window_start,assets(external_id,crypto_tokens(mint_address,first_seen_at))")
      .eq("id", claim.candidate_id).single();
    if (candidateError) throw candidateError;
    const { data: source, error: sourceError } = await this.db.from("jackpot_candidate_revisions")
      .select("revision_number,information_cutoff_at,features")
      .eq("candidate_id", candidate.id).eq("revision_number", candidate.current_revision)
      .lte("information_cutoff_at", cutoff).lte("available_at", cutoff).maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) throw new Error("NO_SOURCE_REVISION_AVAILABLE_AT_CUTOFF");

    const asset: any = Array.isArray(candidate.assets) ? candidate.assets[0] : candidate.assets;
    const token = Array.isArray(asset?.crypto_tokens) ? asset.crypto_tokens[0] : asset?.crypto_tokens;
    const mint = token?.mint_address ?? asset?.external_id;
    const errors: string[] = [];
    // Keep the caller's cutoff fixed. Fetches completing later are persisted
    // for a queued revisit, never backdated into the current revision.
    let pendingEvidenceAfter: string | null = null;
    const rememberAvailability = (at: string) => {
      const available = Date.parse(at);
      if (!Number.isFinite(available)) throw new Error("INVALID_PROVIDER_AVAILABILITY");
      if (available > Date.parse(cutoff) && (pendingEvidenceAfter === null || available > Date.parse(pendingEvidenceAfter)))
        pendingEvidenceAfter = new Date(available).toISOString();
    };

    let liquidity = await this.storedLiquidity(candidate.asset_id, cutoff);
    if (!liquidity && mint) {
      try {
        const from = new Date(Math.max(Date.parse(candidate.detected_at), Date.parse(cutoff) - 86_400_000)).toISOString();
        const points = await this.liquidity.getHistoricalLiquidity({ assetId: candidate.asset_id, mintAddress: mint, from, to: cutoff, informationCutoffAt: cutoff });
        await this.repo.saveLiquiditySnapshots(points);
        for (const point of points) rememberAvailability(point.informationAvailableAt);
        liquidity = await this.storedLiquidity(candidate.asset_id, cutoff);
      } catch (failure) { errors.push(`LIQUIDITY:${message(failure)}`); }
    }

    let risk = await this.storedRisk(candidate.asset_id, cutoff);
    if (!risk && mint) {
      try {
        const assessment = await this.risk.assess(mint, cutoff);
        await this.repo.saveTokenRiskAssessment(candidate.asset_id, assessment);
        rememberAvailability(assessment.informationAvailableAt);
        risk = await this.storedRisk(candidate.asset_id, cutoff);
      } catch (failure) { errors.push(`RISK:${message(failure)}`); }
    }
    if (!mint) errors.push("TOKEN_MINT_UNAVAILABLE");

    const wallet = await loadCandidateWalletMetrics(this.db, candidate.asset_id, candidate.active_window_start, cutoff);
    const events = await this.acceleration(candidate.asset_id, cutoff);
    const tokenAge = token?.first_seen_at
      ? Math.max(0, Math.floor((Date.parse(cutoff) - Date.parse(token.first_seen_at)) / 3_600_000) * 3_600)
      : null;
    const closure = buildGapClosure({
      candidateId: candidate.id, candidateRevision: source.revision_number, cutoff, previousFeatures: source.features ?? {},
      liquidity: liquidity ? { value: Number(liquidity.liquidity_usd), evidence: ref("liquidity_snapshot", liquidity.id, liquidity.information_available_at, liquidity.provider, liquidity.data_quality) } : null,
      risk: risk ? { status: risk.rug_status, coverage: riskCoveragePercent(risk.risk_components) ?? 0, evidence: ref("token_risk_assessment", risk.id, risk.information_available_at, risk.provider, risk.data_quality) } : null,
      wallet, tokenAgeSeconds: tokenAge, priceAcceleration: events.price, volumeAcceleration: events.volume,
    });
    const retryAt = new Date(Math.max(Date.parse(cutoff) + RETRY_DELAY_MS, pendingEvidenceAfter ? Date.parse(pendingEvidenceAfter) : 0)).toISOString();
    const { data: committed, error: commitError } = await this.db.rpc("finish_candidate_data_gap", {
      target_candidate: candidate.id, target_claim: claim.claim_token, expected_revision: source.revision_number,
      input_cutoff: cutoff, closure: { ...closure, errors, version: DATA_GAP_CLOSURE_VERSION },
      retry_at: retryAt, waiting_after: pendingEvidenceAfter,
    });
    if (commitError) throw commitError;
    const result = committed?.[0];
    if (!result) throw new Error("DATA_GAP_COMMIT_RESULT_MISSING");
    return { candidateId: candidate.id, created: result.created as boolean, revision: result.result_revision as number | null,
      status: result.work_status as string, pendingEvidenceAfter, gaps: closure.gaps, errors };
  }

  private async storedLiquidity(assetId: string, cutoff: string) {
    const { data, error } = await this.db.from("crypto_liquidity_snapshots")
      .select("id,liquidity_usd,information_available_at,provider,data_quality,effective_at")
      .eq("asset_id", assetId).lte("information_available_at", cutoff).lte("effective_at", cutoff)
      .order("effective_at", { ascending: false }).order("liquidity_usd", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  }

  private async storedRisk(assetId: string, cutoff: string) {
    const { data, error } = await this.db.from("token_risk_assessments")
      .select("id,rug_status,risk_components,information_available_at,information_cutoff_at,provider,data_quality")
      .eq("asset_id", assetId).lte("information_available_at", cutoff).lte("information_cutoff_at", cutoff)
      .order("information_available_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  }

  private async acceleration(assetId: string, cutoff: string) {
    const latest = async (type: string) => {
      const { data, error } = await this.db.from("event_outbox")
        .select("event_id,event_type,available_at,provider,data_quality")
        .eq("asset_id", assetId).eq("event_type", type).lte("available_at", cutoff)
        .order("available_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data ? ref("event", data.event_id, data.available_at, data.provider, data.data_quality) : null;
    };
    const [price, volume] = await Promise.all([latest("market.price_accelerated"), latest("market.volume_accelerated")]);
    return { price, volume };
  }
}

function ref(type: string, id: string, availableAt: string, source: string, quality: number | null): GapEvidence {
  return { id, type, availableAt, source, dataQuality: quality };
}
function message(error: unknown) {
  return error !== null && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : String(error);
}
