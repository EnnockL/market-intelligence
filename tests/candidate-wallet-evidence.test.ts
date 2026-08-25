import { describe, expect, it } from "vitest";
import { deriveCandidateIndependence } from "@/services/wallet-intelligence/candidate-wallet-evidence";

describe("candidate wallet evidence", () => {
  it("derives candidate-specific groups instead of using global snapshot counts", () => {
    const result = deriveCandidateIndependence([
      { wallet_id: "a", cluster_id: "cluster-1", relationship_status: "clustered", cluster_confidence: 90 },
      { wallet_id: "b", cluster_id: "cluster-1", relationship_status: "clustered", cluster_confidence: 90 },
      { wallet_id: "c", cluster_id: null, relationship_status: "independent", cluster_confidence: null },
    ], { status: "available", relationship_coverage: 100, data_quality: 92 });
    expect(result.confirmedIndependent).toBe(2);
    expect(result.clusterAdjustedCount).toBe(2.1);
  });

  it("returns UNKNOWN when any candidate wallet relationship is unknown", () => {
    const result = deriveCandidateIndependence([
      { wallet_id: "a", cluster_id: null, relationship_status: "unknown", cluster_confidence: null },
    ], { status: "available", relationship_coverage: 0, data_quality: 30 });
    expect(result.confirmedIndependent).toBeNull();
    expect(result.clusterAdjustedCount).toBeNull();
  });
});
