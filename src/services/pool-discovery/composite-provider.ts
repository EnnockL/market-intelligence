import type { DiscoveredPool, PoolDiscoveryBatch, PoolDiscoveryProvider } from "./provider";

export class CompositePoolDiscoveryProvider implements PoolDiscoveryProvider {
  readonly name = "solana-pool-discovery-v1";
  constructor(private readonly providers: PoolDiscoveryProvider[]) {}
  async discover(input: { limit: number; cutoff: string }): Promise<PoolDiscoveryBatch> {
    const settled = await Promise.allSettled(this.providers.map((provider) => provider.discover(input)));
    const successful = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (!successful.length) throw (settled[0] as PromiseRejectedResult).reason;
    const providerErrors = settled.flatMap((result, index) => result.status === "rejected" ? [{ provider: this.providers[index].name,
      message: result.reason instanceof Error ? result.reason.message : String(result.reason), retryable: Boolean(result.reason?.retryable) }] : []);
    const selected = new Map<string, DiscoveredPool>();
    for (const pool of successful.flatMap((batch) => batch.pools)) {
      const key = `${pool.mintAddress}:${pool.poolAddress ?? "unknown"}`;
      const current = selected.get(key);
      if (!current || pool.dataQuality > current.dataQuality || (pool.dataQuality === current.dataQuality && pool.provider < current.provider)) selected.set(key, pool);
    }
    return { pools: [...selected.values()].sort((a, b) => b.dataQuality - a.dataQuality || a.sourceReference.localeCompare(b.sourceReference)).slice(0, input.limit),
      rateLimit: { remaining: null, resetAt: null }, providerErrors };
  }
}
