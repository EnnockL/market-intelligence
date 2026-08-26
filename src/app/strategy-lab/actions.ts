"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { StrategyPatternLabService } from "@/services/strategy-pattern-lab/service";
import { HistoricalCandleService } from "@/services/candles/service";
import { FinnhubCandleProvider } from "@/services/candles/finnhub-candle-provider";
import { GeckoTerminalCandleProvider } from "@/services/candles/geckoterminal-candle-provider";
import type { StrategyDefinition } from "@/domain/strategy-pattern-lab";

export type LabActionState = {
  status: "IDLE" | "SUCCESS" | "ERROR";
  message: string;
  values?: {
    definitionId?: string;
    assetId?: string;
    startsAt?: string;
    endsAt?: string;
  };
};
const runSchema = z.object({ definitionId: z.string().uuid(), assetId: z.string().uuid(), startsAt: z.string().date(), endsAt: z.string().date() });

export async function runBacktest(_: LabActionState, formData: FormData): Promise<LabActionState> {
  const values = {
    definitionId: String(formData.get("definitionId") ?? ""),
    assetId: String(formData.get("assetId") ?? ""),
    startsAt: String(formData.get("startsAt") ?? ""),
    endsAt: String(formData.get("endsAt") ?? ""),
  };
  const parsed = runSchema.safeParse(values);
  if (!parsed.success) return { status: "ERROR", message: "Kontrollera strategi, asset och datum.", values };
  const startsAt = `${parsed.data.startsAt}T00:00:00.000Z`, endsAt = `${parsed.data.endsAt}T23:59:59.999Z`;
  if (startsAt > endsAt || Date.parse(endsAt) - Date.parse(startsAt) > 2 * 366 * 86_400_000) return { status: "ERROR", message: "Perioden måste vara 1–732 dagar.", values };
  const db = createServiceClient();
  const [definitionResult, assetResult] = await Promise.all([db.from("strategy_definitions").select("definition,timeframe").eq("id", parsed.data.definitionId).eq("status", "ACTIVE").single(), db.from("assets").select("id,symbol").eq("id", parsed.data.assetId).eq("is_active", true).single()]);
  if (definitionResult.error || assetResult.error) return { status: "ERROR", message: "Strategin eller asseten är inte tillgänglig.", values };
  try {
    const candleCheck = await db.from("market_candles").select("id", { count: "exact", head: true }).eq("asset_id", assetResult.data.id).eq("timeframe", definitionResult.data.timeframe).gte("opened_at", startsAt).lte("closed_at", endsAt).lte("available_at", endsAt);
    if (candleCheck.error) throw candleCheck.error;
    if (!candleCheck.count) return { status: "ERROR", message: `${assetResult.data.symbol} saknar ${definitionResult.data.timeframe}-candles i den valda perioden. Välj en konfigurerad asset eller importera dess candle-källa först.`, values };
    const result = await new StrategyPatternLabService(db).run(definitionResult.data.definition as StrategyDefinition, assetResult.data.id, endsAt, startsAt);
    revalidatePath("/strategy-lab");
    return { status: "SUCCESS", message: `${assetResult.data.symbol}: ${result.evaluation.candleCount} candles, ${result.evaluation.setupCount} setups och ${result.evaluation.tradeCount} trades.`, values };
  } catch (error) { return { status: "ERROR", message: error instanceof Error ? error.message : "Backtest kunde inte köras.", values }; }
}

export async function syncCandleSource(_: LabActionState, formData: FormData): Promise<LabActionState> {
  const sourceId = z.string().uuid().safeParse(formData.get("sourceId"));
  if (!sourceId.success) return { status: "ERROR", message: "Ogiltig candle source." };
  const db = createServiceClient(), sourceResult = await db.from("candle_sources").select("*").eq("id", sourceId.data).eq("enabled", true).single();
  if (sourceResult.error) return { status: "ERROR", message: "Candle source är inte tillgänglig." };
  const source = sourceResult.data, now = new Date().toISOString();
  try {
    const provider = source.provider === "geckoterminal-ohlcv" ? new GeckoTerminalCandleProvider() : new FinnhubCandleProvider(process.env.FINNHUB_API_KEY ?? "");
    const result = await new HistoricalCandleService(db, provider).sync({ assetId: source.asset_id, instrumentKind: source.instrument_kind, providerSymbol: source.provider_symbol, timeframe: source.timeframe, startsAt: source.backfill_starts_at, endsAt: now, cursor: source.cursor, limit: 500, tokenSide: source.token_side ?? undefined }, 3);
    await db.from("candle_sources").update({ cursor: result.nextCursor, last_successful_sync: result.status === "COMPLETED" ? now : source.last_successful_sync, last_error: null, status: result.status === "COMPLETED" ? "HEALTHY" : "PENDING", consecutive_failures: 0, updated_at: now }).eq("id", source.id);
    revalidatePath("/strategy-lab");
    return { status: "SUCCESS", message: `${result.fetched} candles hämtades, ${result.inserted} nya sparades.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Importen misslyckades.";
    await db.from("candle_sources").update({ status: "DEGRADED", last_error: message, consecutive_failures: Number(source.consecutive_failures ?? 0) + 1, updated_at: now }).eq("id", source.id);
    revalidatePath("/strategy-lab"); return { status: "ERROR", message };
  }
}
