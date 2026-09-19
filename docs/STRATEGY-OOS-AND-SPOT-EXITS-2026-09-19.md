# Prospective strategy evidence and covered spot exits

Implemented locally in response to the user's request to fix strategy provenance
and risk-reducing sell rules. No production changes or exchange orders were sent.

## Covered spot exits

Safety policy v2 requires positive SELL quantity covered by the current ledger's
available inventory for that exact instrument. The bridge uses ledger quantities;
the final guard recalculates them excluding only the order being checked and
subtracting competing reservations. Missing holdings, oversized sales, another
instrument, margin and leverage cannot obtain this treatment.

A covered spot sale may proceed when position count, daily realized loss or total
exposure exceeds entry limits. Unknown risk still blocks. Kill switch, disabled
orders, account identity, data freshness, liquidity, critical risk, size, pricing,
fees and existing stop/target requirements continue to apply. This is not an
emergency liquidation bypass. Migration 0095 requires policy v2 at database claim
time, so previously queued v1 approvals cannot be submitted unchanged.

## Prospective source evidence

Migration 0096 adds private, immutable registration and frozen source stores.
Registration selects an existing immutable strategy definition, asset, provider,
future start and end. There is one window per definition version and asset;
failed periods cannot be silently replaced. It does not enable trading.

After the period ends, sealing captures the entire eligible candle set from the
specified provider, definition, regime rows and engine version. Rows created or
available after the cutoff are excluded. The dataset hash covers the full stored
source, not just candle IDs. Sealing is idempotent. Source quality below 80 or
fewer than 20 candles blocks sealing; sufficient strategy trade count, actual
market-data coverage and statistical performance remain separate requirements.

Evaluation uses only that sealed source. Run, trades and segment metrics publish
atomically; a failed write rolls back the run, and retries cannot strand a partial
ledger. Research publication verifies dataset/run/strategy/asset/hash/window and
the complete trade count in the database. Only that path can publish verified
OUT_OF_SAMPLE research. Legacy results remain TRAIN/EXPLORATION. Learning-linked
runs are never upgraded by adding a phase label.

The existing selector can consider these verified snapshots while retaining its
sample-size and performance requirements. Verified provenance does not mean a
profitable or approved strategy. Existing hypothesis validation, phase progression,
runtime governance and proposal requirements still apply. No strategy was promoted
or trade proposal fabricated during this change.

## Operator commands after reviewed deployment

```powershell
npm run worker -- strategy-oos-register <definitionId> <assetId> <provider> <futureStartISO> <futureEndISO>
npm run worker -- strategy-oos-evaluate <returnedPlanId>
```

The second command is valid only after the registered period ends and source data
is available. It publishes evaluation and research evidence; it sends no orders.
There is no automatic scheduler registration for these new operator commands.

## Verification

- 979 unit tests passed, including exact frozen-source evaluation, malformed or
  late data, retrospective manifests, insufficient samples, covered exits above
  entry limits, conflicting reservations and rejection of old approval versions.
- 58 Supabase/PostgREST integration tests passed across 28 files.
- Real isolated PostgreSQL checks passed: permissions, future-only registration,
  immutable sealing, no replacement windows, source-time exclusion, run/hash
  binding, atomic rollback and idempotent publication; existing account and
  independent-connection order-claim tests also passed.
- Production build and TypeScript passed.

Migration 0094 remains the preceding multiasset account change. Migrations
0094–0096 are applied only to the isolated local test database. Production
migration gaps and deployment need a separate review. Actual demo execution also
requires a matching BTC-EUR LIMIT proposal; the generic opportunity producer's
MARKET/USD-oriented proposals are not automatically converted by this work.
