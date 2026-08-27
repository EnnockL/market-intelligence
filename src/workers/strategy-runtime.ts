import type { SupabaseClient } from "@supabase/supabase-js";
import { StrategyRuntimeService } from "@/services/strategy-runtime/service";
export const runStrategySignalProducer = (
  db: SupabaseClient,
  cutoffAt = new Date().toISOString(),
) => new StrategyRuntimeService(db).produce(cutoffAt);
export const runStrategyShadowExecution = (
  db: SupabaseClient,
  cutoffAt = new Date().toISOString(),
) => new StrategyRuntimeService(db).advance(cutoffAt);
