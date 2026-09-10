import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SafetyContext } from "@/domain/execution";
import { ExecutionService } from "@/services/execution/service";
import { ShadowExecutionProvider } from "@/services/execution/shadow-provider";
import { submissionFixture } from "./support/execution-submission-fixture";

describe("execution creation retries preserve existing state", () => {
  it.each(["SUBMITTING", "SUBMITTED", "ACKNOWLEDGED", "FILLED", "BLOCKED"])("never resets %s to SAFETY_PASSED", async currentState => {
    const upserts: any[] = [], events: unknown[] = [];
    const db = { from(table: string) {
      const builder: any = {
        select() { return builder; }, eq() { return builder; },
        upsert(value: unknown, options: any) { upserts.push({ table, value, options }); if (table === "execution_order_events") events.push(value); return builder; },
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: table === "execution_orders" ? { id: "order-1", current_state: currentState, created_at: "2026-09-07T12:00:00.000Z" } : table === "execution_intents" ? { id: "intent-1", strategy_attribution_id: null } : { id: "safety-1" }, error: null }),
      }; return builder;
    } };
    const fixture = submissionFixture(), context: SafetyContext = { ...(fixture.safety as any).context, mode: "SHADOW", killSwitch: false, newOrdersEnabled: true, liveExecutionEnabled: false, providerStatus: "HEALTHY", credentialsValid: true, tradePermission: true, withdrawPermission: false, openPositions: 0, dailyLossSek: 0, totalExposureSek: 0, availableCashSek: 1000 };
    const provider = new ShadowExecutionProvider(), place = vi.spyOn(provider, "placeOrder");
    const result = await new ExecutionService(db as unknown as SupabaseClient, provider).createAndEvaluate(fixture.intent, context, (fixture.control as any).limits);
    expect(result.orderId).toBe("order-1");
    expect(upserts).toHaveLength(3);
    expect(upserts.every(row => row.options.ignoreDuplicates === true)).toBe(true);
    expect(events).toEqual([]);
    expect(place).not.toHaveBeenCalled();
  });
});
