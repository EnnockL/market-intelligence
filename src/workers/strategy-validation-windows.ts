import type { SupabaseClient } from "@supabase/supabase-js";
import { ValidationAutomationService } from "@/services/strategy-validation/automation-service";
export async function runStrategyValidationWindows(
  db: SupabaseClient,
  cutoffAt = new Date().toISOString(),
) {
  return new ValidationAutomationService(db).plan(cutoffAt);
}
