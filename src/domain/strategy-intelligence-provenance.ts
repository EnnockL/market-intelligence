/** Validation phase labels are observations, not proof of a pre-registered dataset split. */
export const INTELLIGENCE_PROVENANCE_VERSION = "intelligence-provenance-v1";

export interface IntelligenceProvenance {
  version: string;
  status: "UNVERIFIED" | "VERIFIED";
  reason: string | null;
  evaluationInputHash: string | null;
  validationRunIds: string[];
  observedPhases: string[];
  windowSource: "TRADE_SPAN_ONLY" | "FROZEN_DATASET_MANIFEST";
  frozenDatasetId: string | null;
}

export interface LinkedValidationEvidence {
  id: string;
  phase: string;
  strategyDefinitionId: string;
  evaluationRunIds: string[];
  availableAt: string;
  createdAt: string;
}

export function classifyResearchProvenance(input: {
  evaluationRunId: string;
  strategyDefinitionId: string;
  evaluationInputHash: string | null;
  cutoffAt: string;
  validations: LinkedValidationEvidence[];
}) {
  const cutoff = Date.parse(input.cutoffAt);
  const linked = input.validations.filter(row =>
    row.strategyDefinitionId === input.strategyDefinitionId &&
    row.evaluationRunIds.includes(input.evaluationRunId) &&
    Date.parse(row.availableAt) <= cutoff && Date.parse(row.createdAt) <= cutoff,
  ).sort((a, b) => a.id.localeCompare(b.id));
  const learning = linked.some(row => row.phase === "LEARNING");

  // Current evaluation runs store a candle hash, but no complete dataset window,
  // provider manifest or prospectively frozen split. Window plans are inferred
  // from completed trades after evaluation. Neither APPROVED nor an OOS phase
  // can repair that missing provenance, so this adapter NEVER emits OOS proof.
  const provenance: IntelligenceProvenance = {
    version: INTELLIGENCE_PROVENANCE_VERSION,
    status: "UNVERIFIED",
    reason: learning ? "LEARNING_EVIDENCE_NOT_SELECTION_PROOF" : "FROZEN_DATASET_PROVENANCE_UNAVAILABLE",
    evaluationInputHash: input.evaluationInputHash,
    validationRunIds: linked.map(row => row.id),
    observedPhases: [...new Set(linked.map(row => row.phase))].sort(),
    windowSource: "TRADE_SPAN_ONLY",
    frozenDatasetId: null,
  };
  return { split: learning ? "TRAIN" as const : "EXPLORATION" as const, provenance };
}

/** Reserved for a future manifest-verifying producer; phase labels cannot pass. */
export function hasVerifiedResearchProvenance(provenance: IntelligenceProvenance | undefined) {
  return provenance?.version === INTELLIGENCE_PROVENANCE_VERSION &&
    provenance.status === "VERIFIED" && provenance.windowSource === "FROZEN_DATASET_MANIFEST" &&
    !!provenance.frozenDatasetId?.trim() && !!provenance.evaluationInputHash?.trim() &&
    Array.isArray(provenance.validationRunIds) && provenance.validationRunIds.length > 0 &&
    Array.isArray(provenance.observedPhases) && !provenance.observedPhases.includes("LEARNING");
}
