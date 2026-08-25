import { deterministicDigest } from "./events";
import type { EvidenceReference } from "./opportunities";

export interface EvidenceRegistration {
  evidenceType: string; sourceTable: string; sourceRecordId: string; availableAt: string;
  payloadHash: string; metadata?: Record<string, unknown>;
}

export function evidenceId(input: Pick<EvidenceRegistration, "sourceTable" | "sourceRecordId">) {
  return `evd_${deterministicDigest(input).slice(0, 40)}`;
}

export function toEvidenceReference(input: EvidenceRegistration): EvidenceReference {
  return { evidenceId: evidenceId(input), evidenceType: input.evidenceType, availableAt: input.availableAt, payloadHash: input.payloadHash };
}
