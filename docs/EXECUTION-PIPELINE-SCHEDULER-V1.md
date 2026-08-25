# Execution Pipeline Scheduler v1

One PostgreSQL-leased scheduler job runs the shadow execution chain every minute in a fixed order: proposal production, eligibility, account/risk snapshot, execution bridge, and shadow/demo execution. The existing scheduler provides exclusive claims, heartbeat, crash recovery, retry/backoff, last-success timestamps, and immutable run metrics.

The pipeline stops on the first failed boundary. It cannot bypass eligibility or the final safety bridge, and the database invariant continues to forbid live execution.
