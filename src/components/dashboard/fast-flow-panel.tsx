import Link from "next/link";
import type { FastFlowData } from "@/data/fast-flow-data";
import { DataStatus } from "./data-status";

export function FastFlowPanel({ data }: { data: FastFlowData }) {
  return <section className="radar-panel fast-flow-panel"><div className="panel-title fast-flow-title"><div><span className="eyebrow">EVIDENCE-BACKED</span><h2>Fast Flow ⚡</h2></div><DataStatus mode={data.mode} updatedAt={data.updatedAt} message={data.message} provider={data.provider} /></div>{data.items.length ? <div className="fast-flow-list">{data.items.map((item) => <Link href={`/opportunities/${item.id}`} key={item.id}><strong>{item.symbol}</strong><span>{item.walletCount ?? "UNKNOWN"} raw · {item.confirmedIndependentCount ?? "UNKNOWN"} independent</span><b>{item.state.replaceAll("_", " ")}</b><span>coverage {item.relationshipCoverage === null ? "UNKNOWN" : `${item.relationshipCoverage}%`}</span><span>adjusted {item.clusterAdjustedCount ?? "UNKNOWN"}</span><span>{item.evidenceCount ?? "UNKNOWN"} evidence</span><small>{item.blockers.length ? item.blockers.slice(0, 2).join(" · ") : "SAFETY PASS"}</small></Link>)}</div> : <div className="discovery-empty"><strong>No verified convergence yet</strong><span>{data.message}</span></div>}</section>;
}
