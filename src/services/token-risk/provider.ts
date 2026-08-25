export type TokenRiskStatus = "LOW_RISK" | "ELEVATED" | "HIGH_RISK" | "CONFIRMED_RUG" | "UNKNOWN";
export interface TokenRiskAssessment { tokenId: string; provider: string; riskVersion: string; assessedAt: string; informationCutoffAt: string; informationAvailableAt: string; rugRiskScore: number | null; rugStatus: TokenRiskStatus; riskComponents: Record<string, unknown>; dataQuality: number; }
export interface TokenRiskProvider { readonly name: string; assess(tokenId: string, cutoff: string): Promise<TokenRiskAssessment>; }
