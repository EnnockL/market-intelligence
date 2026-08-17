import type { EventEnvelope } from "@/domain/events";
import type { EventDelivery, EventTransport } from "./transport";

type MemoryRecord = { envelope: EventEnvelope; status: "pending" | "processing" | "processed" | "failed"; attempts: number; nextAttemptAt: number; lockedAt: number | null; lockedBy: string | null; processedAt: number | null; lastError: string | null };

export class InMemoryEventTransport implements EventTransport {
  private readonly records = new Map<string, MemoryRecord>();
  constructor(private readonly now: () => number = Date.now) {}

  async publish(envelope: EventEnvelope) {
    const existing = this.records.get(envelope.eventId);
    if (existing) { if (existing.envelope.payloadHash !== envelope.payloadHash || existing.envelope.eventType !== envelope.eventType || existing.envelope.schemaVersion !== envelope.schemaVersion) throw new Error(`Event identity conflict: ${envelope.eventId}`); return false; }
    this.records.set(envelope.eventId, { envelope, status: "pending", attempts: 0, nextAttemptAt: this.now(), lockedAt: null, lockedBy: null, processedAt: null, lastError: null }); return true;
  }
  async claim(input: { workerId: string; limit: number; lockTimeoutSeconds: number }): Promise<EventDelivery[]> {
    const current = this.now();
    const candidates = [...this.records.values()].filter((record) => ((record.status === "pending" || record.status === "failed") && record.nextAttemptAt <= current) || (record.status === "processing" && record.lockedAt !== null && record.lockedAt < current - input.lockTimeoutSeconds * 1000))
      .sort((a, b) => a.envelope.availableAt.localeCompare(b.envelope.availableAt) || a.envelope.eventId.localeCompare(b.envelope.eventId)).slice(0, input.limit);
    return candidates.map((record) => { record.status = "processing"; record.attempts += 1; record.lockedAt = current; record.lockedBy = input.workerId; record.lastError = null; return { envelope: record.envelope, attempt: record.attempts, lockedAt: new Date(current).toISOString(), workerId: input.workerId }; });
  }
  async acknowledge(eventId: string, workerId: string) { const record = this.records.get(eventId); if (!record || record.status !== "processing" || record.lockedBy !== workerId) return false; record.status = "processed"; record.processedAt = this.now(); record.lockedAt = null; record.lockedBy = null; return true; }
  async reject(eventId: string, workerId: string, error: Error, retryDelaySeconds: number) { const record = this.records.get(eventId); if (!record || record.status !== "processing" || record.lockedBy !== workerId) return false; record.status = "failed"; record.nextAttemptAt = this.now() + retryDelaySeconds * 1000; record.lastError = error.message; record.lockedAt = null; record.lockedBy = null; return true; }
  diagnostic(eventId: string) { const record = this.records.get(eventId); return record ? { ...record } : null; }
}
