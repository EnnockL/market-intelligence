import type { SupabaseClient } from "@supabase/supabase-js";
import { ValidationAutomationService } from "@/services/strategy-validation/automation-service";
export async function runStrategyShadowTracking(
  db: SupabaseClient,
  cutoffAt = new Date().toISOString(),
) {
  return new ValidationAutomationService(db).track(cutoffAt);
}
