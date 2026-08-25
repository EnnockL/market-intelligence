import { z } from "zod";
import { evaluateTokenRisk, type RiskComponent } from "@/domain/token-risk";
import { ProviderError } from "@/services/market-data/provider";
import type { TokenRiskAssessment, TokenRiskProvider } from "./provider";

type Fetcher = typeof fetch;
type RpcEnvelope = { result?: unknown; error?: { code?: number; message?: string } };

const mintSchema = z.object({
  value: z.object({
    data: z.object({
      parsed: z.object({
        info: z.object({
          mintAuthority: z.string().nullable().optional(),
          freezeAuthority: z.string().nullable().optional(),
          supply: z.string().optional(),
          extensions: z.array(z.object({ extension: z.string() }).passthrough()).optional(),
        }).passthrough(),
      }),
    }),
  }).nullable(),
});
const largestSchema = z.object({ value: z.array(z.object({ amount: z.string() })) });
const supplySchema = z.object({ value: z.object({ amount: z.string() }) });

export class SolanaRpcTokenRiskProvider implements TokenRiskProvider {
  readonly name = "solana-rpc-token-risk-v1";
  private readonly cache = new Map<string, TokenRiskAssessment>();

  constructor(private readonly rpcUrl: string, private readonly fetcher: Fetcher = fetch) {}

  async assess(tokenId: string, requestedCutoff: string): Promise<TokenRiskAssessment> {
    const cacheKey = `${tokenId}:${requestedCutoff.slice(0, 13)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const [accountRaw, largestRaw, supplyRaw] = await Promise.all([
      this.rpc("getAccountInfo", [tokenId, { encoding: "jsonParsed", commitment: "finalized" }]),
      this.rpc("getTokenLargestAccounts", [tokenId, { commitment: "finalized" }]),
      this.rpc("getTokenSupply", [tokenId, { commitment: "finalized" }]),
    ]);
    const account = mintSchema.safeParse(accountRaw);
    const largest = largestSchema.safeParse(largestRaw);
    const supply = supplySchema.safeParse(supplyRaw);
    if (!account.success || !largest.success || !supply.success || !account.data.value)
      throw new ProviderError("Solana RPC returned incomplete token risk data", this.name, "invalid_response", false);

    const now = new Date().toISOString();
    const info = account.data.value.data.parsed.info;
    const concentration = concentrationPercent(largest.data.value.map((x) => x.amount), supply.data.value.amount);
    const nonTransferable = info.extensions?.some((x) => x.extension.toLowerCase() === "nontransferable");
    const components: RiskComponent[] = [
      component("mint_authority", info.mintAuthority ?? null, info.mintAuthority ? "warning" : "safe", now, this.name),
      component("freeze_authority", info.freezeAuthority ?? null, info.freezeAuthority ? "critical" : "safe", now, this.name),
      component("holder_concentration_top10", concentration, concentration === null ? "unknown" : concentration >= 80 ? "critical" : concentration >= 50 ? "warning" : "safe", now, this.name),
      component("non_transferable", nonTransferable ?? null, nonTransferable === undefined ? "unknown" : nonTransferable ? "critical" : "safe", now, this.name),
      component("mutable_metadata", null, "unknown", now, this.name),
      component("honeypot", null, "unknown", now, this.name),
      component("known_scam", null, "unknown", now, this.name),
      component("creator_relationship", null, "unknown", now, this.name),
      component("liquidity_removal", null, "unknown", now, this.name),
      component("pool_disappearance", null, "unknown", now, this.name),
      component("extreme_price_collapse", null, "unknown", now, this.name),
    ];
    const evaluated = evaluateTokenRisk(components);
    const assessment: TokenRiskAssessment = {
      tokenId,
      provider: this.name,
      riskVersion: "solana-rpc-risk-components-v1",
      assessedAt: now,
      informationCutoffAt: now,
      informationAvailableAt: now,
      rugRiskScore: evaluated.score,
      rugStatus: evaluated.status,
      riskComponents: { components, requestedCutoff, historicalBackfill: false, limitations: ["NO_HONEYPOT_CLASSIFICATION", "NO_SCAM_REGISTRY", "CURRENT_STATE_ONLY"] },
      dataQuality: evaluated.dataQuality,
    };
    this.cache.set(cacheKey, assessment);
    return assessment;
  }

  private async rpc(method: string, params: unknown[]) {
    for (let attempt = 0; attempt < 4; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(this.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      } catch (cause) {
        throw new ProviderError(`Solana RPC network failure: ${cause instanceof Error ? cause.message : "unknown"}`, this.name, "unavailable", true);
      }
      if (response.status === 429 && attempt < 3) { await delay(Math.min(500 * 2 ** attempt, 4_000)); continue; }
      if (response.status === 429) throw new ProviderError("Solana RPC token risk rate limited", this.name, "rate_limited", true, 429);
      if (!response.ok) throw new ProviderError(`Solana RPC token risk HTTP ${response.status}`, this.name, "unavailable", response.status >= 500, response.status);
      const envelope = await response.json() as RpcEnvelope;
      if (envelope.error) throw new ProviderError(`Solana RPC ${method} failed: ${envelope.error.message ?? envelope.error.code ?? "unknown"}`, this.name, "unavailable", false);
      return envelope.result;
    }
    throw new ProviderError("Solana RPC token risk retry limit reached", this.name, "rate_limited", true, 429);
  }
}

export class FallbackTokenRiskProvider implements TokenRiskProvider {
  readonly name: string;
  constructor(private readonly primary: TokenRiskProvider, private readonly fallback: TokenRiskProvider) { this.name = `${primary.name}->${fallback.name}`; }
  async assess(tokenId: string, cutoff: string) {
    try { return await this.primary.assess(tokenId, cutoff); }
    catch { return this.fallback.assess(tokenId, cutoff); }
  }
}

function concentrationPercent(amounts: string[], supply: string) {
  try {
    const denominator = BigInt(supply);
    if (denominator <= 0n) return null;
    const numerator = amounts.slice(0, 10).reduce((sum, value) => sum + BigInt(value), 0n);
    return Number(numerator * 10_000n / denominator) / 100;
  } catch { return null; }
}
function component(key: string, value: RiskComponent["value"], status: RiskComponent["status"], time: string, source: string): RiskComponent { return { key, value, status, observedAt: time, informationAvailableAt: time, source }; }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
