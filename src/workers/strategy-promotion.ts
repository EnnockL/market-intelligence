import type { SupabaseClient } from "@supabase/supabase-js";
import { StrategyPromotionService } from "@/services/strategy-validation/promotion-service";
export function runStrategyPromotion(db:SupabaseClient,cutoffAt=new Date().toISOString()){return new StrategyPromotionService(db).run(cutoffAt)}
