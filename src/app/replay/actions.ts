"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireOperatorPage } from "@/lib/operator-session";
import { HistoricalReplayService } from "@/services/historical-replay/service";

export async function runReplay(formData: FormData) {
  await requireOperatorPage("/replay");
  const days = z.coerce.number().int().min(1).max(90).safeParse(formData.get("days"));
  if (!days.success) throw new Error("Replayperioden måste vara 1–90 dagar.");
  const end = new Date(), start = new Date(end.getTime() - days.data * 86_400_000);
  try {
    await new HistoricalReplayService(createServiceClient()).run({ startsAt: start.toISOString(), endsAt: end.toISOString() });
  } catch { throw new Error("Replay kunde inte slutföras. Kontrollera serverns driftlogg."); }
  revalidatePath("/replay");
}
