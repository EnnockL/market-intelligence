import type { SupabaseClient } from "@supabase/supabase-js";
import { createEventEnvelope } from "@/domain/events";
import { canonicalizeNewsUrl, newsContentHash, newsRevisionKey, NEWS_TRUST_VERSION } from "@/domain/news";
import type { NewsProvider } from "./provider";
import { ForecastCatalystService } from "@/services/forecast-catalyst/service";
import { PostgresOutboxTransport } from "@/services/events/postgres-outbox-transport";

export class NewsIngestionService {
  constructor(private db: SupabaseClient, private provider: NewsProvider) {}
  async run(symbols: string[], now = new Date().toISOString(), limit = 50) {
    const from = new Date(Date.parse(now) - 86_400_000).toISOString(), result = await this.provider.fetchNews({ symbols, from, to: now, limit });
    const uniqueSymbols = [...new Set(result.observations.map((item) => item.symbol))];
    const [{ data: assets, error: assetError }, { data: sources, error: sourceError }] = await Promise.all([
      uniqueSymbols.length ? this.db.from("assets").select("id,symbol").eq("kind", "stock").in("symbol", uniqueSymbols) : Promise.resolve({ data: [], error: null }),
      this.db.from("news_sources").select("id,source_classification,domain").eq("active", true),
    ]);
    if (assetError) throw assetError; if (sourceError) throw sourceError;
    const assetBySymbol = new Map((assets ?? []).map((asset: any) => [asset.symbol, asset]));
    const assetIds = (assets ?? []).map((asset: any) => asset.id);
    const { data: existingRows, error: existingError } = assetIds.length ? await this.db.from("news_observations").select("id,asset_id,observation_key,canonical_url").in("asset_id", assetIds).eq("provider", this.provider.name) : { data: [], error: null };
    if (existingError) throw existingError;
    const observationByKey = new Map<string, any>(), observationByCanonical = new Map<string, any>();
    for (const row of existingRows ?? []) { observationByKey.set(`${row.asset_id}:${row.observation_key}`, row); observationByCanonical.set(`${row.asset_id}:${row.canonical_url}`, row); }
    const observationIds = (existingRows ?? []).map((row: any) => row.id);
    const revisionRows: any[] = [];
    for (const observationIdBatch of chunkNewsObservationIds(observationIds)) {
      const revisions = await this.db
        .from("news_article_revisions")
        .select("news_observation_id,revision_number,content_hash")
        .in("news_observation_id", observationIdBatch)
        .order("revision_number", { ascending: false });
      if (revisions.error) throw revisions.error;
      revisionRows.push(...(revisions.data ?? []));
    }
    const latestByObservation = new Map<string, any>(); for (const row of revisionRows ?? []) if (!latestByObservation.has(row.news_observation_id)) latestByObservation.set(row.news_observation_id, row);
    let inserted = 0, revisions = 0, catalysts = 0, unchanged = 0;
    const transport = new PostgresOutboxTransport(this.db), watch = new ForecastCatalystService(this.db);
    for (const item of result.observations) {
      const asset = assetBySymbol.get(item.symbol); if (!asset) continue;
      const canonicalUrl = canonicalizeNewsUrl(item.url), source = matchSource(canonicalUrl, sources ?? []), contentHash = newsContentHash({ headline: item.headline, summary: item.summary, canonicalUrl });
      let observation = observationByKey.get(`${asset.id}:${item.observationKey}`) ?? observationByCanonical.get(`${asset.id}:${canonicalUrl}`);
      if (!observation) {
        const saved = await this.db.from("news_observations").insert({ observation_key: item.observationKey, observation_version: "news-observation-v1", asset_id: asset.id, provider: item.provider, provider_article_id: item.providerArticleId, headline: item.headline, summary: item.summary, url: item.url, canonical_url: canonicalUrl, source_name: item.sourceName, source_id: source?.id ?? null, source_classification: source?.source_classification ?? item.sourceClassification, trust_policy_version: "news-source-trust-v1", occurred_at: item.occurredAt, observed_at: item.observedAt, available_at: item.availableAt, data_quality: item.dataQuality, raw_payload: item.rawPayload }).select("id,asset_id,observation_key,canonical_url").single();
        if (saved.error?.code === "23505") { const retry = await this.db.from("news_observations").select("id,asset_id,observation_key,canonical_url").eq("provider", item.provider).eq("provider_article_id", item.providerArticleId).eq("asset_id", asset.id).single(); if (retry.error) throw retry.error; observation = retry.data; } else { if (saved.error) throw saved.error; observation = saved.data; inserted++; }
        observationByKey.set(`${asset.id}:${item.observationKey}`, observation); observationByCanonical.set(`${asset.id}:${canonicalUrl}`, observation);
      }
      const observationId = observation.id as string, latest = latestByObservation.get(observationId);
      if (latest?.content_hash === contentHash) { unchanged++; continue; }
      const revisionNumber = (latest?.revision_number ?? 0) + 1, revisionKey = newsRevisionKey({ observationId, contentHash });
      const revisionSaved = await this.db.from("news_article_revisions").insert({ revision_key: revisionKey, news_observation_id: observationId, revision_number: revisionNumber, headline: item.headline, summary: item.summary, canonical_url: canonicalUrl, content_hash: contentHash, occurred_at: item.occurredAt, observed_at: item.observedAt, available_at: item.availableAt, provider: item.provider, provider_article_id: item.providerArticleId, source_id: source?.id ?? null, source_classification: source?.source_classification ?? item.sourceClassification, evidence_refs: [], raw_payload: item.rawPayload }).select("id").single();
      if (revisionSaved.error?.code === "23505") { unchanged++; continue; } if (revisionSaved.error) throw revisionSaved.error;
      latestByObservation.set(observationId, { revision_number: revisionNumber, content_hash: contentHash }); revisions++;
      const revisionId = revisionSaved.data.id as string, entity = await this.db.from("news_entity_matches").insert({ news_revision_id: revisionId, entity_type: "asset", entity_id: asset.id, match_method: "PROVIDER_SYMBOL", confidence: 100, available_at: item.availableAt, match_version: "news-entity-match-v1" }); if (entity.error) throw entity.error;
      const event = createEventEnvelope({ eventType: revisionNumber === 1 ? "news.observed" : "news.revised", entityType: "news_revision", entityId: revisionId, assetId: asset.id, occurredAt: item.occurredAt, observedAt: item.observedAt, availableAt: item.availableAt, provider: item.provider, sourceReference: canonicalUrl, dataQuality: item.dataQuality, confidence: null, payload: { headline: item.headline, sourceName: item.sourceName, sourceClassification: source?.source_classification ?? item.sourceClassification, observationId, revisionNumber, contentHash, trustVersion: NEWS_TRUST_VERSION }, correlationId: observationId, causationId: null }); await transport.publish(event);
      if (revisionNumber === 1) { const catalyst = await watch.ingest({ assetId: asset.id, catalystType: "NEWS_OBSERVATION", materiality: "UNKNOWN", novelty: "UNKNOWN", sourceClassification: source?.source_classification ?? item.sourceClassification, sourceConfidence: null, watchWindow: "SHORT", occurredAt: item.occurredAt, observedAt: item.observedAt, availableAt: item.availableAt, sourceReference: canonicalUrl, evidenceRefs: [event.eventId], details: { newsObservationId: observationId, newsRevisionId: revisionId, headline: item.headline, producerAssessment: "NONE" } }); if (!catalyst.reused) catalysts++; }
    }
    return { fetched: result.observations.length, inserted, revisions, unchanged, catalysts, remaining: result.remaining, resetAt: result.resetAt };
  }
}
function matchSource(canonicalUrl: string, sources: any[]) { let domain: string; try { domain = new URL(canonicalUrl).hostname.replace(/^www\./, ""); } catch { return null; } return sources.filter((row) => domain === row.domain || domain.endsWith(`.${row.domain}`)).sort((a, b) => b.domain.length - a.domain.length)[0] ?? null; }

export function chunkNewsObservationIds(ids: string[], size = 100) {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += size)
    batches.push(ids.slice(index, index + size));
  return batches;
}
