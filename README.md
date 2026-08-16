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
```

The stock universe defaults to `AAPL,NVDA,AMD,TSLA,MSFT`. Stock quotes use Finnhub. Wallet ingestion uses Solana JSON-RPC and reads addresses where `wallets.is_tracked = true`. Each run persists status, record count, errors, and completion time in `ingestion_runs`; provider failures are retained in `provider_errors`.

Required server-side variables:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — read-only browser/server-render key
- `SUPABASE_SERVICE_ROLE_KEY` — worker-only database key; never expose it to the client
- `FINNHUB_API_KEY` — Finnhub API token for stock quotes
- `SOLANA_RPC_URL` — standard or paid Solana JSON-RPC endpoint
- `STOCK_SYMBOLS` — optional comma-separated stock universe

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
- `tests` — deterministic domain tests

This is research software for paper evaluation, not financial advice or an execution system.

Simulation, historical replay, and paper portfolios are first-class schema domains. This foundation stores their assumptions and audit trail, but does not yet execute simulations or place any real trades.
