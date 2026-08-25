import { z } from "zod";

const workerSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(), SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  FINNHUB_API_KEY: z.string().min(1), SOLANA_RPC_URL: z.string().url(),
  STOCK_SYMBOLS: z.string().default("AAPL,NVDA,AMD,TSLA,MSFT"),
  SOLANA_DISCOVERY_SEEDS: z.string().default("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
  COINGECKO_API_KEY: z.string().min(1).optional(),
  BIRDEYE_API_KEY: z.string().min(1).optional(), WALLET_EVIDENCE_MAX_TOKENS: z.coerce.number().int().min(1).max(100).default(10),
  OPENAI_API_KEY: z.string().min(1).optional(), OPENAI_MODEL: z.string().min(1).default("gpt-5.4-mini"),
  WALLET_CLUSTERING_MAX_WALLETS: z.coerce.number().int().min(2).max(500).default(100),
  EXECUTION_MODE: z.enum(["SHADOW","DEMO"]).default("SHADOW"),
  OKX_DEMO_ENABLED: z.enum(["true","false"]).default("false").transform((value)=>value==="true"),
  OKX_DEMO_API_KEY: z.string().min(1).optional(), OKX_DEMO_SECRET_KEY: z.string().min(1).optional(),
  OKX_DEMO_PASSPHRASE: z.string().min(1).optional(), OKX_DEMO_BASE_URL: z.string().url().default("https://eea.okx.com"),
});

export type WorkerEnv = z.infer<typeof workerSchema>;
export function getWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv { return workerSchema.parse(source); }
