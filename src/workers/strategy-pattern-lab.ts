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
  return new StrategyPatternLabService(db).run({ ...definition, market: symbol }, asset.id, cutoffAt);
}
