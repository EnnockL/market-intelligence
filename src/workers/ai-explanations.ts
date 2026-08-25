import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIProvider } from "@/services/ai/provider";
import { AIExplanationService } from "@/services/ai/explanation-service";
export async function runAIExplanations(db: SupabaseClient, provider: AIProvider, limit = 5) { return new AIExplanationService(db, provider).run(new Date().toISOString(), limit); }
