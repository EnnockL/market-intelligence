import { describe, expect, it, vi } from "vitest";
import { IngestionRepository } from "@/repositories/ingestion-repository";

function fixture(error: Error | null = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { repo: new IngestionRepository({ from } as any), from, update, eq };
}

describe("failed ingestion run persistence", () => {
  it("retains successfully persisted partial progress while marking the run failed", async () => {
    const { repo, from, update, eq } = fixture();
    await repo.failRun("run", Object.assign(new Error("Partial batch"), { code: "PARTIAL" }), 3);
    expect(from).toHaveBeenCalledWith("ingestion_runs");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", records_processed: 3, error_code: "PARTIAL" }));
    expect(eq).toHaveBeenCalledWith("id", "run");
  });

  it("does not clear an existing count when the caller has no measured count", async () => {
    const { repo, update } = fixture();
    await repo.failRun("run", new Error("Unavailable"));
    expect(update.mock.calls[0][0]).not.toHaveProperty("records_processed");
  });

  it("does not silently accept a failed status write", async () => {
    const error = new Error("STATUS_WRITE_FAILED");
    await expect(fixture(error).repo.failRun("run", new Error("Partial batch"), 3)).rejects.toBe(error);
  });

  it.each([-1, 1.5, NaN, Infinity])("rejects invalid counts before writing (%s)", async count => {
    const { repo, from } = fixture();
    await expect(repo.failRun("run", new Error("Partial batch"), count)).rejects.toThrow("INVALID_INGESTION_RECORD_COUNT");
    expect(from).not.toHaveBeenCalled();
  });
});
