import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ForecastSchedulerService } from "@/services/forecast-scheduler/service";
import { FinnhubNewsProvider } from "@/services/news/finnhub-news-provider";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET, authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = process.env.FINNHUB_API_KEY, symbols = (process.env.STOCK_SYMBOLS ?? "AAPL,NVDA,AMD,TSLA,MSFT").split(",").map((value) => value.trim()).filter(Boolean);
  const service = new ForecastSchedulerService(createServiceClient(), `cron-${crypto.randomUUID()}`, key ? { provider: new FinnhubNewsProvider(key), symbols } : undefined);
  const jobs = await service.runDue();
  return NextResponse.json({ scheduler: "forecast-scheduler-v1.2", jobs, ranAt: new Date().toISOString() });
}
