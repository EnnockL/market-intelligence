"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { StrategyValidationService } from "@/services/strategy-validation/service";
import type { ValidationPhase } from "@/domain/strategy-validation";
import { requireOperatorPage } from "@/lib/operator-session";

export type ValidationActionState = { status: "IDLE" | "SUCCESS" | "ERROR"; message: string };
const initialError = (error: unknown): ValidationActionState => ({ status: "ERROR", message: error instanceof Error ? readable(error.message) : "Åtgärden misslyckades." });

const hypothesisSchema = z.object({
  strategyDefinitionId: z.string().uuid(), hypothesisVersion: z.coerce.number().int().positive(),
  thesis: z.string().trim().min(10).max(2000), invalidationCondition: z.string().trim().min(5).max(1000),
  expectedMechanism: z.string().trim().min(10).max(2000),
});

export async function registerHypothesis(_: ValidationActionState, formData: FormData): Promise<ValidationActionState> {
  await requireOperatorPage("/strategy-validation");
  const parsed = hypothesisSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "ERROR", message: "Fyll i strategi, version, tes, mekanism och en tydlig invalidering." };
  try {
    const cutoffAt = new Date().toISOString();
    const result = await new StrategyValidationService(createServiceClient()).registerHypothesis({ ...parsed.data, cutoffAt });
    revalidatePath("/strategy-validation");
    return { status: "SUCCESS", message: result.reused ? "Den identiska hypotesen fanns redan." : "Hypotesen är fryst och sparad som oföränderlig historik." };
  } catch (error) { return initialError(error); }
}

const validationSchema = z.object({
  evaluationRunIds: z.array(z.string().uuid()).min(1).max(20), hypothesisId: z.string().uuid(),
  phase: z.enum(["LEARNING", "FROZEN", "OUT_OF_SAMPLE", "DEMO_VALIDATION"]),
  modeledLiveCostR: z.coerce.number().min(0).max(5), stressCostR: z.coerce.number().min(0).max(10),
});

export async function runValidation(_: ValidationActionState, formData: FormData): Promise<ValidationActionState> {
  await requireOperatorPage("/strategy-validation");
  const parsed = validationSchema.safeParse({ ...Object.fromEntries(formData), evaluationRunIds: formData.getAll("evaluationRunIds") });
  if (!parsed.success) return { status: "ERROR", message: "Kontrollera backtest, hypotes, fas och kostnadsantaganden." };
  const db = createServiceClient();
  const service = new StrategyValidationService(db);
  try {
    const validation = await service.validate(parsed.data as typeof parsed.data & { phase: ValidationPhase });
    const run = await db.from("strategy_evaluation_runs").select("strategy_definition_id,information_cutoff_at,strategy_definitions(strategy_key,version)").eq("id", parsed.data.evaluationRunIds[0]).single();
    if (run.error) throw run.error;
    const definition: any = Array.isArray(run.data.strategy_definitions) ? run.data.strategy_definitions[0] : run.data.strategy_definitions;
    await service.persistRuntimeAssessment(validation.strategyDefinitionId, validation.validationRunId, {
      strategyId: definition.strategy_key, strategyVersion: definition.version, state: "RESEARCH", cutoffAt: validation.informationCutoffAt,
      validationDecision: validation.result.decision, setupPresent: null, invalidationCondition: "Defined in immutable hypothesis",
      invalidated: null, regimeEligible: null, criticalDataComplete: false, portfolioCorrelation: null, correlationCoverage: null,
      rollingExpectedValueR: null, rollingLowerBoundR: null, observations: 0, minimumObservations: 30, recentCriticalBugs: null, killSwitch: false,
    }, { winProbability: null, averageWinR: null, averageLossR: null, riskFraction: null });
    revalidatePath("/strategy-validation");
    return { status: "SUCCESS", message: `${validation.result.decision}: ${validation.result.metrics.sampleSize} trades granskades. Runtime är säkert kvar i NO_TRADE.` };
  } catch (error) { return initialError(error); }
}

function readable(message: string) {
  if (message.includes("duplicate key") || message.includes("strategy_hypotheses_strategy_definition_id_hypothesis_version_key")) return "Det versionsnumret används redan för strategin. Välj nästa version.";
  const labels: Record<string, string> = {
    HYPOTHESIS_STRATEGY_MISMATCH: "Hypotesen och backtestet tillhör olika strategier.",
    HYPOTHESIS_NOT_FROZEN_BEFORE_EVALUATION_WINDOW: "Hypotesen måste vara fryst innan testfönstret börjar.",
    VALIDATION_WINDOW_OVERLAP: "Det nya testfönstret överlappar den föregående fasen. Välj endast senare data.",
  };
  if (labels[message]) return labels[message];
  if (message.startsWith("PREVIOUS_VALIDATION_PHASE_REQUIRED:")) return "Fasen före måste köras först.";
  if (message.startsWith("PREVIOUS_VALIDATION_PHASE_NOT_APPROVED:")) return "Fasen före är inte godkänd.";
  return "Valideringen kunde inte slutföras. Kontrollera underlaget och serverns driftlogg.";
}
