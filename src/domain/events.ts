import { createHash } from "node:crypto";
import { z } from "zod";

export const EVENT_SCHEMA_VERSION = 1 as const;

const eventEnvelopeSchema = z.object({
  eventId: z.string().min(1), schemaVersion: z.number().int().positive(), eventType: z.string().min(1),
  entityType: z.string().min(1), entityId: z.string().min(1), assetId: z.string().nullable(),
  occurredAt: z.string().datetime({ offset: true }), observedAt: z.string().datetime({ offset: true }), availableAt: z.string().datetime({ offset: true }),
  provider: z.string().min(1), sourceReference: z.string().min(1), dataQuality: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100).nullable(), payload: z.record(z.unknown()), payloadHash: z.string().length(64),
  correlationId: z.string().nullable(), causationId: z.string().nullable(),
}).superRefine((event, context) => {
  if (event.occurredAt > event.observedAt) context.addIssue({ code: "custom", message: "occurredAt must be <= observedAt", path: ["observedAt"] });
  if (event.observedAt > event.availableAt) context.addIssue({ code: "custom", message: "observedAt must be <= availableAt", path: ["availableAt"] });
});

export type EventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> = Omit<z.infer<typeof eventEnvelopeSchema>, "payload"> & { payload: TPayload };
export type NewEvent<TPayload extends Record<string, unknown>> = Omit<EventEnvelope<TPayload>, "eventId" | "schemaVersion" | "payloadHash"> & { eventId?: string; schemaVersion?: number };

export function createEventEnvelope<TPayload extends Record<string, unknown>>(input: NewEvent<TPayload>): EventEnvelope<TPayload> {
  const payloadHash = hashPayload(input.payload);
  const eventId = input.eventId ?? stableExternalEventId({ provider: input.provider, sourceReference: input.sourceReference, eventType: input.eventType, entityType: input.entityType, entityId: input.entityId });
  return parseEventEnvelope({ ...input, eventId, schemaVersion: input.schemaVersion ?? EVENT_SCHEMA_VERSION, payloadHash }) as EventEnvelope<TPayload>;
}

export function parseEventEnvelope(value: unknown, options: { verifyPayloadHash?: boolean } = {}): EventEnvelope { const event=eventEnvelopeSchema.parse(value); if(options.verifyPayloadHash!==false&&hashPayload(event.payload)!==event.payloadHash)throw new Error("payloadHash does not match payload"); return event; }
export function serializeEventEnvelope(event: EventEnvelope) { return stableJson(parseEventEnvelope(event)); }
export function deserializeEventEnvelope(value: string) { return parseEventEnvelope(JSON.parse(value)); }
export function hashPayload(payload: Record<string, unknown>) { return deterministicDigest(payload); }
export function stableExternalEventId(input: { provider: string; sourceReference: string; eventType: string; entityType: string; entityId: string }) { return `evt_${deterministicDigest(input).slice(0, 40)}`; }
export function deterministicDigest(value: unknown) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
