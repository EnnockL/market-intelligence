# Continuous Ingestion v1

The PostgreSQL scheduler owns external ingestion and the downstream research pipeline. React components never poll providers.

## Run locally

Ensure `.env.local` contains the Supabase, Finnhub and Solana variables documented in `.env.example`, then run:

```powershell
npm run scheduler:local
```

Keep the terminal and computer running. Stop safely with `Ctrl+C`. Run one cycle with `npm run scheduler:once`.

The loop checks PostgreSQL every minute. Database leases, retries and idempotent persistence make restarts safe. Job status, last successful run and failures are visible under `/data-collection`.

## Cadence

- Wallet ingestion: 5 minutes
- Crypto market snapshots: 2 minutes
- Stock snapshots: 5 minutes
- Wallet discovery: 1 hour
- Market events, Fast Flow and Jackpot Collector: 1 minute
- News and downstream analysis retain their existing schedules

Intervals are due-time targets, not exchange-grade latency guarantees. Provider limits and earlier job duration can delay later work.

## Moving to 24/7 hosting

Call `GET /api/cron/forecast` every minute with `Authorization: Bearer $CRON_SECRET`, or run `npm run scheduler:once` from a persistent worker. Configure the same server-only environment variables on the host. Never expose service-role, provider or cron secrets in client-side variables or commit them to Git.
