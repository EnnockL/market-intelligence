# Production subscriptions and purchase order

Last reviewed: 2026-08-17. Prices are planning estimates in USD, excluding VAT, usage overages and annual-billing discounts. Verify the vendor page immediately before purchase.

## Purchase rule

Do not buy a subscription merely to make verification numbers green. Purchase only when its activation criterion below is met, use monthly billing first, set hard spend alerts where supported, and keep every secret in the deployment platform rather than Git.

## Phase 0 — current development ($0/month)

| Service | Current plan | Purpose | Limitation |
|---|---:|---|---|
| Supabase | Free | PostgreSQL, API and authentication foundation | Projects can pause; 500 MB database |
| Vercel/local Next.js | Hobby/local | UI and test deployments | Hobby is not intended for a commercial production service |
| Finnhub | Free | Small US stock quote test universe | Personal-use limits and incomplete historical/fundamental coverage |
| Solana public RPC | Free | Initial wallet polling | Rate limits and unreliable deep history |
| DEX Screener | Free | Current pool/market observations | No guaranteed historical liquidity |
| GeckoTerminal | Free public API | Historical candles and forward liquidity observations | Public rate limits; no historical reserve series |
| Birdeye Standard | Free | API evaluation | Historical liquidity and token security permissions are unavailable |
| CoinGecko | Keyless/Demo | Price fallback and experiments | Limited credits/history and attribution requirements |
| GitHub | Free | Source control and CI | Keep all secrets outside the repository |

## Phase 1 — first serious production environment

| Priority | Subscription | Planning price | Buy when | Why |
|---:|---|---:|---|---|
| 1 | Supabase Pro | from $25/month | The app has external testers or ingestion must run continuously | No inactivity pause, backups, more database/egress capacity |
| 2 | Vercel Pro | $20/month plus usage | The product is public or commercial | Production deployment, spend controls and stronger operational limits |
| 3 | Helius Developer | $49/month | Public Solana RPC starts rate-limiting backfills or wallet monitoring | 10M credits, 50 RPS, archival RPC and better Solana reliability |
| 4 | Birdeye Lite | $39/month | We are ready to backfill historical liquidity and security evidence | Confirm both exact endpoints before purchase |
| 5 | CoinGecko Basic | $35/month monthly ($29/month annual equivalent) | Public GeckoTerminal pricing prevents reliable PnL rebuilds | 100k monthly credits, commercial use and two years of history |
| 6 | OpenAI API | usage based; initial hard budget $20–$100/month | Deterministic pipelines are stable and narrative agents are enabled | Explanations and research synthesis, never deterministic scoring |

Expected Phase 1 fixed baseline: approximately **$168/month**, before OpenAI usage, VAT and overages.

## Phase 2 — verified Smart Money and Fast Flow

| Subscription | Planning price | Activation criterion | Notes |
|---|---:|---|---|
| Helius Business | $499/month | Developer credits/RPS are insufficient for clustering, webhooks and fast-flow monitoring | 100M credits and 200 RPS |
| Birdeye Starter | $99/month | Lite compute units are exhausted by historical evidence jobs | More included compute units |
| Birdeye Premium | $199/month | WebSocket feeds materially improve Fast Lane latency | 50 RPS and WebSocket access |
| CoinGecko Analyst | $129/month monthly ($103.2 annual equivalent) | We need ten-year history or more endpoints/credits | Upgrade only after Basic usage is measured |
| Sentry paid plan | verify at purchase | Error volume or retention exceeds its free allowance | Operational safety, not market data |
| PostHog paid usage | usage based | Product analytics exceeds its free allowance | Never send secrets into analytics events |

## Phase 3 — licensed equities and enterprise scale

| Subscription | Planning price | Activation criterion | Notes |
|---|---:|---|---|
| Finnhub All-In-One | about $3,500/month, annual commitment | Paying customers require licensed deep equity history, fundamentals and throughput | Major cost jump; negotiate licensing first |
| Supabase larger compute | from $15–$60+ per project/month beyond included credits | Measured database latency, storage or concurrency requires it | Scale from metrics |
| Birdeye Business | $499/month | Batch APIs and high request volume are proven requirements | 60M compute units and 100 RPS |
| Vercel/Supabase Enterprise | custom | SLA, compliance or enterprise customers require it | Not needed initially |
| Dedicated Solana infrastructure | Helius from about $2,900/month or custom | Shared RPC fails measured latency/availability targets | Only for true low-latency Fast Lane at scale |

## Accounts to create before funding

Create free accounts now and enable MFA where available: Supabase, Vercel, GitHub, Helius, Birdeye Data Services, CoinGecko API, Finnhub, OpenAI API, Sentry and PostHog.

Record for every vendor: account owner, billing email, plan, renewal date, monthly cap, API-key owner, key creation date and rotation date. Never store card details, seed phrases, private wallet keys or production API keys in this document.

## Birdeye purchase gate

Birdeye support must confirm that the selected plan includes both:

- `GET /defi/v3/liquidity/history/token`
- `GET /defi/token_security`

Until then, the application collects free forward point-in-time liquidity and leaves older unavailable evidence as `UNKNOWN`.

## Cost controls

- Start monthly; switch to annual only after two measured billing cycles.
- Disable or cap automatic overages initially.
- Add 50%, 75% and 90% usage alerts.
- Keep development and production keys separate.
- Rotate keys shared in chat before production.
- Review this file monthly and before every upgrade.

## Official pricing references

- Supabase: https://supabase.com/pricing
- Vercel: https://vercel.com/pricing
- Helius: https://www.helius.dev/pricing
- Birdeye Data: https://birdeye.so/data-api/pricing
- CoinGecko API: https://www.coingecko.com/en/api/pricing
- Finnhub: https://finnhub.io/pricing
- OpenAI API: https://openai.com/api/pricing/
