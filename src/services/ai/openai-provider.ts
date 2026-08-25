import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { ProviderError } from "@/services/market-data/provider";
import type { AIExplanationRequest, AIExplanationResult, AIProvider } from "./provider";

const explanationSchema = z.object({
  summary: z.string().min(1).max(1200),
  reasoning: z.array(z.object({ text: z.string().min(1).max(800), evidenceSourceIds: z.array(z.string()).max(12) })).max(12),
  risks: z.array(z.string().min(1).max(500)).max(12),
  missingData: z.array(z.string().min(1).max(500)).max(12),
  suggestedAction: z.enum(["IGNORE", "WATCH", "ENRICH", "PAPER_TRADE_CANDIDATE", "REQUEST_MORE_DATA"]),
});

export class OpenAIResponsesProvider implements AIProvider {
  readonly name = "openai-responses";
  private readonly client: OpenAI;
  constructor(apiKey: string, readonly model = "gpt-5.4-mini", client?: OpenAI) {
    if (!apiKey) throw new Error("OPENAI_API_KEY_REQUIRED");
    this.client = client ?? new OpenAI({ apiKey, maxRetries: 2, timeout: 30_000 });
  }
  async explain(request: AIExplanationRequest): Promise<AIExplanationResult> {
    const allowedEvidence = new Set(request.evidence.map((item) => item.sourceId));
    try {
      const response = await this.client.responses.parse({
        model: this.model, store: false, max_output_tokens: 1400,
        instructions: "Explain the deterministic market-intelligence assessment concisely. Never invent prices, probabilities, evidence, actions, or missing facts. The deterministic decision is authoritative and cannot be overridden. Cite only supplied sourceId values. PAPER_TRADE_CANDIDATE is research-only and never permission for real execution.",
        input: JSON.stringify(request),
        text: { format: zodTextFormat(explanationSchema, "market_intelligence_explanation") },
      });
      const parsed = response.output_parsed;
      if (!parsed) throw new ProviderError("OpenAI returned no structured explanation", this.name, "invalid_response", true);
      for (const item of parsed.reasoning) if (item.evidenceSourceIds.some((id) => !allowedEvidence.has(id))) throw new ProviderError("OpenAI referenced evidence outside the supplied cutoff", this.name, "invalid_response", false);
      return { ...parsed, provider: this.name, model: response.model ?? this.model, responseId: response.id ?? null, usage: { inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null, totalTokens: response.usage?.total_tokens ?? null } };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const status = error instanceof OpenAI.APIError ? error.status : undefined;
      throw new ProviderError(`OpenAI explanation failed: ${error instanceof Error ? error.message : "unknown error"}`, this.name, status === 429 ? "rate_limited" : status === 401 || status === 403 ? "unauthorized" : "unavailable", status === 429 || status === undefined || status >= 500, status);
    }
  }
}
