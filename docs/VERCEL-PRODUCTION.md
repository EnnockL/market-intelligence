# Vercel production deployment

The production runtime uses Vercel Cron as a one-minute control loop. Every invocation is authenticated, leased in PostgreSQL, time-bounded, and safe to retry. Heavy forecast outcomes run in resumable batches while live ingestion keeps the highest priority.

## Required environment variables

Configure these for the **Production** environment in Vercel. Never prefix server secrets with `NEXT_PUBLIC_`.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FINNHUB_API_KEY`
- `STOCK_SYMBOLS`
- `SOLANA_RPC_URL`
- `SOLANA_DISCOVERY_SEEDS` (optional)
- `CRON_SECRET` (long, random value; Vercel sends it as a bearer token)
- `SCHEDULER_MAX_RUNTIME_MS=50000`
- `SCHEDULER_BATCH_LIMIT=20`

Optional provider keys remain supported through `.env.example`.

## Deployment

1. Import the GitHub repository into Vercel and select the Next.js preset.
2. Add the production variables above without committing their values.
3. Apply every Supabase migration, including `0047_vercel_scheduler_time_budget_v1.sql`.
4. Deploy from the intended production branch.
5. Confirm the Cron Jobs page shows `/api/cron/forecast` every minute. Minute-level cron scheduling requires Vercel Pro.
6. Enable a spend limit and usage notifications before continuous ingestion is enabled.

## Production verification

After deployment, leave the local computer and local worker off and verify:

- cron responses are HTTP 200 and stay below 60 seconds;
- `scheduled_job_runs` receives successful runs and heartbeats;
- `last_successful_run_at` advances for stock, wallet, crypto, market event, Fast Flow, and Jackpot jobs;
- provider errors are visible as degraded/failed jobs rather than substituted values;
- dashboard timestamps advance and the source labels remain `LIVE` or `UNKNOWN`, never implicit mock data.

Vercel is the current scheduler/control plane. Persistent streams or sub-second workers should later move to a dedicated worker runtime without changing the existing job or event contracts.
