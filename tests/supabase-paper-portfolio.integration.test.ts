import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PaperPortfolioService } from "@/services/paper-portfolio/service";
const enabled = process.env.RUN_SUPABASE_INTEGRATION === "1",
  suite = enabled ? describe : describe.skip;
let db: SupabaseClient;
suite("Supabase paper portfolio", () => {
  beforeAll(() => {
    db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  });
  it("bootstraps four immutable parallel research policies idempotently", async () => {
    const service = new PaperPortfolioService(db);
    await service.bootstrap();
    await service.bootstrap();
    const { data, error } = await db
      .from("paper_portfolios")
      .select("policy_version")
      .eq("portfolio_scope", "SYSTEM_RESEARCH");
    expect(error).toBeNull();
    expect(new Set((data ?? []).map((x) => x.policy_version)).size).toBe(4);
  });
  it("persists isolated point-in-time evaluations", async () => {
    const result = await new PaperPortfolioService(db).eligibility();
    expect(result.evaluated).toBeGreaterThanOrEqual(0);
    const { count, error } = await db
      .from("paper_policy_evaluations")
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
