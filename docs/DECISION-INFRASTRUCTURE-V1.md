# Decision Infrastructure v1

This sprint implements the shared backbone described in `MASTER-ARCHITECTURE.md`. It deliberately does not implement Fast Flow, Jackpot, Meta weighting, LLM analysis, or execution.

## Contracts

### Event identity

External observations use a deterministic `event_id` derived from provider, source reference, event type, entity type, and entity ID. Re-publishing the same observation is a no-op. The payload has a deterministic SHA-256 hash; changed content must be represented as a new source observation rather than silently replacing an event.

The envelope carries occurrence, observation, and availability timestamps plus correlation and causation IDs. Unknown confidence remains `null`.

### Delivery semantics

PostgreSQL outbox delivery is **at least once**. `claim_outbox_events` atomically claims ordered work with `FOR UPDATE SKIP LOCKED`. A processing lease can be reclaimed after a worker crash. Acknowledgement and rejection require the same worker ID that owns the lease.

Handlers must therefore be idempotent. Database uniqueness on `event_id`, opportunity identity, and revision identity prevents duplicate durable outcomes during retry.

The application depends on `EventTransport`, not outbox columns. PostgreSQL is transport v1; another transport can implement the same claim/ack/reject contract.

### Opportunity identity and revisions

Opportunity identity is deterministic from asset, opportunity type, and source event. Every state change is an append-only revision. Revision identity includes trigger event, cutoff, evidence IDs, outputs, safety result, type, and resulting state.

State transitions are checked in TypeScript and PostgreSQL. Revisions, evidence records, and revision/evidence links reject update and delete operations.

### Point-in-time evidence

Evidence is registered once with stable source identity, payload hash, and `available_at`. A revision transaction resolves the requested IDs from the registry and rejects missing evidence or evidence whose availability is later than `information_cutoff_at`.

## Migration

`0014_decision_infrastructure_v1.sql` upgrades the initial outbox and opportunity tables from migration `0013`, adds delivery leases/retries, introduces the evidence registry, and installs atomic opportunity functions.

## Known technical debt

- Existing observation tables are not yet automatically registered as evidence; each future producer must call the evidence repository after persisting its immutable source record.
- Dead-letter policy, retention, pruning, and operational outbox metrics are deferred.
- PostgreSQL integration tests require a running local Supabase/Docker instance or valid remote database credentials. Domain and transport behavior are covered in-memory meanwhile.
- Legacy revision payload columns introduced in migration `0013` remain for forward-compatible migration safety but are no longer authoritative. The evidence registry and revision link table are authoritative in v1.
