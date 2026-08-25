import { describe, expect, it } from "vitest";
import { selectWalletsForBackfill } from "@/workers/wallet-ingestion";

describe("wallet ingestion backfill budget", () => {
  it("selects the least recently backfilled incomplete wallets deterministically", () => {
    const selected = selectWalletsForBackfill([
      { id: "complete", address: "z", metadata: { backfill_complete: true } },
      { id: "new", address: "a", metadata: null },
      { id: "old", address: "b", metadata: { backfill_synced_at: "2026-01-01T00:00:00Z" } },
      { id: "recent", address: "c", metadata: { backfill_synced_at: "2026-02-01T00:00:00Z" } },
    ], 2);
    expect([...selected]).toEqual(["new", "old"]);
  });
});
