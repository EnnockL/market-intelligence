import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEventEnvelope, type EventEnvelope } from "@/domain/events";
import type { EventDelivery, EventTransport } from "./transport";

type OutboxRow = {
  event_id: string; schema_version: number; event_type: string; entity_type: string; entity_id: string; asset_id: string | null;
  occurred_at: string; observed_at: string; available_at: string; provider: string; source_reference: string; data_quality: number;
  confidence: number | null; payload: Record<string, unknown>; payload_hash: string; correlation_id: string | null; causation_id: string | null;
  attempts: number; locked_at: string; locked_by: string;
};

export class PostgresOutboxTransport implements EventTransport {
  constructor(private readonly db: SupabaseClient) {}

  async publish(event: EventEnvelope) {
    const value = parseEventEnvelope(event);
    const { data, error } = await this.db.from("event_outbox").insert({ event_id: value.eventId, schema_version: value.schemaVersion, event_type: value.eventType,
      entity_type: value.entityType, entity_id: value.entityId, asset_id: value.assetId, occurred_at: value.occurredAt, observed_at: value.observedAt,
      available_at: value.availableAt, provider: value.provider, source_reference: value.sourceReference, data_quality: value.dataQuality,
      confidence: value.confidence, payload: value.payload, payload_hash: value.payloadHash, correlation_id: value.correlationId, causation_id: value.causationId,
    }).select("event_id").maybeSingle();
    if (error?.code === "23505") {
      const { data: existing, error: lookupError } = await this.db.from("event_outbox").select("payload_hash,schema_version,event_type").eq("event_id", value.eventId).single();
      if (lookupError) throw lookupError;
      if (existing.payload_hash !== value.payloadHash || Number(existing.schema_version) !== value.schemaVersion || existing.event_type !== value.eventType) throw new Error(`Event identity conflict: ${value.eventId}`);
      return false;
    }
    if (error) throw error; return Boolean(data);
  }

  async claim(input: { workerId: string; limit: number; lockTimeoutSeconds: number }): Promise<EventDelivery[]> {
    const { data, error } = await this.db.rpc("claim_outbox_events", { p_worker_id: input.workerId, p_limit: input.limit, p_lock_timeout_seconds: input.lockTimeoutSeconds });
    if (error) throw error;
    return ((data ?? []) as OutboxRow[]).map((row) => ({ envelope: mapEnvelope(row), attempt: Number(row.attempts), lockedAt: row.locked_at, workerId: row.locked_by }));
  }

  async acknowledge(eventId: string, workerId: string) {
    const { data, error } = await this.db.rpc("complete_outbox_event", { p_event_id: eventId, p_worker_id: workerId });
    if (error) throw error; return Boolean(data);
  }

  async reject(eventId: string, workerId: string, errorValue: Error, retryDelaySeconds: number) {
    const { data, error } = await this.db.rpc("fail_outbox_event", { p_event_id: eventId, p_worker_id: workerId, p_error: errorValue.message, p_retry_delay_seconds: retryDelaySeconds });
    if (error) throw error; return Boolean(data);
  }
}

function mapEnvelope(row: OutboxRow) {
  return parseEventEnvelope({ eventId: row.event_id, schemaVersion: Number(row.schema_version), eventType: row.event_type, entityType: row.entity_type,
    entityId: row.entity_id, assetId: row.asset_id, occurredAt: row.occurred_at, observedAt: row.observed_at, availableAt: row.available_at,
    provider: row.provider, sourceReference: row.source_reference, dataQuality: Number(row.data_quality), confidence: row.confidence === null ? null : Number(row.confidence),
    payload: row.payload, payloadHash: row.payload_hash, correlationId: row.correlation_id, causationId: row.causation_id });
}
