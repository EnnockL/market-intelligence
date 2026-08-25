import type { LiquiditySnapshot } from "@/domain/historical-liquidity";
export interface HistoricalLiquidityRequest { assetId: string; mintAddress: string; from: string; to: string; informationCutoffAt: string; }
export interface HistoricalLiquidityProvider { readonly name: string; getHistoricalLiquidity(request: HistoricalLiquidityRequest): Promise<LiquiditySnapshot[]>; }
