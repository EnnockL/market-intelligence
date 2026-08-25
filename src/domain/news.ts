import { deterministicDigest } from "@/domain/events";
import type { SourceClassification } from "@/domain/forecast";

export const NEWS_OBSERVATION_VERSION = "news-observation-v1";
export const NEWS_TRUST_VERSION = "news-trust-v1.1";

export interface NewsObservation {
  observationKey: string; provider: string; providerArticleId: string; symbol: string;
  headline: string; summary: string | null; url: string; sourceName: string;
  sourceClassification: SourceClassification; occurredAt: string; observedAt: string; availableAt: string;
  dataQuality: number; rawPayload: Record<string, unknown>;
}

const officialDomains = new Set(["sec.gov", "investor.gov"]);
const primaryDomains = new Set(["reuters.com", "apnews.com", "bloomberg.com", "ft.com", "wsj.com"]);

export function classifyNewsSource(url: string): SourceClassification {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "UNKNOWN"; }
  if ([...officialDomains].some((domain) => host === domain || host.endsWith(`.${domain}`))) return "OFFICIAL_SOURCE";
  if ([...primaryDomains].some((domain) => host === domain || host.endsWith(`.${domain}`))) return "PRIMARY_MEDIA";
  return "REPUTABLE_SECONDARY";
}

export function newsObservationKey(input: { provider: string; providerArticleId: string; symbol: string }) {
  return deterministicDigest({ version: NEWS_OBSERVATION_VERSION, ...input });
}

export function canonicalizeNewsUrl(value:string){
  try{const url=new URL(value);url.hash="";url.hostname=url.hostname.toLowerCase().replace(/^www\./,"");for(const key of [...url.searchParams.keys()])if(key.startsWith("utm_")||["gclid","fbclid","ref"].includes(key))url.searchParams.delete(key);url.searchParams.sort();url.pathname=url.pathname.replace(/\/+$/,"")||"/";return url.toString()}catch{return value.trim()}
}
export function newsContentHash(input:{headline:string;summary:string|null;canonicalUrl:string}){return deterministicDigest({version:NEWS_TRUST_VERSION,headline:input.headline.trim(),summary:input.summary?.trim()??null,canonicalUrl:input.canonicalUrl})}
export function newsRevisionKey(input:{observationId:string;contentHash:string}){return deterministicDigest({version:NEWS_TRUST_VERSION,...input})}
