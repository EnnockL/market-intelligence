import type { SupabaseClient } from "@supabase/supabase-js";
import { StrategyResearchCycleService } from "@/services/strategy-validation/research-cycle-service";

export function runAutomatedStrategyResearchCycle(db: SupabaseClient, cutoffAt = new Date().toISOString()) {
  return new StrategyResearchCycleService(db).run(cutoffAt);
}

