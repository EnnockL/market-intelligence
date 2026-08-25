import { z } from "zod";
import { evaluateTokenRisk, type RiskComponent } from "@/domain/token-risk";
import { ProviderError } from "@/services/market-data/provider";
import type { TokenRiskAssessment, TokenRiskProvider } from "./provider";
const securitySchema = z.object({ success: z.boolean().optional(), data: z.object({ ownerAddress: z.string().nullable().optional(), freezeAuthority: z.string().nullable().optional(), freezeable: z.boolean().nullable().optional(), mutableMetadata: z.boolean().nullable().optional(), top10HolderPercent: z.number().nullable().optional(), top10HolderPercentage: z.number().nullable().optional(), honeypot: z.boolean().nullable().optional(), isScam: z.boolean().nullable().optional(), nonTransferable: z.boolean().nullable().optional(), creatorAddress: z.string().nullable().optional() }).passthrough() });
type Fetch = typeof fetch;
export class BirdeyeTokenRiskProvider implements TokenRiskProvider {
  readonly name = "birdeye-token-security-v1"; private readonly cache = new Map<string, TokenRiskAssessment>();
  constructor(private readonly apiKey: string, private readonly fetcher: Fetch = fetch, private readonly baseUrl = "https://public-api.birdeye.so") {}
  async assess(tokenId: string, cutoff: string) { const key = `${tokenId}:${cutoff.slice(0, 13)}`; const cached = this.cache.get(key); if (cached) return cached;
    const url = new URL(`${this.baseUrl}/defi/token_security`); url.searchParams.set("address", tokenId); const response = await this.request(url); const parsed = securitySchema.safeParse(await response.json()); if (!parsed.success) throw new ProviderError("Birdeye returned invalid token security", this.name, "invalid_response", false);
    const now = new Date().toISOString(); const data = parsed.data.data; const concentration = data.top10HolderPercent ?? data.top10HolderPercentage ?? null;
    const components: RiskComponent[] = [
      component("mint_authority", data.ownerAddress ?? null, data.ownerAddress === undefined ? "unknown" : data.ownerAddress ? "warning" : "safe", now, this.name),
      component("freeze_authority", data.freezeAuthority ?? null, data.freezeAuthority === undefined && data.freezeable === undefined ? "unknown" : data.freezeable || data.freezeAuthority ? "critical" : "safe", now, this.name),
      component("holder_concentration_top10", concentration, concentration === null ? "unknown" : concentration >= 80 ? "critical" : concentration >= 50 ? "warning" : "safe", now, this.name),
      component("mutable_metadata", data.mutableMetadata ?? null, data.mutableMetadata === undefined ? "unknown" : data.mutableMetadata ? "warning" : "safe", now, this.name),
      component("non_transferable", data.nonTransferable ?? null, data.nonTransferable === undefined ? "unknown" : data.nonTransferable ? "critical" : "safe", now, this.name),
      component("honeypot", data.honeypot ?? null, data.honeypot === undefined ? "unknown" : data.honeypot ? "critical" : "safe", now, this.name),
      component("known_scam", data.isScam ?? null, data.isScam === undefined ? "unknown" : data.isScam ? "critical" : "safe", now, this.name),
      component("creator_relationship", data.creatorAddress ?? null, data.creatorAddress === undefined ? "unknown" : "safe", now, this.name),
      component("liquidity_removal", null, "unknown", now, this.name), component("pool_disappearance", null, "unknown", now, this.name), component("extreme_price_collapse", null, "unknown", now, this.name),
    ]; const result = evaluateTokenRisk(components); const assessment: TokenRiskAssessment = { tokenId, provider: this.name, riskVersion: "birdeye-risk-components-v1", assessedAt: now, informationCutoffAt: now, informationAvailableAt: now, rugRiskScore: result.score, rugStatus: result.status, riskComponents: { components, requestedCutoff: cutoff, historicalBackfill: false }, dataQuality: result.dataQuality }; this.cache.set(key, assessment); return assessment; }
  private async request(url: URL) { for (let attempt = 0; attempt < 4; attempt++) { const response = await this.fetcher(url, { headers: { accept: "application/json", "x-chain": "solana", "X-API-KEY": this.apiKey } }); if (response.status === 429 && attempt < 3) { await delay(Math.min(1000 * 2 ** attempt, 8000)); continue; } if (response.status === 429) throw new ProviderError("Birdeye security rate limit reached", this.name, "rate_limited", true, 429); if (response.status === 401 || response.status === 403) throw new ProviderError("Birdeye security authorization failed", this.name, "unauthorized", false, response.status); if (!response.ok) throw new ProviderError(`Birdeye security HTTP ${response.status}`, this.name, "unavailable", response.status >= 500, response.status); return response; } throw new ProviderError("Birdeye security retry limit reached", this.name, "rate_limited", true, 429); }
}
function component(key: string, value: RiskComponent["value"], status: RiskComponent["status"], time: string, source: string): RiskComponent { return { key, value, status, observedAt: time, informationAvailableAt: time, source }; }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
