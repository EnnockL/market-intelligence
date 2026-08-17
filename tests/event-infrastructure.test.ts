import { describe, expect, it } from "vitest";
import { createEventEnvelope, deserializeEventEnvelope, serializeEventEnvelope } from "@/domain/events";
import { InMemoryEventTransport } from "@/services/events/in-memory-transport";
import { processEventBatch } from "@/services/events/transport";

function event(sourceReference: string, availableAt = "2026-01-01T00:00:03.000Z") {
  return createEventEnvelope({ eventType: "wallet.buy_detected", entityType: "wallet_transaction", entityId: sourceReference,
    assetId: "asset-1", occurredAt: "2026-01-01T00:00:01.000Z", observedAt: "2026-01-01T00:00:02.000Z", availableAt,
    provider: "test", sourceReference, dataQuality: 90, confidence: 85, payload: { side: "buy", amount: 10 }, correlationId: "correlation-1", causationId: null });
}

describe("versioned event infrastructure", () => {
  it("serializes and restores a complete envelope deterministically", () => { const value = event("tx-1"); expect(deserializeEventEnvelope(serializeEventEnvelope(value))).toEqual(value); });
  it("deduplicates the same external observation", async () => { const transport = new InMemoryEventTransport(); expect(await transport.publish(event("tx-1"))).toBe(true); expect(await transport.publish(event("tx-1"))).toBe(false); });
  it("rejects conflicting content under an existing event identity", async () => { const transport = new InMemoryEventTransport(); const original = event("tx-conflict"); await transport.publish(original); await expect(transport.publish({ ...original, payload: { side: "sell" }, payloadHash: "f".repeat(64) })).rejects.toThrow(/Event identity conflict/); });
  it("orders deliveries by availability and stable event identity", async () => { const transport = new InMemoryEventTransport(() => Date.parse("2026-01-01T00:01:00.000Z")); await transport.publish(event("later", "2026-01-01T00:00:09.000Z")); await transport.publish(event("earlier", "2026-01-01T00:00:04.000Z")); const claimed = await transport.claim({ workerId: "w1", limit: 10, lockTimeoutSeconds: 30 }); expect(claimed.map((item) => item.envelope.sourceReference)).toEqual(["earlier", "later"]); });
  it("retries a failed handler without losing the event", async () => { let now = Date.parse("2026-01-01T00:01:00.000Z"); const transport = new InMemoryEventTransport(() => now); const value = event("retry"); await transport.publish(value); const failed = await processEventBatch(transport, async () => { throw new Error("temporary"); }, { workerId: "w1", retryDelaySeconds: 5 }); expect(failed.failed).toBe(1); expect(transport.diagnostic(value.eventId)?.status).toBe("failed"); now += 5_000; const recovered = await processEventBatch(transport, async () => undefined, { workerId: "w1" }); expect(recovered.processed).toBe(1); expect(transport.diagnostic(value.eventId)?.attempts).toBe(2); });
  it("recovers a stale lock after a worker crash", async () => { let now = Date.parse("2026-01-01T00:01:00.000Z"); const transport = new InMemoryEventTransport(() => now); await transport.publish(event("crash")); expect(await transport.claim({ workerId: "dead-worker", limit: 1, lockTimeoutSeconds: 30 })).toHaveLength(1); now += 31_000; const recovered = await transport.claim({ workerId: "recovery-worker", limit: 1, lockTimeoutSeconds: 30 }); expect(recovered[0]).toMatchObject({ attempt: 2, workerId: "recovery-worker" }); });
});
