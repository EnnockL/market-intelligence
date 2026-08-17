# Market Intelligence Engine

Evidence-first market intelligence for stocks and Solana. The initial foundation separates deterministic scoring from narrative analysis and stores the complete audit trail behind every signal.

## Quick start

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The current dashboard uses typed demonstration data while ingestion adapters are built.

## Verify

```bash
npm test
npm run typecheck
npm run build
```

## Database

Apply all files in `supabase/migrations` in numeric order. Browser clients receive only the anon key; ingestion workers use the service-role key server-side. RLS exposes active market data but keeps wallet intelligence private by default.

## Ingestion workers

The web app never polls providers. Configure `.env.local`, then run each job independently from a scheduler or terminal:

```bash
npm run worker -- stocks
npm run worker -- wallets
npm run worker -- wallet-discovery
npm run worker -- crypto-market
npm run worker -- wallet-pnl
npm run worker -- wallet-evidence
npm run worker -- fast-flow
```

The stock universe defaults to `AAPL,NVDA,AMD,TSLA,MSFT`. Stock quotes use Finnhub. Wallet ingestion uses Solana JSON-RPC and reads addresses where `wallets.is_tracked = true`. Each run persists status, record count, errors, and completion time in `ingestion_runs`; provider failures are retained in `provider_errors`.

Required server-side variables:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — read-only browser/server-render key
- `SUPABASE_SERVICE_ROLE_KEY` — worker-only database key; never expose it to the client
- `FINNHUB_API_KEY` — Finnhub API token for stock quotes
- `SOLANA_RPC_URL` — standard or paid Solana JSON-RPC endpoint
- `STOCK_SYMBOLS` — optional comma-separated stock universe
- `SOLANA_DISCOVERY_SEEDS` — optional comma-separated public programs or addresses used to discover unverified candidates
- `COINGECKO_API_KEY` — optional CoinGecko Pro key required for historical on-chain prices and verified PnL

- `BIRDEYE_API_KEY` — optional Birdeye key required by `wallet-evidence` for historical token liquidity and token security observations
- `WALLET_EVIDENCE_MAX_TOKENS` — optional bounded evidence budget per run (default 10, maximum 100)

Crypto current price, liquidity, market cap, and 24-hour volume use the free DEX Screener API. Historical transaction-time pricing defaults locally to the keyless GeckoTerminal API with explicit retry/backoff. When `COINGECKO_API_KEY` is configured, CoinGecko Pro replaces the public historical provider. Missing candles remain `incomplete`; the system never estimates verified profit from current prices.

Wallet risk metrics are deterministic and point-in-time. Max drawdown uses only verified closed trade returns. Rug exposure requires immutable token risk observations; missing assessments remain `NULL` and are never interpreted as safe. GeckoTerminal does not provide historical reserve liquidity, so current liquidity is never backfilled into historical trades.

Birdeye historical token liquidity is stored with its observed/effective/available timestamps and provider quality. When Birdeye returns token-wide liquidity without a pool address, the pool remains `NULL` and the record is marked as token aggregate; the worker never invents pool identity. Birdeye token security is a current observation and is never backdated to a trade. Unsupported historical risk components remain `UNKNOWN`. Database uniqueness keys make reruns idempotent, while repository lookups and short-lived provider caches avoid duplicate requests.

The free liquidity mode is prospective: every DEX Screener poll also persists the selected pool identity and observed USD liquidity as a point-in-time snapshot. It can verify trades only from the moment collection starts. Standard Solana RPC does not expose historical account state, so older liquidity remains `UNKNOWN` rather than being backfilled from current reserves.

Wallet history ingestion maintains a per-wallet `before` cursor, deterministic newest-to-oldest ordering, a bounded RPC request budget, and resumable completion state. Run `wallets` repeatedly to deepen history without restarting from the newest transaction.

Wallet Intelligence V3 uses `wallet-verification-policy-v1`. Historical liquidity selection is `latest-effective-highest-liquidity-v1`: use the latest snapshot whose effective and information-available timestamps are not after the evaluation timestamp; ties choose highest liquidity, then lexicographically smallest pool address. Performance history is explicitly a realized-PnL curve, never presented as full wallet equity. Score V3 remains separate from evidence quality and cannot promote `elite` automatically.

The dashboard falls back to labeled mock values when configuration or snapshots are missing. Provider failures display `DEGRADED`; quotes older than 15 minutes display `STALE`. Live prices do not generate opportunity scores or trading decisions.

## Database deployment

Migrations are deployed from `main` by `.github/workflows/deploy-database.yml`. Configure the GitHub `production` environment with this repository secret:

- `SUPABASE_DB_URL` — the complete production Session Pooler URI

The workflow serializes deployments and runs `supabase db push`; never modify the remote schema manually after this workflow is enabled.

## Structure

- `src/app` — dashboard, asset route, and HTTP endpoints
- `src/domain` — provider-neutral types and deterministic scoring
- `src/services` — replaceable market-data, blockchain, and AI provider contracts
- `src/data` — typed demo fixtures, replaceable by repositories
- `supabase/migrations` — versioned PostgreSQL schema
- `docs/SPRINT-1.md` — scope and acceptance criteria
- `docs/MASTER-PLAN.md` — simulation, replay, paper portfolio, and delivery principles
- `docs/MASTER-ARCHITECTURE.md` — locked agent architecture, data flow, Fast Lane, Meta, and LLM boundaries
- `docs/PRODUCTION-SUBSCRIPTIONS.md` — phased vendor accounts, activation criteria and subscription budget
- `tests` — deterministic domain tests

This is research software for paper evaluation, not financial advice or an execution system.

Simulation, historical replay, and paper portfolios are first-class schema domains. This foundation stores their assumptions and audit trail, but does not yet execute simulations or place any real trades.
