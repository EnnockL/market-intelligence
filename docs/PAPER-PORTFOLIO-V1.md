# Paper Portfolio v1

Paper Portfolio is a deterministic research consumer of immutable Jackpot Candidate revisions. It never sends real orders and uses no LLM decisions.

Four isolated policies run against the same stream: Fixed Small (SEK 500), Equity 1%, Independence Required (80% relationship coverage and known adjusted count), and Early Detection (maximum 25% move). All require `QUALIFIED`, safety `PASS`, data quality 60, point-in-time inputs, liquidity evidence, and shared risk caps.

Execution waits five seconds and uses the first market observation at or after simulated execution. V1 converts USD observations using the explicit fixed research assumption `USD/SEK 10.5`. Estimated fees include SEK 0.05 network, SEK 0.10 priority, 0.30% DEX and 0.05% route fees. Liquidity participation is capped at 0.5%; deterministic price impact is `trade/liquidity * 50`, capped at 10%. These are model assumptions, not claimed historical quotes.

Missing price, liquidity, safety, independence or timing inputs reject rather than pass. Eligibility only reads evidence available by its cutoff; execution price must be observed at or after delayed execution.

Exit rules are evaluated in priority order. V1 supports stop loss, time exits, trailing exits and idempotent staged target exits at 2x, 5x and 10x. Each sell fill updates cash, remaining quantity, cost basis and realized PnL.
