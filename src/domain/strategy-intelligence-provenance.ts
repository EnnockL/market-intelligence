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
  prospectivePlanId?: string;
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
  frozen?: { datasetId: string; planId: string; strategyDefinitionId: string; inputHash: string; startsAt: string; endsAt: string; registeredAt: string; sealedAt: string };
}) {
  const cutoff = Date.parse(input.cutoffAt);
  const linked = input.validations.filter(row =>
    row.strategyDefinitionId === input.strategyDefinitionId &&
    row.evaluationRunIds.includes(input.evaluationRunId) &&
    Date.parse(row.availableAt) <= cutoff && Date.parse(row.createdAt) <= cutoff,
  ).sort((a, b) => a.id.localeCompare(b.id));
  const learning = linked.some(row => row.phase === "LEARNING");
  const f = input.frozen;
  if (!learning && f && f.strategyDefinitionId === input.strategyDefinitionId && f.inputHash === input.evaluationInputHash
    && !!f.datasetId && !!f.planId && /^[a-f0-9]{64}$/.test(f.inputHash)
    && Date.parse(f.registeredAt) <= Date.parse(f.startsAt) && Date.parse(f.startsAt) < Date.parse(f.endsAt)
    && Date.parse(f.endsAt) <= Date.parse(f.sealedAt) && Date.parse(f.sealedAt) <= cutoff) {
    return { split: "OUT_OF_SAMPLE" as const, provenance: { version: INTELLIGENCE_PROVENANCE_VERSION, status: "VERIFIED" as const,
      reason: null, evaluationInputHash: f.inputHash, validationRunIds: linked.map(x => x.id), observedPhases: ["OUT_OF_SAMPLE"],
      windowSource: "FROZEN_DATASET_MANIFEST" as const, frozenDatasetId: f.datasetId, prospectivePlanId: f.planId } };
  }

  // Legacy runs have only a candle hash and retrospectively inferred windows.
  // Phase labels cannot repair their missing prospective source manifest.
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

/** Verified manifest producer or explicit existing validation linkage; labels alone cannot pass. */
export function hasVerifiedResearchProvenance(provenance: IntelligenceProvenance | undefined) {
  return provenance?.version === INTELLIGENCE_PROVENANCE_VERSION &&
    provenance.status === "VERIFIED" && provenance.windowSource === "FROZEN_DATASET_MANIFEST" &&
    !!provenance.frozenDatasetId?.trim() && !!provenance.evaluationInputHash?.trim() &&
    Array.isArray(provenance.validationRunIds) && (provenance.validationRunIds.length > 0 || !!provenance.prospectivePlanId?.trim()) &&
    Array.isArray(provenance.observedPhases) && !provenance.observedPhases.includes("LEARNING");
}
