import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateStrategyValidation, VALIDATION_PROTOCOL_V1, type ValidationPhase, type ValidationTrade } from "@/domain/strategy-validation";
import { assertRuntimeTransition, assessRuntime, capitalStepRecommendation, fractionalKelly, riskOfRuin, type RuntimeAssessmentInput } from "@/domain/runtime-governance";
import { deterministicDigest } from "@/domain/events";

export class StrategyValidationService {
  constructor(private db: SupabaseClient) {}

  async registerHypothesis(input: { strategyDefinitionId: string; hypothesisVersion: number; thesis: string; invalidationCondition: string; expectedMechanism: string; cutoffAt: string; evidenceRefs?: unknown[] }) {
    for (const [field, value] of Object.entries({ thesis: input.thesis, invalidationCondition: input.invalidationCondition, expectedMechanism: input.expectedMechanism })) {
      if (!value.trim()) throw new Error(`HYPOTHESIS_${field.toUpperCase()}_REQUIRED`);
    }
    const content = { strategyDefinitionId: input.strategyDefinitionId, hypothesisVersion: input.hypothesisVersion, thesis: input.thesis.trim(), invalidationCondition: input.invalidationCondition.trim(), expectedMechanism: input.expectedMechanism.trim(), cutoffAt: input.cutoffAt, evidenceRefs: input.evidenceRefs ?? [] };
    const hypothesisHash = deterministicDigest(content);
    const hypothesisKey = `hypothesis_${hypothesisHash.slice(0, 40)}`;
    const existing = await this.db.from("strategy_hypotheses").select("id").eq("hypothesis_key", hypothesisKey).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return { hypothesisId: existing.data.id, reused: true, hypothesisKey };
    const insert = await this.db.from("strategy_hypotheses").insert({ hypothesis_key: hypothesisKey, strategy_definition_id: input.strategyDefinitionId, hypothesis_version: input.hypothesisVersion, thesis: content.thesis, invalidation_condition: content.invalidationCondition, expected_mechanism: content.expectedMechanism, registered_at: input.cutoffAt, information_cutoff_at: input.cutoffAt, available_at: input.cutoffAt, evidence_refs: content.evidenceRefs, hypothesis_hash: hypothesisHash }).select("id").single();
    if (insert.error) throw insert.error;
    return { hypothesisId: insert.data.id, reused: false, hypothesisKey };
  }

  async validate(input: { evaluationRunId: string; hypothesisId: string; phase: ValidationPhase; modeledLiveCostR?: number; stressCostR?: number; independentPeriods?: number }) {
    const [{ data: run, error }, { data: protocol, error: protocolError }] = await Promise.all([
      this.db.from("strategy_evaluation_runs").select("*,strategy_definitions(id,strategy_key,version),strategy_evaluation_trades(*)").eq("id", input.evaluationRunId).single(),
      this.db.from("strategy_validation_protocols").select("*").eq("protocol_key", "strategy-validation-protocol").eq("version", 1).single(),
    ]);
    if (error) throw error; if (protocolError) throw protocolError;
    const hypothesis = await this.db.from("strategy_hypotheses").select("*").eq("id", input.hypothesisId).single();
    if (hypothesis.error) throw hypothesis.error;
    const rows: any[] = [...(run.strategy_evaluation_trades ?? [])].sort((a, b) => a.entered_at.localeCompare(b.entered_at) || a.trade_key.localeCompare(b.trade_key));
    const trades: ValidationTrade[] = rows.map((trade) => ({ tradeId: trade.trade_key, assetId: run.asset_id, enteredAt: trade.entered_at, exitedAt: trade.exited_at, rMultiple: Number(trade.r_multiple), modeledLiveR: Number(trade.r_multiple) - (input.modeledLiveCostR ?? 0), stressR: Number(trade.r_multiple) - (input.stressCostR ?? 0), regime: trade.regime, availableAt: trade.exited_at }));
    const result = evaluateStrategyValidation({ strategyId: run.strategy_definitions.strategy_key, strategyVersion: run.strategy_definitions.version, phase: input.phase, windowStart: rows.length ? rows.map((row) => row.entered_at).sort()[0] : run.information_cutoff_at, windowEnd: rows.length ? rows.map((row) => row.exited_at).sort().at(-1)! : run.information_cutoff_at, informationCutoffAt: run.information_cutoff_at, datasetHash: run.input_hash, hypothesisId: hypothesis.data.hypothesis_key, invalidationCondition: hypothesis.data.invalidation_condition, dataQuality: run.metrics?.dataQuality ?? null, independentPeriods: input.independentPeriods ?? null, trades }, { ...VALIDATION_PROTOCOL_V1, ...protocol.definition });
    const existing = await this.db.from("strategy_validation_runs").select("id").eq("validation_key", result.validationKey).maybeSingle();
    if (existing.error) throw existing.error; if (existing.data) return { validationRunId: existing.data.id, reused: true, result };
    const insert = await this.db.from("strategy_validation_runs").insert({ validation_key: result.validationKey, protocol_id: protocol.id, hypothesis_id: input.hypothesisId, strategy_definition_id: run.strategy_definitions.id, phase: input.phase, window_start: rows.length ? trades[0].enteredAt : run.information_cutoff_at, window_end: rows.length ? trades.at(-1)!.exitedAt : run.information_cutoff_at, information_cutoff_at: run.information_cutoff_at, available_at: run.information_cutoff_at, dataset_hash: run.input_hash, input_snapshot_ids: [run.id], decision: result.decision, gates: result.gates, metrics: result.metrics, result_hash: result.resultHash }).select("id").single();
    if (insert.error) throw insert.error;
    return { validationRunId: insert.data.id, reused: false, result };
  }

  async persistRuntimeAssessment(strategyDefinitionId: string, validationRunId: string | null, input: RuntimeAssessmentInput, performance: { winProbability: number | null; averageWinR: number | null; averageLossR: number | null; riskFraction: number | null }) {
    const previous = await this.db.from("strategy_runtime_assessments").select("runtime_state").eq("strategy_definition_id", strategyDefinitionId).lt("information_cutoff_at", input.cutoffAt).order("information_cutoff_at", { ascending: false }).limit(1).maybeSingle();
    if (previous.error) throw previous.error;
    if (!previous.data && input.state !== "RESEARCH") throw new Error("INITIAL_RUNTIME_STATE_MUST_BE_RESEARCH");
    if (previous.data && previous.data.runtime_state !== input.state) assertRuntimeTransition(previous.data.runtime_state, input.state);
    const result = assessRuntime(input);
    const riskDiagnostics = { riskOfRuin: riskOfRuin(performance.winProbability, performance.averageWinR, performance.averageLossR, performance.riskFraction), fractionalKellyCap: fractionalKelly(performance.winProbability, performance.averageWinR, performance.averageLossR) };
    const existing = await this.db.from("strategy_runtime_assessments").select("id").eq("assessment_key", result.assessmentKey).maybeSingle();
    if (existing.error) throw existing.error; if (existing.data) return { assessmentId: existing.data.id, reused: true, result, riskDiagnostics };
    const insert = await this.db.from("strategy_runtime_assessments").insert({ assessment_key: result.assessmentKey, strategy_definition_id: strategyDefinitionId, validation_run_id: validationRunId, governance_version: result.version, runtime_state: input.state, decision: result.decision, information_cutoff_at: input.cutoffAt, available_at: input.cutoffAt, gates: result.gates, edge_decay: result.edgeDecay, correlation_assessment: { value: input.portfolioCorrelation, coverage: input.correlationCoverage }, risk_diagnostics: riskDiagnostics, revalidation_required: result.revalidationRequired, result_hash: deterministicDigest({ result, riskDiagnostics }) }).select("id").single();
    if (insert.error) throw insert.error;
    return { assessmentId: insert.data.id, reused: false, result, riskDiagnostics };
  }

  async persistCapitalDecision(input: { strategyDefinitionId: string; runtimeAssessmentId: string; currentCapital: number; requestedCapital: number; evidenceStatus: "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE"; manualApproval: boolean; approvedBy: string | null; cutoffAt: string; maximumMultiplier?: number }) {
    const recommendation = capitalStepRecommendation(input.currentCapital, input.requestedCapital, input.evidenceStatus, input.manualApproval, input.maximumMultiplier);
    const identity = { strategyDefinitionId: input.strategyDefinitionId, runtimeAssessmentId: input.runtimeAssessmentId, requestedCapital: input.requestedCapital, cutoffAt: input.cutoffAt };
    const decisionKey = `capital_${deterministicDigest(identity).slice(0, 40)}`;
    const existing = await this.db.from("strategy_capital_gate_decisions").select("id").eq("decision_key", decisionKey).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return { capitalDecisionId: existing.data.id, reused: true, recommendation };
    const approvedBy = recommendation.decision === "APPROVED" ? input.approvedBy : null;
    if (recommendation.decision === "APPROVED" && !approvedBy?.trim()) throw new Error("CAPITAL_APPROVAL_IDENTITY_REQUIRED");
    const decisionHash = deterministicDigest({ ...identity, recommendation, approvedBy });
    const insert = await this.db.from("strategy_capital_gate_decisions").insert({ decision_key: decisionKey, strategy_definition_id: input.strategyDefinitionId, runtime_assessment_id: input.runtimeAssessmentId, current_capital: input.currentCapital, requested_capital: input.requestedCapital, maximum_allowed: recommendation.maximumAllowed, decision: recommendation.decision, manual_approval: input.manualApproval, approved_by: approvedBy, information_cutoff_at: input.cutoffAt, available_at: input.cutoffAt, decision_hash: decisionHash }).select("id").single();
    if (insert.error) throw insert.error;
    return { capitalDecisionId: insert.data.id, reused: false, recommendation };
  }
}
