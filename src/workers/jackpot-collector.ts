import { hostname } from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { PostgresOutboxTransport } from "@/services/events/postgres-outbox-transport";
import { processEventBatch } from "@/services/events/transport";
import { JackpotCollectorService } from "@/services/jackpot-collector/service";
export async function runJackpotCollector(
  db: SupabaseClient,
  repository: IngestionRepository,
) {
  const runId = await repository.startRun(
    "jackpot_collector",
    "postgres-outbox",
  );
  try {
    const service = new JackpotCollectorService(db),
      transport = new PostgresOutboxTransport(db, {
        name: "jackpot-collector-v1",
        eventTypes: [
          "wallet.buy_detected",
          "token.created",
          "pool.created",
          "opportunity.fast_created",
          "market.liquidity_added",
          "market.liquidity_removed",
          "market.volume_accelerated",
          "market.price_accelerated",
          "market.new_wallet_inflow",
          "holder.growth",
        ],
      });
    const result = await processEventBatch(
      transport,
      (e) => service.handle(e).then(() => undefined),
      {
        workerId: `${hostname()}-${process.pid}`,
        limit: 100,
        lockTimeoutSeconds: 60,
        retryDelaySeconds: 10,
      },
    );
    await repository.finishRun(runId, result.processed);
    return { runId, ...result };
  } catch (error) {
    await repository.failRun(runId, error);
    throw error;
  }
}
