"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireOperatorPage } from "@/lib/operator-session";
import { SimulationService } from "@/services/simulation/service";

const schema = z.object({
  days: z.coerce.number().int().min(1).max(90),
  capital: z.coerce.number().min(100).max(10_000_000),
  policy: z.enum(["FIXED_SMALL", "EQUITY_1_PERCENT", "INDEPENDENCE_REQUIRED", "EARLY_DETECTION"]),
  delay: z.coerce.number().int().min(0).max(86_400_000),
  liquidity: z.coerce.number().gt(0).max(100),
});

export async function runSimulation(formData: FormData) {
  await requireOperatorPage("/simulation");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Kontrollera simulationens period och riskantaganden.");
  const values = parsed.data, end = new Date(), start = new Date(end.getTime() - values.days * 86_400_000);
  try {
    await new SimulationService(createServiceClient()).run({ initialCapitalSek: values.capital, startsAt: start.toISOString(), endsAt: end.toISOString(), policy: values.policy, entryDelayMs: values.delay, maxLiquidityParticipationPct: values.liquidity });
  } catch { throw new Error("Simulationen kunde inte slutföras. Kontrollera serverns driftlogg."); }
  revalidatePath("/simulation");
}
