# Ordinary demo market binding

Correction to the earlier execution visibility note: `mapDemoProposal` was
already wired into the ordinary proposal producer before that note was written.
The generic USD/USDT candidate is mapped to the account's native BTC-EUR LIMIT
market in DEMO mode. The UI statement that this wiring was absent was incorrect.

This change strengthens that existing adapter, rather than enabling another
trading mode:

- Require the persisted asset identity `external_id=bitcoin`, native Bitcoin
  chain metadata and explicit `executionInstrument=BTC-EUR`. Ticker alone is
  insufficient; missing/other identities are blocked.
- Match the selected ledger's account ID as well as the provider account ID.
- Preserve EUR venue prices and EUR/SEK conversion through proposal, eligibility
  and intent. Preserve all original candidate blockers and final account limits.
- Mark successful mappings with policy `demo-market-proposal-v2` and include the
  asset/instrument binding in evidence references.
- Correct the execution page's explanation of the existing demo adapter.

Production inspection found native Bitcoin metadata present but zero ordinary
opportunities for that asset. This remains an upstream research coverage gap;
the adapter does not create opportunities, Meta approval, liquidity/risk evidence
or strategy approval. Current account-wide exposure also remains subject to the
ordinary limits. The separately authorized demo trial is unchanged.

Validation: 35 targeted tests passed, including BUY/SELL native-currency mapping
through eligibility into an execution intent, ticker collision/missing identity,
venue constraints and preservation of rejected/unknown research evidence.
