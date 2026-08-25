import { describe, expect, it, vi } from "vitest";
import { OpenAIResponsesProvider } from "../src/services/ai/openai-provider";

const request = {
  entityType: "META_ASSESSMENT" as const, entityId: "assessment-1", assetId: "asset-1", assetSymbol: "AMD",
  informationCutoffAt: "2026-08-24T12:00:00.000Z", deterministicDecision: "WATCH", deterministicReason: "Liquidity is unknown", dataQuality: 72,
  context: { policyVersion: "meta-agent-policy-v1" },
  evidence: [{ sourceId: "meta-requirement:1", observedAt: "2026-08-24T11:59:00.000Z", availableAt: "2026-08-24T12:00:00.000Z", sourceType: "META_REQUIREMENT", excerpt: "LIQUIDITY: UNKNOWN" }],
};

describe("OpenAI Responses explanation provider", () => {
  it("returns a traceable structured explanation and disables provider storage", async () => {
    const parse = vi.fn().mockResolvedValue({ id: "resp_1", model: "gpt-5.4-mini", output_parsed: { summary: "Watch while liquidity remains unknown.", reasoning: [{ text: "Liquidity evidence is missing.", evidenceSourceIds: ["meta-requirement:1"] }], risks: ["Unknown liquidity"], missingData: ["Point-in-time liquidity"], suggestedAction: "REQUEST_MORE_DATA" }, usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } });
    const result = await new OpenAIResponsesProvider("test-key", "gpt-5.4-mini", { responses: { parse } } as never).explain(request);
    expect(result).toMatchObject({ provider: "openai-responses", responseId: "resp_1", suggestedAction: "REQUEST_MORE_DATA", usage: { totalTokens: 140 } });
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ store: false, model: "gpt-5.4-mini" }));
  });

  it("rejects evidence references that were not supplied point-in-time", async () => {
    const parse = vi.fn().mockResolvedValue({ id: "resp_2", model: "gpt-5.4-mini", output_parsed: { summary: "Bad citation", reasoning: [{ text: "Future claim", evidenceSourceIds: ["future-source"] }], risks: [], missingData: [], suggestedAction: "WATCH" }, usage: null });
    await expect(new OpenAIResponsesProvider("test-key", "gpt-5.4-mini", { responses: { parse } } as never).explain(request)).rejects.toMatchObject({ code: "invalid_response", retryable: false });
  });

  it("classifies provider failures as retryable without inventing output", async () => {
    const parse = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(new OpenAIResponsesProvider("test-key", "gpt-5.4-mini", { responses: { parse } } as never).explain(request)).rejects.toMatchObject({ code: "unavailable", retryable: true });
  });
});
