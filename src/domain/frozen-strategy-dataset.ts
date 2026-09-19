import { deterministicDigest } from "./events";
import { STRATEGY_LAB_VERSION, type StrategyDefinition } from "./strategy-pattern-lab";
import type { MarketCandle } from "./technical-structure";

/** Database-sealed source rows. No caller-supplied phase can manufacture OOS. */
export function readFrozenStrategyDataset(row: any) {
  const fail = (): never => { throw new Error("FROZEN_DATASET_INVALID"); };
  const p = row?.payload?.plan, definition = row?.payload?.definition as StrategyDefinition;
  const start = Date.parse(p?.starts_at), end = Date.parse(p?.ends_at), registered = Date.parse(p?.created_at);
  if (!row?.id || !/^[a-f0-9]{64}$/.test(row.dataset_hash) || row.payload.version !== "prospective-dataset-v1" || row.payload.engineVersion !== STRATEGY_LAB_VERSION
    || row.plan_id !== p?.id || ![start,end,registered,Date.parse(row.created_at)].every(Number.isFinite)
    || registered > start || start >= end || Date.parse(row.created_at) < end
    || deterministicDigest(definition) !== row.payload.definitionHash || !Array.isArray(row.payload.candles)
    || row.payload.candles.length < 20 || !Array.isArray(row.payload.regimes)) fail();
  const seen = new Set<string>(), times = new Set<number>();
  const candles: MarketCandle[] = row.payload.candles.map((c: any) => {
    const opened = Date.parse(c.opened_at), closed = Date.parse(c.closed_at), available = Date.parse(c.available_at);
    if (!c.id || seen.has(c.id) || times.has(opened) || c.asset_id !== p.asset_id || c.provider !== p.provider || c.timeframe !== definition.timeframe
      || ![opened,closed,available,Date.parse(c.created_at)].every(Number.isFinite) || opened < start || closed > end || opened >= closed
      || available < closed || available > end || Date.parse(c.created_at) > end || !Number.isFinite(Number(c.data_quality)) || Number(c.data_quality)<80 || Number(c.data_quality)>100
      || ![c.open,c.high,c.low,c.close].every(x => Number.isFinite(Number(x)) && Number(x)>0)
      || Number(c.high)<Math.max(Number(c.open),Number(c.close),Number(c.low)) || Number(c.low)>Math.min(Number(c.open),Number(c.close))) fail();
    if (c.volume !== null && (!Number.isFinite(Number(c.volume)) || Number(c.volume)<0)) fail();
    seen.add(c.id); times.add(opened);
    return { id:c.id, assetId:c.asset_id, timeframe:c.timeframe, openedAt:new Date(opened).toISOString(),closedAt:new Date(closed).toISOString(),
      availableAt:new Date(available).toISOString(),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close),volume:c.volume===null?null:Number(c.volume) };
  });
  candles.sort((a,b)=>a.openedAt.localeCompare(b.openedAt)||a.id.localeCompare(b.id));
  return { definition, candles, plan:p, datasetId:row.id as string, inputHash:row.dataset_hash as string,
    startsAt:new Date(start).toISOString(), endsAt:new Date(end).toISOString(), createdAt:row.created_at as string,
    dataQuality:Math.min(...row.payload.candles.map((c:any)=>Number(c.data_quality))), regimes:row.payload.regimes as any[] };
}
