import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDataGapClosure } from "@/workers/data-gap-closure";

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/services/data-gap-closure/service", () => ({ DataGapClosureService: class { run = run; } }));

function setup() {
  const repo = { startRun: vi.fn(async () => "run"), finishRun: vi.fn(), failRun: vi.fn(), recordProviderError: vi.fn() };
  const invoke = () => runDataGapClosure({} as never, repo as never, { name: "liquidity" } as never, { name: "risk" } as never);
  return { repo, invoke };
}
const result = { candidates: 2, created: 1, waitingEvidence: 0, failed: 0, bounded: true, maximumCandidates: 4, summaries: [] };

describe("data gap worker health", () => {
  beforeEach(() => vi.clearAllMocks());
  it("fails mixed processing batches while retaining the exact committed count in diagnostics", async () => {
    const f = setup();
    run.mockResolvedValue({ ...result, failed: 1, summaries: [{ status: "PARTIAL", errors: [] }, { status: "FAILED", errors: ["READ_FAILED"] }] });
    await expect(f.invoke()).rejects.toThrow("1/2 candidates had processing/provider failures; 1 revisions committed");
    expect(f.repo.finishRun).not.toHaveBeenCalled();
    expect(f.repo.failRun).toHaveBeenCalledOnce();
    expect(f.repo.recordProviderError).toHaveBeenCalledWith("run", "data-gap-closure", expect.any(Error), expect.objectContaining({ committedRevisions: 1, failedCandidates: 1 }));
  });
  it("does not label a persisted partial assessment with a provider failure healthy", async () => {
    const f = setup();
    run.mockResolvedValue({ ...result, summaries: [{ status: "PARTIAL", errors: ["RISK:RATE_LIMITED"] }] });
    await expect(f.invoke()).rejects.toThrow("DATA_GAP_BATCH_PARTIAL");
    expect(f.repo.finishRun).not.toHaveBeenCalled();
  });
  it("allows honest missing evidence and queued future evidence without inventing an operational failure", async () => {
    const f = setup();
    run.mockResolvedValue({ ...result, waitingEvidence: 1, summaries: [{ status: "WAITING_EVIDENCE", errors: [] }, { status: "PARTIAL", errors: [] }] });
    await expect(f.invoke()).resolves.toMatchObject({ runId: "run", waitingEvidence: 1 });
    expect(f.repo.finishRun).toHaveBeenCalledWith("run", 1);
    expect(f.repo.failRun).not.toHaveBeenCalled();
  });
});
