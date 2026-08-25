import type { EventEnvelope } from "@/domain/events";

export interface EventDelivery {
  envelope: EventEnvelope;
  attempt: number;
  lockedAt: string;
  workerId: string;
}

export interface EventTransport {
  publish(event: EventEnvelope): Promise<boolean>;
  claim(input: { workerId: string; limit: number; lockTimeoutSeconds: number }): Promise<EventDelivery[]>;
  acknowledge(eventId: string, workerId: string): Promise<boolean>;
  reject(eventId: string, workerId: string, error: Error, retryDelaySeconds: number): Promise<boolean>;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

export async function processEventBatch(transport: EventTransport, handler: EventHandler, input: { workerId: string; limit?: number; lockTimeoutSeconds?: number; retryDelaySeconds?: number }) {
  const deliveries = await transport.claim({ workerId: input.workerId, limit: input.limit ?? 50, lockTimeoutSeconds: input.lockTimeoutSeconds ?? 60 });
  let processed = 0; let failed = 0;
  for (const delivery of deliveries) {
    try {
      await handler(delivery.envelope);
      if (!await transport.acknowledge(delivery.envelope.eventId, input.workerId)) throw new Error(`Lost outbox lock for ${delivery.envelope.eventId}`);
      processed += 1;
    } catch (error) {
      await transport.reject(delivery.envelope.eventId, input.workerId, error instanceof Error ? error : new Error(String(error)), input.retryDelaySeconds ?? 5);
      failed += 1;
    }
  }
  return { claimed: deliveries.length, processed, failed };
}
