import { deterministicDigest } from "./events";

export const OPPORTUNITY_POLICY_VERSION = "opportunity-state-policy-v1";
export const REVISION_TYPES = ["v0_fast_safety", "v1_smart_money", "v2_risk_liquidity", "v3_information", "v4_meta"] as const;
export type RevisionType = typeof REVISION_TYPES[number];
export type OpportunityState = "detected" | "fast_opportunity" | "enriching" | "qualified" | "watch" | "rejected" | "paper_trade_candidate";

const transitions: Record<OpportunityState, readonly OpportunityState[]> = {
  detected: ["detected", "fast_opportunity", "enriching", "watch", "rejected"],
  fast_opportunity: ["fast_opportunity", "enriching", "qualified", "watch", "rejected"],
  enriching: ["enriching", "qualified", "watch", "rejected"],
  qualified: ["qualified", "watch", "rejected", "paper_trade_candidate"],
  watch: ["watch", "enriching", "qualified", "rejected"],
  rejected: ["rejected", "enriching"],
  paper_trade_candidate: ["paper_trade_candidate", "watch", "rejected"],
};

export interface EvidenceReference { evidenceId: string; evidenceType: string; availableAt: string; payloadHash: string; }
export interface OpportunityRevisionInput {
  opportunityId: string; revisionNumber: number; revisionType: RevisionType; currentState: OpportunityState; nextState: OpportunityState;
  createdAt: string; informationCutoffAt: string; triggerEventId: string; evidenceRefs: EvidenceReference[];
  agentOutputs: Record<string, unknown>; safetyResult: Record<string, unknown>;
}
export interface OpportunityAggregate {
  opportunityId: string; state: OpportunityState; currentRevision: number;
  revisions: ReadonlyArray<ReturnType<typeof validateOpportunityRevision>>;
}

export function assertValidTransition(current: OpportunityState, next: OpportunityState) {
  if (!transitions[current].includes(next)) throw new Error(`Invalid opportunity transition: ${current} -> ${next}`);
}

export function validateOpportunityRevision(input: OpportunityRevisionInput) {
  assertValidTransition(input.currentState, input.nextState);
  if (input.revisionNumber < 1 || !Number.isInteger(input.revisionNumber)) throw new Error("revisionNumber must be a positive integer");
  if (input.informationCutoffAt > input.createdAt) throw new Error("informationCutoffAt cannot be after createdAt");
  const future = input.evidenceRefs.find((reference) => reference.availableAt > input.informationCutoffAt);
  if (future) throw new Error(`Future evidence rejected: ${future.evidenceId}`);
  const duplicate = input.evidenceRefs.find((reference, index) => input.evidenceRefs.findIndex((item) => item.evidenceId === reference.evidenceId) !== index);
  if (duplicate) throw new Error(`Duplicate evidence reference: ${duplicate.evidenceId}`);
  return { ...input, revisionKey: opportunityRevisionKey(input) };
}

export function opportunityIdempotencyKey(input: { assetId: string; opportunityType: string; createdFromEventId: string }) {
  return `opp_${deterministicDigest(input).slice(0, 40)}`;
}

export function opportunityRevisionKey(input: OpportunityRevisionInput) {
  return deterministicDigest({ opportunityId: input.opportunityId, revisionType: input.revisionType, nextState: input.nextState, informationCutoffAt: input.informationCutoffAt, triggerEventId: input.triggerEventId, evidenceIds: input.evidenceRefs.map((item) => item.evidenceId).sort(), agentOutputs: input.agentOutputs, safetyResult: input.safetyResult });
}

export function rebuildOpportunity(initial: OpportunityState, revisions: OpportunityRevisionInput[]) {
  return [...revisions].sort((a, b) => a.revisionNumber - b.revisionNumber).reduce((state, revision, index) => {
    if (revision.revisionNumber !== index + 1) throw new Error("Opportunity revision sequence has a gap");
    if (revision.currentState !== state) throw new Error("Opportunity revision state does not match rebuild state");
    validateOpportunityRevision(revision); return revision.nextState;
  }, initial);
}

export function appendOpportunityRevision(aggregate: OpportunityAggregate, input: OpportunityRevisionInput): OpportunityAggregate {
  if (input.opportunityId !== aggregate.opportunityId) throw new Error("Revision belongs to another opportunity");
  if (input.revisionNumber !== aggregate.currentRevision + 1) throw new Error("Revision number is not consecutive");
  if (input.currentState !== aggregate.state) throw new Error("Revision currentState is stale");
  const revision = Object.freeze(validateOpportunityRevision(input));
  if (aggregate.revisions.some((item) => item.revisionKey === revision.revisionKey)) throw new Error("Duplicate opportunity revision");
  return Object.freeze({ opportunityId: aggregate.opportunityId, state: input.nextState, currentRevision: input.revisionNumber, revisions: Object.freeze([...aggregate.revisions, revision]) });
}
