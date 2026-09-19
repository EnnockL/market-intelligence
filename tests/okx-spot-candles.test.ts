import { describe,expect,it,vi } from "vitest";
import { OkxSpotCandleProvider } from "@/services/candles/okx-spot-candle-provider";
import type { CandleRequest } from "@/services/candles/provider";
const request:CandleRequest={assetId:"a",instrumentKind:"CRYPTO_SPOT",providerSymbol:"BTC-EUR",timeframe:"5m",startsAt:"2026-08-01T00:00:00Z",endsAt:"2026-08-01T01:00:00Z",limit:2};
const row=(at:string,confirm="1")=>[String(Date.parse(at)),"100","102","99","101","1","101","101",confirm];
describe("OKX EUR candle ingestion",()=>{
 it("retains actual observation time, skips unfinished candles and walks backwards",async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({code:"0",data:[row("2026-08-01T00:55:00Z","0"),row("2026-08-01T00:50:00Z")]})));
  const r=await new OkxSpotCandleProvider(fetcher as typeof fetch).getCandles(request);
  expect(r.candles).toHaveLength(1);expect(r.candles[0].availableAt).not.toBe(r.candles[0].closedAt);
  expect(r.candles[0].rawPayload).toMatchObject({quoteCurrency:"EUR",instrumentId:"BTC-EUR"});
  expect(r.nextCursor).toBe("2026-08-01T00:50:00.000Z");
 });
 it("rejects duplicate pages rather than declaring complete coverage",async()=>{
  const f=async()=>new Response(JSON.stringify({code:"0",data:[row("2026-08-01T00:50:00Z"),row("2026-08-01T00:50:00Z")]}));
  await expect(new OkxSpotCandleProvider(f).getCandles(request)).rejects.toThrow("PAGINATION_INVALID");
 });
 it("refuses another quote or unsupported source",async()=>{
  await expect(new OkxSpotCandleProvider().getCandles({...request,providerSymbol:"BTC-USDT"})).rejects.toThrow("SCOPE_INVALID");
 });
});
