import type { SupabaseClient } from "@supabase/supabase-js";
import { WalletPromotionService } from "@/services/wallet-promotion/service";

export async function runWalletPromotion(
  db: SupabaseClient,
  cutoffAt = new Date().toISOString(),
) {
  return new WalletPromotionService(db).run(cutoffAt);
}
