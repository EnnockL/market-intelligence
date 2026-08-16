import { z } from "zod";

const workerSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(), SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  FINNHUB_API_KEY: z.string().min(1), SOLANA_RPC_URL: z.string().url(),
  STOCK_SYMBOLS: z.string().default("AAPL,NVDA,AMD,TSLA,MSFT"),
  SOLANA_DISCOVERY_SEEDS: z.string().default("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
});

export type WorkerEnv = z.infer<typeof workerSchema>;
export function getWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv { return workerSchema.parse(source); }
