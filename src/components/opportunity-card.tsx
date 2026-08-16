import Link from "next/link";
import type { Opportunity } from "@/domain/market";
import { ScoreRing } from "./score-ring";

export function OpportunityCard({ opportunity, rank }: { opportunity: Opportunity; rank: number }) {
  return (
    <Link className="opportunity-card" href={`/assets/${opportunity.id}`}>
      <div className="opportunity-card__rank">#{rank}</div>
      <div className={`asset-icon asset-icon--${opportunity.kind}`}>{opportunity.symbol.slice(0, 2)}</div>
      <div className="opportunity-card__content">
        <div className="asset-heading">
          <div><strong>{opportunity.symbol}</strong><span>{opportunity.name}</span></div>
          <span className={`tag tag--${opportunity.kind}`}>{opportunity.kind}</span>
        </div>
        <p>{opportunity.summary}</p>
        <div className="factor-list">
          {opportunity.factors.slice(0, 2).map((factor) => <span key={factor}>↗ {factor}</span>)}
        </div>
      </div>
      <div className="price-block">
        <strong>${opportunity.price < 1 ? opportunity.price.toFixed(5) : opportunity.price.toFixed(2)}</strong>
        <span className={opportunity.change24h >= 0 ? "positive" : "negative"}>{opportunity.change24h >= 0 ? "+" : ""}{opportunity.change24h}%</span>
      </div>
      <ScoreRing score={opportunity.opportunityScore} />
    </Link>
  );
}

