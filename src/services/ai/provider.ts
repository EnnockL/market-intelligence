export interface EvidenceReference {
  sourceId: string; observedAt: string; excerpt: string;
}

export interface NarrativeAnalysis {
  summary: string; claims: Array<{ text: string; evidence: EvidenceReference[] }>;
  confidence: number; model: string;
}

export interface AIProvider {
  readonly name: string;
  analyzeNews(assetId: string, evidence: EvidenceReference[]): Promise<NarrativeAnalysis>;
  analyzeAsset(assetId: string, evidence: EvidenceReference[]): Promise<NarrativeAnalysis>;
  bullCase(assetId: string, evidence: EvidenceReference[]): Promise<NarrativeAnalysis>;
  bearCase(assetId: string, evidence: EvidenceReference[]): Promise<NarrativeAnalysis>;
  extractEvents(text: string): Promise<NarrativeAnalysis>;
  summarizeEvidence(evidence: EvidenceReference[]): Promise<NarrativeAnalysis>;
}

