import type { SupabaseClient } from "@supabase/supabase-js";
import { StrategyIntelligenceService } from "@/services/strategy-intelligence/service";

export async function runStrategyIntelligence(db: SupabaseClient, cutoffAt = new Date().toISOString()) {
  const service = new StrategyIntelligenceService(db);
  const runs = await db.from("strategy_evaluation_runs").select("id,asset_id,information_cutoff_at,strategy_definitions(timeframe)").lte("information_cutoff_at", cutoffAt).order("information_cutoff_at", { ascending: false }).limit(100);
  if (runs.error) throw runs.error;
  const researched = [];
  for (const run of runs.data ?? []) researched.push(await service.researchEvaluation(run.id, "VALIDATION"));
  const latest: any = runs.data?.[0];
  if (!latest) return { status: "INSUFFICIENT_DATA", reason: "NO_STRATEGY_EVALUATIONS", researched: 0 };
  const asset = await db.from("assets").select("id,symbol,kind").eq("id", latest.asset_id).single();
  if (asset.error) throw asset.error;
  const definition: any = latest.strategy_definitions;
  const selected = await service.select({ assetId: asset.data.id, asset: asset.data.symbol, assetClass: String(asset.data.kind).toUpperCase(), timeframe: definition.timeframe, session: "UNKNOWN", regime: "UNKNOWN", volatilityBucket: "UNKNOWN", liquidityBucket: "UNKNOWN", cutoffAt, minimumSampleSize: 30 });
  return { status: selected.result.status, researched: researched.length, selectorRunId: selected.selectorRunId, selected: selected.result.selectedStrategy };
}
