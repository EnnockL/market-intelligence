import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareMarket,
  detectNewWalletInflows,
  MARKET_EVENT_POLICY,
  type MarketObservation,
} from "@/domain/market-events";
import { createEventEnvelope, deterministicDigest } from "@/domain/events";
import { PostgresOutboxTransport } from "@/services/events/postgres-outbox-transport";
export class MarketEventProducerService {
  private transport;
  constructor(private db: SupabaseClient) {
    this.transport = new PostgresOutboxTransport(db);
  }
  async run(limit = 100) {
    const { data: rows, error } = await this.db
      .from("crypto_market_observations")
      .select("*")
      .order("observed_at")
      .limit(limit);
    if (error) throw error;
    let emitted = 0,
      evaluated = 0;
    for (const row of rows ?? []) {
      const exists = await this.db
        .from("market_event_producer_evaluations")
        .select("id")
        .eq("observation_id", row.id)
        .eq("producer_version", MARKET_EVENT_POLICY.version)
        .limit(1)
        .maybeSingle();
      if (exists.error) throw exists.error;
      if (exists.data) continue;
      const baselineCutoff = new Date(
          Date.parse(row.observed_at) -
            MARKET_EVENT_POLICY.windowSeconds * 1000,
        ).toISOString(),
        { data: baseline, error: bError } = await this.db
          .from("crypto_market_observations")
          .select("*")
          .eq("asset_id", row.asset_id)
          .eq("provider", row.provider)
          .lte("observed_at", baselineCutoff)
          .order("observed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
      if (bError) throw bError;
      const current = map(row),
        base = baseline ? map(baseline) : null,
        results = compareMarket(current, base);
      if (!base) {
        const first = await this.db
          .from("crypto_market_observations")
          .select("id")
          .eq("asset_id", row.asset_id)
          .order("observed_at")
          .limit(1)
          .single();
        if (first.data?.id === row.id) {
          results.unshift({
            eventType: "token.created",
            reason: null,
            payload: {
              firstObservedAt: row.observed_at,
              provider: row.provider,
              dataQuality: row.confidence,
            },
          });
          if (row.pool_address)
            results.unshift({
              eventType: "pool.created",
              reason: null,
              payload: {
                poolAddress: row.pool_address,
                firstObservedAt: row.observed_at,
                provider: row.provider,
                dataQuality: row.confidence,
              },
            });
        }
      }
      for (const result of results) {
        let eventId: string | null = null;
        if (result.eventType) {
          const event = createEventEnvelope({
            eventType: result.eventType,
            entityType: "crypto_market_observation",
            entityId: row.id,
            assetId: row.asset_id,
            occurredAt: row.provider_timestamp ?? row.observed_at,
            observedAt: row.observed_at,
            availableAt: row.ingested_at,
            provider: row.provider,
            sourceReference: `${row.id}:${result.eventType}:${MARKET_EVENT_POLICY.version}`,
            dataQuality: Math.min(
              current.dataQuality,
              base?.dataQuality ?? current.dataQuality,
            ),
            confidence: Math.min(
              current.dataQuality,
              base?.dataQuality ?? current.dataQuality,
            ),
            payload: result.payload,
            correlationId: row.asset_id,
            causationId: null,
          });
          await this.transport.publish(event);
          eventId = event.eventId;
          emitted++;
        }
        const hash = deterministicDigest({
          observation: row.id,
          type: result.eventType ?? "none",
          reason: result.reason,
          version: MARKET_EVENT_POLICY.version,
        });
        const saved = await this.db
          .from("market_event_producer_evaluations")
          .upsert(
            {
              observation_id: row.id,
              asset_id: row.asset_id,
              producer_type: result.eventType ?? "market.comparison",
              producer_version: MARKET_EVENT_POLICY.version,
              baseline_version: MARKET_EVENT_POLICY.baselineVersion,
              baseline_observation_id: baseline?.id ?? null,
              information_cutoff_at: row.ingested_at,
              available_at: new Date().toISOString(),
              status: result.eventType ? "EVENT_EMITTED" : "NO_EVENT",
              reason: result.reason,
              event_id: eventId,
              details: result.payload,
              evaluation_hash: hash,
            },
            { onConflict: "evaluation_hash", ignoreDuplicates: true },
          );
        if (saved.error) throw saved.error;
        evaluated++;
      }
    }
    const inflows = await this.produceWalletInflows();
    emitted += inflows.emitted;
    evaluated += inflows.evaluated;
    await this.recordUnavailable();
    return { evaluated, emitted };
  }
  private async produceWalletInflows() {
    const [{ data: rows, error }, { count, error: countError }] =
      await Promise.all([
        this.db
          .from("wallet_transactions")
          .select("id,wallet_id,asset_id,occurred_at,ingested_at")
          .eq("side", "buy")
          .not("asset_id", "is", null)
          .order("occurred_at")
          .limit(5000),
        this.db
          .from("wallets")
          .select("id", { count: "exact", head: true })
          .eq("is_tracked", true),
      ]);
    if (error) throw error;
    if (countError) throw countError;
    const results = detectNewWalletInflows(
      (rows ?? []).map((row: any) => ({
        walletId: row.wallet_id,
        assetId: row.asset_id,
        transactionId: row.id,
        occurredAt: row.occurred_at,
        availableAt: row.ingested_at,
      })),
      count ?? 0,
    );
    let emitted = 0,
      evaluated = 0;
    for (const result of results) {
      const assetId = String(result.payload.assetId);
      const transactionIds = result.payload.transactionIds as string[];
      const event = createEventEnvelope({
        eventType: result.eventType!,
        entityType: "wallet_inflow_window",
        entityId: deterministicDigest(transactionIds),
        assetId,
        occurredAt: String(result.payload.currentObservedAt),
        observedAt: String(result.payload.currentObservedAt),
        availableAt: String(result.payload.availableAt),
        provider: "tracked-wallet-observations",
        sourceReference: `${assetId}:${transactionIds.join(":")}:${MARKET_EVENT_POLICY.version}`,
        dataQuality: Number(result.payload.walletObservationCoverage),
        confidence: null,
        payload: result.payload,
        correlationId: assetId,
        causationId: null,
      });
      const inserted = await this.transport.publish(event);
      const hash = deterministicDigest({
        eventId: event.eventId,
        version: MARKET_EVENT_POLICY.version,
      });
      const saved = await this.db
        .from("market_event_producer_evaluations")
        .upsert(
          {
            asset_id: assetId,
            producer_type: result.eventType,
            producer_version: MARKET_EVENT_POLICY.version,
            baseline_version: MARKET_EVENT_POLICY.baselineVersion,
            information_cutoff_at: event.availableAt,
            available_at: event.availableAt,
            status: "EVENT_EMITTED",
            event_id: event.eventId,
            details: result.payload,
            evaluation_hash: hash,
          },
          { onConflict: "evaluation_hash", ignoreDuplicates: true },
        );
      if (saved.error) throw saved.error;
      if (inserted) emitted++;
      evaluated++;
    }
    return { emitted, evaluated };
  }
  private async recordUnavailable() {
    const hash = deterministicDigest({
      producer: "holder_growth",
      version: MARKET_EVENT_POLICY.version,
    });
    await this.db.from("market_event_producer_evaluations").upsert(
      {
        producer_type: "holder.growth",
        producer_version: MARKET_EVENT_POLICY.version,
        baseline_version: MARKET_EVENT_POLICY.baselineVersion,
        information_cutoff_at: new Date().toISOString(),
        available_at: new Date().toISOString(),
        status: "UNAVAILABLE",
        reason: "HOLDER_PROVIDER_UNAVAILABLE",
        details: { producerStatus: "UNAVAILABLE" },
        evaluation_hash: hash,
      },
      { onConflict: "evaluation_hash", ignoreDuplicates: true },
    );
  }
}
function map(row: any): MarketObservation {
  return {
    id: row.id,
    assetId: row.asset_id,
    provider: row.provider,
    observedAt: row.observed_at,
    availableAt: row.ingested_at,
    price: num(row.price_usd),
    volume: num(row.volume_24h_usd),
    liquidity: num(row.liquidity_usd),
    poolAddress: row.pool_address,
    dataQuality: Number(row.confidence),
  };
}
function num(v: any) {
  const n = Number(v);
  return v === null || !Number.isFinite(n) ? null : n;
}
