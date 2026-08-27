import {describe,expect,it} from "vitest";
import {evaluateStrategyPromotion} from "@/domain/strategy-promotion";
const base={strategyDefinitionId:"s",hypothesisId:"h",cutoffAt:"2026-08-27T12:00:00Z"};
const row=(phase:any,decision:any,id=phase,availableAt="2026-08-27T11:00:00Z")=>({id,phase,decision,availableAt});
describe("strategy promotion",()=>{
 it("holds without required evidence",()=>expect(evaluateStrategyPromotion({...base,currentState:"RESEARCH",validations:[]}).blockers).toEqual(["VALIDATION_MISSING:LEARNING"]));
 it("promotes one phase only",()=>{const r=evaluateStrategyPromotion({...base,currentState:"RESEARCH",validations:[row("LEARNING","APPROVED")]});expect(r.decision).toBe("PROMOTE");expect(r.targetState).toBe("FROZEN")});
 it("never skips a predecessor",()=>expect(evaluateStrategyPromotion({...base,currentState:"OUT_OF_SAMPLE",validations:[row("OUT_OF_SAMPLE","APPROVED")]}).blockers[0]).toContain("LEARNING"));
 it("keeps insufficient data distinct from rejection",()=>expect(evaluateStrategyPromotion({...base,currentState:"RESEARCH",validations:[row("LEARNING","INSUFFICIENT_DATA")]}).decision).toBe("HOLD"));
 it("rejects future evidence",()=>expect(evaluateStrategyPromotion({...base,currentState:"RESEARCH",validations:[row("LEARNING","APPROVED","x","2026-08-28T00:00:00Z")]}).blockers).toEqual(["VALIDATION_MISSING:LEARNING"]));
 it("is deterministic",()=>{const input={...base,currentState:"RESEARCH" as const,validations:[row("LEARNING","APPROVED")]};expect(evaluateStrategyPromotion(input).evaluationKey).toBe(evaluateStrategyPromotion(input).evaluationKey)});
 it("reaches shadow only after every phase",()=>{const validations=[row("LEARNING","APPROVED"),row("FROZEN","APPROVED"),row("OUT_OF_SAMPLE","APPROVED"),row("DEMO_VALIDATION","APPROVED")];expect(evaluateStrategyPromotion({...base,currentState:"DEMO_VALIDATION",validations}).targetState).toBe("APPROVED_SHADOW")});
});
