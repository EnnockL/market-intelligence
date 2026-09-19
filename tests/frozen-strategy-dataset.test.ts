import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import { readFrozenStrategyDataset } from "@/domain/frozen-strategy-dataset";
import { ORB_RETEST_15M_V1, STRATEGY_LAB_VERSION } from "@/domain/strategy-pattern-lab";
import { StrategyPatternLabService } from "@/services/strategy-pattern-lab/service";

function fixture() {
  const start=Date.parse("2026-08-02T00:00:00Z"), definition=ORB_RETEST_15M_V1;
  return {id:"dataset",plan_id:"plan",dataset_hash:"a".repeat(64),created_at:"2026-08-04T00:00:00Z",payload:{version:"prospective-dataset-v1",engineVersion:STRATEGY_LAB_VERSION,
    definition,definitionHash:deterministicDigest(definition),plan:{id:"plan",strategy_definition_id:"definition",asset_id:"asset",provider:"fixture",
      created_at:"2026-08-01T00:00:00Z",starts_at:new Date(start).toISOString(),ends_at:"2026-08-03T00:00:00Z"},regimes:[],
    candles:Array.from({length:20},(_,i)=>({id:`c${i}`,asset_id:"asset",provider:"fixture",timeframe:definition.timeframe,
      opened_at:new Date(start+i*900000).toISOString(),closed_at:new Date(start+(i+1)*900000).toISOString(),available_at:new Date(start+(i+1)*900000).toISOString(),
      created_at:new Date(start+(i+1)*900000).toISOString(),open:100,high:101,low:99,close:100,volume:100,data_quality:100}))}};
}
describe("frozen source manifest",()=>{
  it("loads exactly the sealed source and its full window",()=>expect(readFrozenStrategyDataset(fixture())).toMatchObject({startsAt:"2026-08-02T00:00:00.000Z",endsAt:"2026-08-03T00:00:00.000Z",dataQuality:100,candles:expect.any(Array)}));
  it.each(["provider","price","duplicate","late","strategy","engine","window","volume"])("rejects invalid %s evidence",kind=>{
    const f=fixture();
    if(kind==="provider") f.payload.candles[0].provider="other";
    if(kind==="price") f.payload.candles[0].high=0;
    if(kind==="duplicate") f.payload.candles[1]=f.payload.candles[0];
    if(kind==="late") f.payload.candles[0].created_at="2026-09-01T00:00:00Z";
    if(kind==="strategy") f.payload.definitionHash="changed";
    if(kind==="engine") f.payload.engineVersion="new-engine";
    if(kind==="window") f.payload.plan.created_at="2026-08-03T00:00:00Z";
    if(kind==="volume") f.payload.candles[0].volume=NaN;
    expect(()=>readFrozenStrategyDataset(f)).toThrow("FROZEN_DATASET_INVALID");
  });
  it("evaluates only frozen candles, publishes atomically and preserves insufficient sample status",async()=>{
    const f=fixture();
    const rpc=vi.fn(async(name:string,args:any)=>({data:name==="seal_strategy_dataset"?[f]:"run",error:null}));
    const db={rpc,from(table:string){expect(table).toBe("strategy_definitions");const b:any={select:()=>b,eq:()=>b,maybeSingle:async()=>({data:{id:"definition",definition_hash:f.payload.definitionHash},error:null})};return b;}};
    const result=await new StrategyPatternLabService(db as unknown as SupabaseClient).runFrozen("plan");
    expect(result.evaluation.status).toBe("INSUFFICIENT_DATA");
    expect(rpc.mock.calls.map(x=>x[0])).toEqual(["seal_strategy_dataset","publish_frozen_strategy_evaluation"]);
    expect(rpc.mock.calls[1][1]).toMatchObject({p_run:{frozen_dataset_id:"dataset",input_hash:f.dataset_hash,candle_count:20},p_trades:[],p_segments:expect.any(Array)});
  });
});
