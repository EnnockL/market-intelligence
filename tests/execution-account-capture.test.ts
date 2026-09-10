import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AccountStateService } from "@/services/execution/account-state-service";
import type { ExecutionProvider } from "@/services/execution/provider";

describe("account capture preserves operator controls", () => {
  it("does not overwrite an existing PAUSED account or its revision", async () => {
    const account = { id: "a", account_key: "shadow-primary", provider: "shadow-execution", provider_environment: "SHADOW", status: "PAUSED", revision: 7, initial_cash_sek: 1000 };
    const inserts: unknown[] = [], updates: unknown[] = [];
    const db = { from(table: string) {
      const builder: any = {
        select() { return builder; }, eq() { return builder; }, in() { return builder; }, gte() { return builder; }, lte() { return builder; }, order() { return builder; }, range() { return builder; },
        update(value: unknown) { updates.push({ table, value }); return builder; },
        upsert(value: unknown, options: unknown) { inserts.push({ table, value, options }); return builder; },
        single: async () => ({ data: { ...account }, error: null }),
        then(resolve: (value: unknown) => void) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      }; return builder;
    } };
    const provider = { mode: "SHADOW", name: "shadow-execution", getAccountState: vi.fn(async () => ({ balances: [], positions: [], totalEquityUsd: null, availableQuoteUsd: null, status: "UNKNOWN", unknownReasons: ["SHADOW_PROVIDER_HAS_NO_EXTERNAL_ACCOUNT"], observedAt: new Date().toISOString(), sourceReference: null })) } as unknown as ExecutionProvider;
    await new AccountStateService(db as unknown as SupabaseClient, provider).capture();
    expect(inserts[0]).toMatchObject({ table: "execution_accounts", options: { onConflict: "account_key", ignoreDuplicates: true } });
    expect(updates).toEqual([]);
    expect(account).toMatchObject({ status: "PAUSED", revision: 7 });
    expect(inserts).toContainEqual(expect.objectContaining({ table: "risk_ledger_snapshots", value: expect.objectContaining({ ledger_version: "account-ledger-v2", status: "UNKNOWN", cash_sek: null, open_quantity: null, average_cost_sek: null }) }));
  });
});
