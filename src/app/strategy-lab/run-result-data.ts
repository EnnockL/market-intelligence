import type { SupabaseClient } from "@supabase/supabase-js";
import { readQuery } from "@/data/query-result";
import { isLabRunId, mapLabRun, type LabResultRead } from "./lab-workspace-state";

export async function loadLabRunResult(db: SupabaseClient, requestedId: string | null): Promise<LabResultRead> {
  if (requestedId === null) return { status: "empty", run: null };
  if (!isLabRunId(requestedId)) return { status: "unavailable", run: null };
  const result = await readQuery(db.from("strategy_evaluation_runs")
    .select("id,asset_id,strategy_definition_id,information_cutoff_at,created_at,status,candle_count,setup_count,trade_count,minimum_sample_size,assets(symbol),strategy_definitions(name,version,timeframe),strategy_evaluation_trades(trade_key,entered_at,exited_at,r_multiple,side)")
    .eq("id", requestedId)
    .limit(1000, { referencedTable: "strategy_evaluation_trades" })
    .maybeSingle());
  const run = result.status === "ready" ? mapLabRun(result.data) : null;
  return run?.id === requestedId ? { status: "ready", run } : { status: "unavailable", run: null };
}
