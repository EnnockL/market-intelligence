import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest, createEventEnvelope } from "@/domain/events";
import { PostgresOutboxTransport } from "@/services/events/postgres-outbox-transport";
import type { DiscoveredPool, PoolDiscoveryProvider } from "./provider";

export class PoolDiscoveryService {
  private readonly transport: PostgresOutboxTransport;
  constructor(private readonly db: SupabaseClient, private readonly provider: PoolDiscoveryProvider) { this.transport = new PostgresOutboxTransport(db); }

  async run(limit = 20, cutoff = new Date().toISOString()) {
    const batch = await this.provider.discover({ limit: Math.max(1, Math.min(50, limit)), cutoff });
    let observations = 0, assetsCreated = 0, eventsCreated = 0;
    for (const pool of batch.pools) {
      const asset = await this.ensureAsset(pool);
      if (asset.created) assetsCreated++;
      const discoveryKey = deterministicDigest({ provider: pool.provider, sourceReference: pool.sourceReference, mint: pool.mintAddress, pool: pool.poolAddress });
      const saved = await this.db.from("pool_discovery_observations").upsert({ discovery_key: discoveryKey, asset_id: asset.id, chain: pool.chain,
        mint_address: pool.mintAddress, pool_address: pool.poolAddress, provider: pool.provider, source_reference: pool.sourceReference,
        pool_created_at: pool.poolCreatedAt, observed_at: pool.observedAt, available_at: pool.availableAt, price_usd: pool.priceUsd,
        liquidity_usd: pool.liquidityUsd, volume_24h_usd: pool.volume24hUsd, market_cap_usd: pool.marketCapUsd,
        confidence: pool.confidence, data_quality: pool.dataQuality, raw_payload: pool.rawPayload }, { onConflict: "discovery_key", ignoreDuplicates: true }).select("id").maybeSingle();
      if (saved.error) throw saved.error;
      if (!saved.data) continue;
      observations++;
      await this.saveMarketObservation(asset.id, pool);
      eventsCreated += Number(await this.emit(asset.id, saved.data.id, pool, "token.discovered", pool.observedAt));
      eventsCreated += Number(await this.emit(asset.id, saved.data.id, pool, "pool.observed", pool.observedAt));
      if (pool.poolCreatedAt) eventsCreated += Number(await this.emit(asset.id, saved.data.id, pool, "pool.created", pool.poolCreatedAt));
    }
    return { provider: this.provider.name, discovered: batch.pools.length, observations, assetsCreated, eventsCreated, rateLimit: batch.rateLimit,
      providerErrors: batch.providerErrors ?? [] };
  }

  private async ensureAsset(pool: DiscoveredPool) {
    const existing = await this.db.from("crypto_tokens").select("asset_id").eq("mint_address", pool.mintAddress).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.asset_id) return { id: existing.data.asset_id as string, created: false };
    const suffix = deterministicDigest(pool.mintAddress).slice(0, 5).toUpperCase();
    const symbol = (pool.symbol?.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 20) || `SOL-${pool.mintAddress.slice(0, 6)}`) + `-${suffix}`;
    const asset = await this.db.from("assets").insert({ kind: "crypto", symbol, name: pool.name ?? pool.mintAddress, external_id: pool.mintAddress,
      metadata: { discovery_status: "observed", discovery_provider: pool.provider } }).select("id").single();
    if (asset.error) throw asset.error;
    const token = await this.db.from("crypto_tokens").insert({ asset_id: asset.data.id, chain: "solana", mint_address: pool.mintAddress,
      decimals: null, first_seen_at: pool.availableAt });
    if (token.error) throw token.error;
    return { id: asset.data.id as string, created: true };
  }

  private async saveMarketObservation(assetId: string, pool: DiscoveredPool) {
    const saved = await this.db.from("crypto_market_observations").upsert({ asset_id: assetId, provider: pool.provider, observed_at: pool.availableAt,
      provider_timestamp: pool.poolCreatedAt, price_usd: pool.priceUsd, market_cap_usd: pool.marketCapUsd, circulating_supply: null,
      liquidity_usd: pool.liquidityUsd, volume_24h_usd: pool.volume24hUsd, pool_address: pool.poolAddress, confidence: pool.confidence,
      completeness: [pool.priceUsd, pool.liquidityUsd, pool.volume24hUsd, pool.marketCapUsd].every((x) => x !== null) ? "complete" : "partial", raw_payload: pool.rawPayload },
      { onConflict: "asset_id,provider,observed_at", ignoreDuplicates: true });
    if (saved.error) throw saved.error;
  }

  private emit(assetId: string, observationId: string, pool: DiscoveredPool, eventType: string, occurredAt: string) {
    return this.transport.publish(createEventEnvelope({ eventType, entityType: "pool_discovery_observation", entityId: observationId, assetId,
      occurredAt, observedAt: pool.observedAt < occurredAt ? occurredAt : pool.observedAt, availableAt: pool.availableAt,
      provider: pool.provider, sourceReference: `${pool.sourceReference}:${eventType}`, dataQuality: pool.dataQuality, confidence: pool.confidence,
      payload: { mintAddress: pool.mintAddress, poolAddress: pool.poolAddress, poolCreatedAt: pool.poolCreatedAt, liquidityUsd: pool.liquidityUsd,
        volume24hUsd: pool.volume24hUsd, marketCapUsd: pool.marketCapUsd, discoveryOnly: true }, correlationId: assetId, causationId: null }));
  }
}
