import type { SupabaseClient } from "@supabase/supabase-js";
import type { FxObservation, FxLookupResult } from "./provider";
export class FxRepository {
  constructor(private db: SupabaseClient) {}
  async save(rows: FxObservation[]) {
    if (!rows.length) return 0;
    const { error } = await this.db.from("fx_observations").upsert(
      rows.map((x) => ({
        base_currency: x.baseCurrency,
        quote_currency: x.quoteCurrency,
        rate: x.rate,
        effective_at: x.effectiveAt,
        observed_at: x.observedAt,
        available_at: x.availableAt,
        provider: x.provider,
        source_reference: x.sourceReference,
        data_quality: x.dataQuality,
      })),
      { onConflict: "provider,source_reference", ignoreDuplicates: true },
    );
    if (error) throw error;
    return rows.length;
  }
  async lookup(
    base: string,
    quote: string,
    at: string,
    cutoff = at,
  ): Promise<FxLookupResult> {
    const { data, error } = await this.db
      .from("fx_observations")
      .select("*")
      .eq("base_currency", base)
      .eq("quote_currency", quote)
      .lte("effective_at", at)
      .lte("available_at", cutoff)
      .order("effective_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return {
        status: "UNKNOWN",
        observation: null,
        reason: "NO_POINT_IN_TIME_FX",
      };
    return {
      status: "FOUND",
      observation: {
        baseCurrency: data.base_currency,
        quoteCurrency: data.quote_currency,
        rate: Number(data.rate),
        effectiveAt: data.effective_at,
        observedAt: data.observed_at,
        availableAt: data.available_at,
        provider: data.provider,
        sourceReference: data.source_reference,
        dataQuality: data.data_quality,
      },
    };
  }
}
