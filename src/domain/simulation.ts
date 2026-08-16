import type { AssetKind } from "./market";
import type { ISODateTime, UUID } from "./database";

export type SimulationStatus = "queued" | "running" | "completed" | "failed";
export type SimulationStrategy = "ai_balanced" | "stocks_only" | "crypto_smart_money" | "custom";
export type BenchmarkKind = "sp500" | "nasdaq" | "bitcoin" | "cash";

export interface ExecutionAssumptions {
  maxPositionPercent: number;
  stockAllocationPercent: number;
  cryptoAllocationPercent: number;
  entryDelaySeconds: number;
  exitDelaySeconds: number;
  feeBps: number;
  maxLiquidityParticipationPercent: number;
  slippageModel: "fixed_bps" | "volume_impact";
}

export interface SimulationRun {
  id: UUID; userId: UUID; strategy: SimulationStrategy; status: SimulationStatus;
  initialCapitalSek: string; startsAt: ISODateTime; endsAt: ISODateTime;
  informationCutoffAt: ISODateTime; assumptions: ExecutionAssumptions;
  scoringVersion: string; createdAt: ISODateTime; completedAt: ISODateTime | null;
}

export interface SimulationTrade {
  id: UUID; simulationRunId: UUID; signalId: UUID; assetId: UUID; assetKind: AssetKind;
  side: "buy" | "sell"; requestedAt: ISODateTime; executedAt: ISODateTime;
  quantity: string; executionPrice: string; grossValueSek: string; feeSek: string;
  slippageBps: number; availableLiquidityUsd: string | null; realizedPnlSek: string | null;
}

export interface SimulationResult {
  simulationRunId: UUID; finalValueSek: string; returnPercent: number; tradeCount: number;
  winningTrades: number; losingTrades: number; maxDrawdownPercent: number;
  profitFactor: number | null; largestWinPercent: number | null; largestLossPercent: number | null;
}

export interface BenchmarkResult {
  simulationRunId: UUID; benchmark: BenchmarkKind; finalValueSek: string; returnPercent: number;
}

export interface PaperPortfolio {
  id: UUID; userId: UUID; name: string; strategy: SimulationStrategy;
  status: "active" | "paused" | "closed"; initialCapitalSek: string; cashSek: string;
  assumptions: ExecutionAssumptions; createdAt: ISODateTime; updatedAt: ISODateTime;
}

export interface PaperPosition {
  id: UUID; portfolioId: UUID; assetId: UUID; quantity: string;
  averageEntryPrice: string; openedAt: ISODateTime; closedAt: ISODateTime | null;
}

export interface ReplayCheckpoint {
  id: UUID; simulationRunId: UUID; replayTime: ISODateTime;
  informationAvailableThrough: ISODateTime; state: Record<string, unknown>; createdAt: ISODateTime;
}
