# Trade Proposal Producer v1

The producer is the deterministic boundary from research to an immutable trade proposal. It requires a qualified opportunity, Meta readiness, directional consensus, fresh point-in-time price, historical USD/SEK, spot instrument mapping, liquidity and token-risk evidence.

Missing inputs produce `DATA_BLOCKED`; explicit policy violations produce `REJECTED`. Only `PROPOSAL_READY` creates a 100 SEK, 60-second proposal with fixed versioned stop, target and slippage limits. It never creates an execution intent or provider order. Live execution remains disabled.
