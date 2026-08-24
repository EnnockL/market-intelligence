import type { SupabaseClient } from "@supabase/supabase-js";
import { ASIA_NY_SWEEP_REVERSAL_V1 } from "@/domain/strategy-pattern-lab";
import { StrategyPatternLabService } from "@/services/strategy-pattern-lab/service";

export async function runStrategyPatternLab(db: SupabaseClient, symbol = process.env.STRATEGY_ASSET_SYMBOL ?? "XAUUSD", cutoffAt = new Date().toISOString()) {
  const { data: asset, error } = await db.from("assets").select("id,symbol").eq("symbol", symbol).maybeSingle();
  if (error) throw error;
  if (!asset) return { status: "INSUFFICIENT_DATA", reason: "ASSET_NOT_REGISTERED", symbol };
  return new StrategyPatternLabService(db).run({ ...ASIA_NY_SWEEP_REVERSAL_V1, market: symbol }, asset.id, cutoffAt);
}
