import { createServiceClient } from "@/lib/supabase/server";
import { ValidationControls } from "./validation-controls";
import styles from "./strategy-validation.module.css";
export const dynamic = "force-dynamic";
export default async function Page() {
  const db = createServiceClient();
  const [
    v,
    r,
    h,
    p,
    d,
    e,
    plans,
    shadow,
    signalEvaluations,
    signals,
    shadowTrades,
    promotions,
    lifecycle,
    researchCycles,
  ] = await Promise.all([
    db
      .from("strategy_validation_runs")
      .select("*,strategy_definitions(name,strategy_key,version)")
      .order("created_at", { ascending: false })
      .limit(30),
    db
      .from("strategy_runtime_assessments")
      .select("*,strategy_definitions(name,strategy_key,version)")
      .order("created_at", { ascending: false })
      .limit(30),
    db
      .from("strategy_hypotheses")
      .select("id,strategy_definition_id,hypothesis_version,thesis", {
        count: "exact",
      })
      .order("created_at", { ascending: false }),
    db
      .from("strategy_validation_protocols")
      .select("protocol_key,version,status")
      .eq("status", "ACTIVE")
      .order("version", { ascending: false })
      .limit(1),
    db
      .from("strategy_definitions")
      .select("id,name,strategy_key,version")
      .eq("status", "ACTIVE")
      .order("name"),
    db
      .from("strategy_evaluation_runs")
      .select(
        "id,strategy_definition_id,status,trade_count,information_cutoff_at,assets(symbol),strategy_definitions(name,version)",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("strategy_validation_window_plans")
      .select("*,strategy_definitions(name)")
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("strategy_shadow_observations")
      .select("*,strategy_definitions(name)")
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("strategy_signal_evaluations")
      .select(
        "id,decision,blockers,information_cutoff_at,strategy_definitions(name)",
      )
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("strategy_runtime_signals")
      .select(
        "id,side,asset_id,setup_at,entry,stop,target,strategy_definitions(name)",
      )
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("strategy_shadow_trade_revisions")
      .select(
        "id,signal_id,revision_number,state,exit_reason,modeled_r,stress_r,information_cutoff_at",
      )
      .order("created_at", { ascending: false })
      .limit(30),
    db.from("strategy_promotion_evaluations").select("id,decision,from_state,target_state,required_phase,blockers,information_cutoff_at,strategy_definitions(name)").order("created_at",{ascending:false}).limit(20),
    db.from("strategy_lifecycle_revisions").select("id,state,revision_number,information_cutoff_at,strategy_definitions(name)").order("created_at",{ascending:false}).limit(20),
    db.from("strategy_research_cycle_runs").select("id,status,blockers,progress,information_cutoff_at,strategy_definitions(name,strategy_key,version),strategy_hypotheses(hypothesis_version)").order("created_at",{ascending:false}).limit(30),
  ]);
  const vr: any[] = v.data ?? [],
    rr: any[] = r.data ?? [],
    latest = vr[0],
    runtime = rr[0],
    protocol: any = p.data?.[0];
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p>VALIDATION CONTROL PLANE</p>
        <h1>
          Prove the edge.
          <br />
          Then protect it.
        </h1>
        <span>
          Immutable learning windows, honest out-of-sample evidence and runtime
          governance with NO_TRADE as default.
        </span>
      </section>
      <section className={styles.summary}>
        <Metric
          label="Active protocol"
          value={
            protocol
              ? `${protocol.protocol_key} v${protocol.version}`
              : "NOT APPLIED"
          }
        />
        <Metric label="Hypotheses" value={String(h.count ?? 0)} />
        <Metric label="Validation runs" value={String(vr.length)} />
        <Metric label="Runtime default" value="NO_TRADE" />
      </section>
      <ValidationControls
        definitions={(d.data ?? []) as any}
        hypotheses={(h.data ?? []) as any}
        runs={(e.data ?? []).map((x: any) => ({
          id: x.id,
          strategy_definition_id: x.strategy_definition_id,
          label: `${rel(x.strategy_definitions)?.name ?? "Strategy"} · ${rel(x.assets)?.symbol ?? "Asset"} · ${x.trade_count} trades · ${date(x.information_cutoff_at)}`,
        }))}
      />
      <section className={styles.grid}>
        <Panel
          title="Research queue"
          label="STRATEGY RESEARCH CYCLE"
          side="15 MIN"
        >
          {researchCycles.data?.length ? (
            <History
              rows={researchCycles.data as any[]}
              render={(x: any) => {
                const progress = x.progress ?? {};
                const definition = rel(x.strategy_definitions);
                return {
                  name: `${definition?.name ?? "Strategy"} v${definition?.version ?? "?"}`,
                  detail: `${progress.trades ?? 0}/${progress.requiredTrades ?? 30} trades · ${progress.setups ?? 0} setups · cutoff ${date(x.information_cutoff_at)}`,
                  status: x.status,
                  decision:
                    x.status === "READY_FOR_VALIDATION"
                      ? "APPROVED"
                      : x.status === "REJECTED"
                        ? "REJECTED"
                        : "INSUFFICIENT_DATA",
                };
              }}
            />
          ) : (
            <Empty text="The automated research cycle has not evaluated its first alternative strategy yet." />
          )}
          <footer>
            Rejected definitions are excluded. Each alternative gets its own
            immutable hypothesis and evaluation evidence before validation.
          </footer>
        </Panel>
        <Panel title="No threshold hunting" label="RESEARCH INVARIANTS" side="V1">
          <div className={styles.timeline}>
            {["Rejected history remains immutable", "One hypothesis per rule version", "Minimum sample remains enforced", "No automatic capital promotion"].map((x, i) => (
              <div key={x}>
                <b>{String(i + 1).padStart(2, "0")}</b>
                <span>{x}</span>
              </div>
            ))}
          </div>
          <footer>New evidence can create a new version, never rewrite the failed one.</footer>
        </Panel>
      </section>
      <section className={styles.grid}>
        <Panel title={lifecycle.data?.[0]?.state ?? "RESEARCH"} label="AUTOMATED PROMOTION" side="STRICT SEQUENCE">
          {promotions.data?.length ? <History rows={promotions.data as any[]} render={(x:any)=>({name:rel(x.strategy_definitions)?.name??"Strategy",detail:x.blockers?.length?x.blockers.join(" · "):`${x.from_state} → ${x.target_state}`,status:x.decision,decision:x.decision==="PROMOTE"?"APPROVED":x.decision==="REJECT"?"REJECTED":"INSUFFICIENT_DATA"})}/> : <Empty text="Promotion worker has not evaluated a strategy yet."/>}
          <footer>Learning → freeze → out-of-sample → demo → approved shadow. Missing evidence always blocks promotion.</footer>
        </Panel>
        <Panel title="No silent skips" label="PROMOTION GUARANTEES" side="V1">
          <div className={styles.timeline}>{["Immutable evidence","Point-in-time cutoff","Fixed thresholds","Runtime gates remain active"].map((x,i)=><div key={x}><b>{String(i+1).padStart(2,"0")}</b><span>{x}</span></div>)}</div>
          <footer>Approved shadow authorizes research observation only; it never authorizes live execution.</footer>
        </Panel>
      </section>
      <section className={styles.grid}>
        <Panel
          title="Next honest window"
          label="AUTOMATED WINDOWS"
          side="HOURLY"
        >
          {plans.data?.length ? (
            <History
              rows={plans.data as any[]}
              render={(x: any) => ({
                name: rel(x.strategy_definitions)?.name ?? "Strategy",
                detail: `${x.phase ?? "COMPLETE"} · ${x.reason ?? `${date(x.window_start)} → ${date(x.window_end)}`}`,
                status: x.status,
                decision:
                  x.status === "READY"
                    ? "APPROVED"
                    : x.status === "BLOCKED"
                      ? "REJECTED"
                      : "INSUFFICIENT_DATA",
              })}
            />
          ) : (
            <Empty text="Scheduler has not audited a validation window yet." />
          )}
          <footer>
            Chronological, non-overlapping and point-in-time. Thresholds never
            relax automatically.
          </footer>
        </Panel>
        <Panel
          title="Execution observations"
          label="SHADOW / DEMO TRACKING"
          side="5 MIN"
        >
          {shadow.data?.length ? (
            <History
              rows={shadow.data as any[]}
              render={(x: any) => ({
                name: rel(x.strategy_definitions)?.name ?? "Strategy",
                detail: `${x.mode} · global fills ${x.global_metrics?.fills ?? 0} · cutoff ${date(x.information_cutoff_at)}`,
                status: `ATTRIBUTION ${x.attribution_status}`,
                decision: "INSUFFICIENT_DATA",
              })}
            />
          ) : (
            <Empty text="No strategy is currently in DEMO_VALIDATION or APPROVED_SHADOW." />
          )}
          <footer>
            Global execution is factual. Strategy attribution stays UNKNOWN
            until execution carries a stable strategy reference.
          </footer>
        </Panel>
      </section>
      <section className={styles.grid}>
        <Panel title="Learning to limited live" label="VALIDATION LIFECYCLE">
          <div className={styles.timeline}>
            {[
              "LEARNING",
              "FROZEN",
              "OUT_OF_SAMPLE",
              "DEMO_VALIDATION",
              "APPROVED_SHADOW",
              "LIVE_LIMITED",
            ].map((x, i) => (
              <div key={x}>
                <b>{String(i + 1).padStart(2, "0")}</b>
                <span>{x.replaceAll("_", " ")}</span>
              </div>
            ))}
          </div>
          <footer>No phase can silently skip its predecessor.</footer>
        </Panel>
        <Panel
          title={latest?.decision ?? "INSUFFICIENT_DATA"}
          label="LATEST DECISION"
        >
          {latest ? (
            <Gates gates={latest.gates} />
          ) : (
            <Empty text="No immutable validation run exists yet." />
          )}
          <footer>
            {latest
              ? `Cutoff ${date(latest.information_cutoff_at)}`
              : "Register a hypothesis first."}
          </footer>
        </Panel>
      </section>
      <Panel
        title={runtime?.decision ?? "NO_TRADE"}
        label="RUNTIME GOVERNANCE"
        side={runtime?.runtime_state ?? "RESEARCH"}
      >
        {runtime ? (
          <div className={styles.runtime}>
            <Gates gates={runtime.gates} />
            <div className={styles.diagnostics}>
              <Metric
                label="Edge decay"
                value={runtime.edge_decay?.status ?? "UNKNOWN"}
              />
              <Metric
                label="Correlation"
                value={num(runtime.correlation_assessment?.value)}
              />
              <Metric
                label="Coverage"
                value={pct(runtime.correlation_assessment?.coverage)}
              />
              <Metric
                label="Risk of ruin"
                value={pct(runtime.risk_diagnostics?.riskOfRuin)}
              />
              <Metric
                label="Kelly cap"
                value={pct(runtime.risk_diagnostics?.fractionalKellyCap)}
              />
              <Metric
                label="Revalidation"
                value={runtime.revalidation_required ? "REQUIRED" : "NO"}
              />
            </div>
          </div>
        ) : (
          <Empty text="No runtime assessment exists. Missing evidence remains UNKNOWN and trading remains blocked." />
        )}
      </Panel>
      <section className={styles.grid}>
        <Panel
          title={`${signals.data?.length ?? 0} immutable signals`}
          label="STRATEGY SIGNAL PRODUCER"
          side="SHADOW ONLY"
        >
          {signalEvaluations.data?.length ? (
            <History
              rows={signalEvaluations.data as any[]}
              render={(x: any) => ({
                name: rel(x.strategy_definitions)?.name ?? "Strategy",
                detail: x.blockers?.length
                  ? x.blockers.join(" · ")
                  : `Cutoff ${date(x.information_cutoff_at)}`,
                status: x.decision,
                decision:
                  x.decision === "SIGNAL_CREATED"
                    ? "APPROVED"
                    : "INSUFFICIENT_DATA",
              })}
            />
          ) : (
            <Empty text="No signal evaluation exists yet. NO_TRADE remains the safe default." />
          )}
          <footer>
            Only APPROVED validation plus SHADOW_ONLY runtime governance can
            create a signal. This worker cannot place a live order.
          </footer>
        </Panel>
        <Panel
          title="Modeled vs stress"
          label="SHADOW EXECUTION"
          side="NO EXCHANGE"
        >
          {shadowTrades.data?.length ? (
            <History
              rows={shadowTrades.data as any[]}
              render={(x: any) => ({
                name: `${x.state} · revision ${x.revision_number}`,
                detail:
                  x.state === "CLOSED"
                    ? `${x.exit_reason} · modeled ${rValue(x.modeled_r)} · stress ${rValue(x.stress_r)}`
                    : `Awaiting point-in-time exit evidence · ${date(x.information_cutoff_at)}`,
                status: x.state,
                decision:
                  x.state === "CLOSED" && Number(x.stress_r) > 0
                    ? "APPROVED"
                    : "INSUFFICIENT_DATA",
              })}
            />
          ) : (
            <Empty text="No shadow trade exists because no approved runtime signal has fired." />
          )}
          <footer>
            Modeled and stressed fills are immutable research observations,
            never account orders.
          </footer>
        </Panel>
      </section>
      <Panel title="Validation evidence" label="IMMUTABLE HISTORY">
        {vr.length ? (
          <History
            rows={vr}
            render={(x: any) => ({
              name: rel(x.strategy_definitions)?.name ?? "Unknown strategy",
              detail: `${x.phase} · cutoff ${date(x.information_cutoff_at)}`,
              status: x.decision,
              decision: x.decision,
            })}
          />
        ) : (
          <Empty text="Runs appear here after a registered hypothesis is evaluated against a frozen dataset." />
        )}
      </Panel>
    </main>
  );
}
function Panel({
  title,
  label,
  side,
  children,
}: {
  title: string;
  label: string;
  side?: string;
  children: any;
}) {
  return (
    <article className={styles.panel}>
      <header>
        <div>
          <p>{label}</p>
          <h2>{title}</h2>
        </div>
        {side && <span>{side}</span>}
      </header>
      {children}
    </article>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
function Gates({ gates }: { gates: any[] }) {
  return (
    <div className={styles.gates}>
      {(gates ?? []).map((x) => (
        <div key={x.code}>
          <span>{x.code.replaceAll("_", " ")}</span>
          <b data-status={x.status}>{x.status}</b>
        </div>
      ))}
    </div>
  );
}
function History({ rows, render }: { rows: any[]; render: (x: any) => any }) {
  return (
    <div className={styles.history}>
      {rows.map((x) => {
        const y = render(x);
        return (
          <div key={x.id}>
            <span>
              <b>{y.name}</b>
              <small>{y.detail}</small>
            </span>
            <strong data-decision={y.decision}>{y.status}</strong>
          </div>
        );
      })}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className={styles.empty}>{text}</div>;
}
function rel(x: any) {
  return Array.isArray(x) ? x[0] : x;
}
function date(x: string) {
  return new Date(x).toLocaleString("sv-SE");
}
function num(x: unknown) {
  const n = Number(x);
  return Number.isFinite(n) ? n.toFixed(2) : "UNKNOWN";
}
function pct(x: unknown) {
  const n = Number(x);
  return x != null && Number.isFinite(n)
    ? `${(n * 100).toFixed(2)}%`
    : "UNKNOWN";
}
function rValue(x: unknown) {
  const n = Number(x);
  return x != null && Number.isFinite(n) ? `${n.toFixed(2)}R` : "UNKNOWN";
}
