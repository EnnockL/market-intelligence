import type { SupabaseClient } from "@supabase/supabase-js";
import { ORB_RETEST_15M_V1, TOP_TEN_RESEARCH_STRATEGIES, type StrategyDefinition } from "@/domain/strategy-pattern-lab";
import { StrategyPatternLabService } from "@/services/strategy-pattern-lab/service";

const STRATEGIES: Record<string, StrategyDefinition> = Object.fromEntries(TOP_TEN_RESEARCH_STRATEGIES.map(strategy => [strategy.strategyId, strategy]));

export async function runStrategyPatternLab(db: SupabaseClient, symbol = process.env.STRATEGY_ASSET_SYMBOL ?? "AMD", cutoffAt = new Date().toISOString(), strategyId = process.env.STRATEGY_ID ?? ORB_RETEST_15M_V1.strategyId) {
  const definition = STRATEGIES[strategyId];
  if (!definition) return { status: "INSUFFICIENT_DATA", reason: "STRATEGY_NOT_REGISTERED", strategyId };
  const { data: asset, error } = await db.from("assets").select("id,symbol").eq("symbol", symbol).maybeSingle();
  if (error) throw error;
  if (!asset) return { status: "INSUFFICIENT_DATA", reason: "ASSET_NOT_REGISTERED", symbol };
  return new StrategyPatternLabService(db).run(definition, asset.id, cutoffAt);
}

export async function runStrategyResearchCycle(db: SupabaseClient, cutoffAt = new Date().toISOString()) {
  const assetsResult = await db.from("assets").select("id,symbol,kind").eq("kind", "stock").order("symbol");
  if (assetsResult.error) throw assetsResult.error;
  const assets = assetsResult.data ?? [];
  if (!assets.length) return { status: "INSUFFICIENT_DATA", reason: "NO_STOCK_ASSETS" };

  const stockStrategies = TOP_TEN_RESEARCH_STRATEGIES.filter(strategy => strategy.market === "US_STOCKS" || strategy.market === "GENERIC");
  const recentResult = await db.from("strategy_evaluation_runs")
    .select("asset_id,information_cutoff_at,strategy_definitions(strategy_key,version)")
    .order("information_cutoff_at", { ascending: false })
    .limit(500);
  if (recentResult.error) throw recentResult.error;

  const latest = new Map<string, string>();
  for (const row of recentResult.data ?? []) {
    const definition = Array.isArray(row.strategy_definitions) ? row.strategy_definitions[0] : row.strategy_definitions;
    const typedDefinition = definition as { strategy_key?: string; version?: number } | null;
    const strategyKey = typedDefinition?.strategy_key;
    if (!strategyKey) continue;
    const key = `${row.asset_id}:${strategyKey}:${typedDefinition?.version ?? 1}`;
    if (!latest.has(key)) latest.set(key, row.information_cutoff_at);
  }

  const combinations = assets.flatMap(asset => stockStrategies.map((strategy, priority) => ({ asset, strategy, priority, lastRunAt: latest.get(`${asset.id}:${strategy.strategyId}:${strategy.version}`) ?? null })));
  combinations.sort((a, b) => {
    if (a.lastRunAt === null && b.lastRunAt !== null) return -1;
    if (a.lastRunAt !== null && b.lastRunAt === null) return 1;
    if (a.lastRunAt !== b.lastRunAt) return (a.lastRunAt ?? "").localeCompare(b.lastRunAt ?? "");
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.asset.symbol.localeCompare(b.asset.symbol);
  });
  const next = combinations[0];
  if (!next) return { status: "INSUFFICIENT_DATA", reason: "NO_COMPATIBLE_STRATEGIES" };
  const result = await new StrategyPatternLabService(db).run(next.strategy, next.asset.id, cutoffAt);
  return { ...result, symbol: next.asset.symbol, strategyId: next.strategy.strategyId, previousRunAt: next.lastRunAt };
}
