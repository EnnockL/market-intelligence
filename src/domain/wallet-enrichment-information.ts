/** The current price providers cannot attest the complete execution context.
 * Report that limitation explicitly instead of manufacturing a score of 100.
 * A new evidence-backed adapter/version is required to close this gap. */
export function walletEnrichmentInformation(poolAddress: string | null) {
  return {
    version: "wallet-information-contract-v1",
    completeness: poolAddress ? 50 : 0,
    status: "incomplete" as const,
    evidence: { poolIdentified: Boolean(poolAddress), executionContextVerified: false },
    blockers: [
      ...(!poolAddress ? ["HISTORICAL_POOL_UNAVAILABLE"] : []),
      "VERIFIED_EXECUTION_CONTEXT_UNAVAILABLE",
    ],
  };
}
