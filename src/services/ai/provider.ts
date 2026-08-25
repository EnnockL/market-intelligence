export const AI_EXPLANATION_CONTRACT_VERSION = "ai-explanation-v1";
export type AISuggestedAction = "IGNORE" | "WATCH" | "ENRICH" | "PAPER_TRADE_CANDIDATE" | "REQUEST_MORE_DATA";
export interface EvidenceReference { sourceId: string; observedAt: string; availableAt: string; sourceType: string; excerpt: string; }
export interface AIExplanationRequest { entityType: "META_ASSESSMENT" | "SPECIALIST_ANALYSIS"; entityId: string; assetId: string; assetSymbol: string; informationCutoffAt: string; deterministicDecision: string; deterministicReason: string; dataQuality: number | null; context: Record<string, unknown>; evidence: EvidenceReference[]; }
export interface AIExplanation { summary: string; reasoning: Array<{ text: string; evidenceSourceIds: string[] }>; risks: string[]; missingData: string[]; suggestedAction: AISuggestedAction; }
export interface AIExplanationResult extends AIExplanation { provider: string; model: string; responseId: string | null; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }; }
export interface AIProvider { readonly name: string; readonly model: string; explain(request: AIExplanationRequest): Promise<AIExplanationResult>; }
