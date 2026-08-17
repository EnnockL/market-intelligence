import type { AssetKind } from "./market";
import type { ISODateTime, UUID } from "./database";
import { evaluateEligibility, simulateBuy, selectExit, type CandidateFacts, type PaperPolicyConfig, type PortfolioFacts } from "./paper-portfolio";

export const SIMULATION_ENGINE_VERSION = "simulation-engine-v1";
export const INFORMATION_CUTOFF_POLICY = "strict-available-at-v1";
export type SimulationDataStatus = "AVAILABLE" | "INSUFFICIENT_DATA";

export interface SimulationMarketPoint { observedAt: string; availableAt: string; priceSek: number; liquiditySek: number | null; evidenceId: string; }
export interface SimulationCandidateInput extends CandidateFacts {
  qualificationDecision: "QUALIFIED" | "WATCH" | "REJECTED";
  qualificationReason: string;
  blockerCodes: string[];
  decisionAvailableAt: string;
  market: SimulationMarketPoint[];
}
export interface SimulationKernelInput { initialCapitalSek: number; startsAt: string; endsAt: string; policy: PaperPolicyConfig; candidates: SimulationCandidateInput[]; }
export interface SimulationCandidateDecision { candidateId: string; status: "REJECTED" | "DATA_BLOCKED" | "FILLED" | "PARTIALLY_FILLED"; reason: string; requestedAmount: number; executedAmount: number | null; evidenceIds: string[]; }

export function runSimulationKernel(input: SimulationKernelInput) {
  let cash = input.initialCapitalSek, fees = 0, slippage = 0;
  const decisions: SimulationCandidateDecision[] = [], returns: number[] = [], blockerFrequency: Record<string, number> = {};
  const equity = [{ at: input.startsAt, value: cash }];
  const ordered = [...input.candidates].sort((a,b) => a.decisionAvailableAt.localeCompare(b.decisionAvailableAt) || a.candidateId.localeCompare(b.candidateId));
  for (const candidate of ordered) {
    if (candidate.decisionAvailableAt > input.endsAt || candidate.signalAvailableAt < input.startsAt) continue;
    if (candidate.qualificationDecision !== "QUALIFIED") {
      const codes = candidate.blockerCodes.length ? candidate.blockerCodes : [candidate.qualificationReason];
      codes.forEach(c => blockerFrequency[c] = (blockerFrequency[c] ?? 0) + 1);
      decisions.push({ candidateId:candidate.candidateId,status:"REJECTED",reason:"CANDIDATE_NOT_QUALIFIED",requestedAmount:0,executedAmount:null,evidenceIds:[] });
      continue;
    }
    const portfolio: PortfolioFacts = { cash, equity:cash, initialCash:input.initialCapitalSek, openPositions:0, jackpotExposure:0, tokenExposure:0, dailyNewExposure:0 };
    const eligibility = evaluateEligibility(input.policy, {...candidate,state:"QUALIFIED"}, portfolio);
    if (!eligibility.eligible) { blockerFrequency[eligibility.reason]=(blockerFrequency[eligibility.reason]??0)+1; decisions.push({candidateId:candidate.candidateId,status:"REJECTED",reason:eligibility.reason,requestedAmount:0,executedAmount:null,evidenceIds:[]}); continue; }
    const target = Date.parse(candidate.decisionAvailableAt) + input.policy.entryDelayMs;
    const points = candidate.market.filter(p => Date.parse(p.availableAt) >= target && p.availableAt <= input.endsAt && p.observedAt <= p.availableAt).sort((a,b)=>a.availableAt.localeCompare(b.availableAt) || a.observedAt.localeCompare(b.observedAt));
    const entry = points[0];
    if (!entry) { blockerFrequency.MISSING_HISTORICAL_PRICE=(blockerFrequency.MISSING_HISTORICAL_PRICE??0)+1; decisions.push({candidateId:candidate.candidateId,status:"DATA_BLOCKED",reason:"MISSING_HISTORICAL_PRICE",requestedAmount:eligibility.requestedAmount,executedAmount:null,evidenceIds:[]}); continue; }
    const fill = simulateBuy({ requestedAmount:eligibility.requestedAmount, expectedPrice:entry.priceSek, liquiditySek:entry.liquiditySek, policy:input.policy });
    if (fill.status === "REJECTED") { const reason=fill.reason; blockerFrequency[reason]=(blockerFrequency[reason]??0)+1; decisions.push({candidateId:candidate.candidateId,status:reason.includes("LIQUIDITY")?"DATA_BLOCKED":"REJECTED",reason,requestedAmount:eligibility.requestedAmount,executedAmount:null,evidenceIds:[entry.evidenceId]}); continue; }
    cash -= fill.executedAmount + fill.fees.total; fees += fill.fees.total; slippage += fill.slippage.sek;
    let exit = points.at(-1)!, high = fill.executionPrice;
    for (const point of points.slice(1)) { high=Math.max(high,point.priceSek); if (selectExit(input.policy.exits,{entryPrice:fill.executionPrice,currentPrice:point.priceSek,openedAt:entry.observedAt,observedAt:point.observedAt,highWatermark:high})) { exit=point; break; } }
    const proceeds=fill.quantity*exit.priceSek, pnl=proceeds-fill.executedAmount-fill.fees.total; cash += proceeds; returns.push(pnl); equity.push({at:exit.observedAt,value:cash});
    decisions.push({candidateId:candidate.candidateId,status:fill.status,reason:"EXECUTED",requestedAmount:eligibility.requestedAmount,executedAmount:fill.executedAmount,evidenceIds:[entry.evidenceId,exit.evidenceId]});
  }
  const wins=returns.filter(x=>x>0), losses=returns.filter(x=>x<0), peakEquity=equity.reduce((p,x)=>Math.max(p,x.value),input.initialCapitalSek);
  const maxDrawdown=equity.reduce((m,x)=>Math.min(m,(x.value-peakEquity)/peakEquity*100),0);
  return { finalEquitySek:Math.round(cash*100)/100, netPnlSek:Math.round((cash-input.initialCapitalSek)*100)/100, returnPct:(cash/input.initialCapitalSek-1)*100,
    tradeCount:returns.length, winningTrades:wins.length, losingTrades:losses.length, winRate:returns.length?wins.length/returns.length*100:null,
    profitFactor:losses.length?wins.reduce((a,b)=>a+b,0)/Math.abs(losses.reduce((a,b)=>a+b,0)):null, maxDrawdownPct:returns.length?maxDrawdown:null,
    feesSek:Math.round(fees*100)/100, slippageSek:Math.round(slippage*100)/100, dataStatus:returns.length?"AVAILABLE" as const:"INSUFFICIENT_DATA" as const, decisions, blockerFrequency, equity };
}

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
