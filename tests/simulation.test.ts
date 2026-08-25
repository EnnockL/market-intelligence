import { describe, expect, it } from "vitest";
import { INITIAL_POLICIES } from "../src/domain/paper-portfolio";
import { runSimulationKernel, type SimulationCandidateInput } from "../src/domain/simulation";

const base: SimulationCandidateInput = {
  candidateId:"c1",opportunityId:null,revisionNumber:1,assetId:"a1",state:"QUALIFIED",safety:"PASS",dataQuality:90,
  relationshipCoverage:90,clusterAdjustedCount:3,priceMoveBeforeDetectionPct:5,signalAvailableAt:"2026-01-01T00:00:00Z",decisionCutoff:"2026-01-01T00:00:00Z",
  decisionAvailableAt:"2026-01-01T00:00:00Z",qualificationDecision:"QUALIFIED",qualificationReason:"ALL_REQUIREMENTS_PASS",blockerCodes:[],
  market:[{observedAt:"2026-01-01T00:00:06Z",availableAt:"2026-01-01T00:00:06Z",priceSek:10,liquiditySek:1_000_000,evidenceId:"p1"},{observedAt:"2026-01-02T01:00:00Z",availableAt:"2026-01-02T01:00:00Z",priceSek:20,liquiditySek:1_000_000,evidenceId:"p2"}],
};
const input=(candidates:SimulationCandidateInput[])=>({initialCapitalSek:20_000,startsAt:"2026-01-01T00:00:00Z",endsAt:"2026-01-03T00:00:00Z",policy:INITIAL_POLICIES.FIXED_SMALL,candidates});

describe("simulation engine v1",()=>{
  it("is deterministic",()=>expect(runSimulationKernel(input([base]))).toEqual(runSimulationKernel(input([base]))));
  it("returns insufficient data rather than fake zero metrics",()=>{const r=runSimulationKernel(input([{...base,qualificationDecision:"REJECTED",blockerCodes:["LIQUIDITY_BELOW_THRESHOLD"]}]));expect(r.tradeCount).toBe(0);expect(r.dataStatus).toBe("INSUFFICIENT_DATA");expect(r.winRate).toBeNull();expect(r.blockerFrequency.LIQUIDITY_BELOW_THRESHOLD).toBe(1)});
  it("rejects future evidence",()=>{const r=runSimulationKernel(input([{...base,market:[{...base.market[0],availableAt:"2026-01-04T00:00:00Z"}]}]));expect(r.tradeCount).toBe(0);expect(r.decisions[0].reason).toBe("MISSING_HISTORICAL_PRICE")});
  it("executes a qualified point-in-time candidate",()=>{const r=runSimulationKernel(input([base]));expect(r.tradeCount).toBe(1);expect(r.finalEquitySek).toBeGreaterThan(20_000);expect(r.feesSek).toBeGreaterThan(0)});
});
