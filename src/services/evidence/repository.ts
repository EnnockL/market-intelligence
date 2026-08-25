import type { SupabaseClient } from "@supabase/supabase-js";
import { evidenceId, toEvidenceReference, type EvidenceRegistration } from "@/domain/evidence";

export class EvidenceRepository {
  constructor(private readonly db: SupabaseClient) {}
  async register(input: EvidenceRegistration) {
    const id = evidenceId(input);
    const { data, error } = await this.db.from("evidence_records").insert({ evidence_id: id, evidence_type: input.evidenceType,
      source_table: input.sourceTable, source_record_id: input.sourceRecordId, available_at: input.availableAt,
      payload_hash: input.payloadHash, metadata: input.metadata ?? {} }).select("evidence_id").maybeSingle();
    if (error?.code === "23505") {
      const { data: existing, error: lookupError } = await this.db.from("evidence_records").select("payload_hash,available_at,evidence_type").eq("evidence_id", id).single();
      if (lookupError) throw lookupError;
      if (existing.payload_hash !== input.payloadHash || existing.available_at !== input.availableAt || existing.evidence_type !== input.evidenceType) throw new Error(`Evidence identity conflict: ${id}`);
      return toEvidenceReference(input);
    }
    if (error) throw error;
    if (!data) throw new Error(`Evidence registration returned no record: ${id}`);
    return toEvidenceReference(input);
  }
}
