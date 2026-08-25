import type { NewsObservation } from "@/domain/news";

export interface NewsRequest { symbols: string[]; from: string; to: string; limit: number; }
export interface NewsProviderResult { observations: NewsObservation[]; remaining: number | null; resetAt: string | null; }
export interface NewsProvider { readonly name: string; fetchNews(request: NewsRequest): Promise<NewsProviderResult>; }

export class NewsProviderError extends Error {
  constructor(message: string, public readonly provider: string, public readonly code: "unauthorized"|"rate_limited"|"invalid_response"|"unavailable", public readonly retryable: boolean, public readonly status: number|null=null, public readonly retryAfterMs: number|null=null) { super(message); this.name="NewsProviderError"; }
}
