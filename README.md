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

Apply `supabase/migrations/0001_initial_schema.sql` to a new Supabase project. Browser clients receive only the anon key; ingestion workers use the service-role key server-side. RLS exposes active market data but keeps wallet intelligence private by default.

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
