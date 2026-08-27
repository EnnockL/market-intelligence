import type { SupabaseClient } from "@supabase/supabase-js";
import { StrategyCandidateTriageService } from "@/services/strategy-validation/candidate-triage-service";

export function runStrategyCandidateTriage(db: SupabaseClient, cutoffAt = new Date().toISOString()) {
  return new StrategyCandidateTriageService(db).run(cutoffAt);
}
