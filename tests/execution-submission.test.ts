import { describe, expect, it } from "vitest";
import { evaluateSubmissionEvidence } from "@/domain/execution-submission";
import { submissionFixture } from "./support/execution-submission-fixture";
import { rebuildAccountLedgerV2, type AccountLedgerV2Input } from "@/domain/account-ledger-v2";
import type { SubmissionEvidence } from "@/domain/execution-submission";

describe("final execution evidence", () => {
  it.each(["SHADOW", "DEMO"] as const)("re-evaluates complete current %s evidence", mode => {
    const result = evaluateSubmissionEvidence(submissionFixture(mode));
    expect(result.decision).toBe("PASSED");
    if (result.decision === "PASSED") expect(result).toMatchObject({ controlRevision: 1, accountRevision: 1, riskSnapshotId: "risk-1", dataAgeMs: 1500 });
  });
  it.each([
    ["kill switch", { kill_switch: true }, "FINAL_KILL_SWITCH_ACTIVE"],
    ["new orders disabled", { new_orders_enabled: false }, "FINAL_NEW_ORDERS_DISABLED"],
    ["live", { live_execution_enabled: true }, "FINAL_LIVE_EXECUTION_FORBIDDEN"],
    ["unknown boolean", { kill_switch: null }, "FINAL_CONTROL_UNKNOWN"],
    ["missing revision", { revision: undefined }, "FINAL_CONTROL_UNKNOWN"],
    ["mode changed", { mode: "DEMO" }, "FINAL_PROVIDER_MODE_MISMATCH"],
    ["provider unknown", { provider_status: "UNKNOWN" }, "FINAL_PROVIDER_UNAVAILABLE"],
  ])("blocks %s after enqueue", (_label, change, reason) => {
    const fixture = submissionFixture(); fixture.control = { ...(fixture.control as object), ...(change as object) };
    expect(evaluateSubmissionEvidence(fixture)).toEqual({ decision: "BLOCKED", reason });
  });
  it.each(["control", "account", "risk", "observation", "safety", "health"] as const)("blocks missing %s instead of defaulting to PASS", key => {
    const fixture = submissionFixture(); fixture[key] = null;
    expect(evaluateSubmissionEvidence(fixture).decision).toBe("BLOCKED");
  });
  it("blocks paused accounts, changed account identity and unknown demo observations", () => {
    const fixture = submissionFixture("DEMO");
    fixture.account = { ...(fixture.account as object), status: "PAUSED" };
    expect(evaluateSubmissionEvidence(fixture).reason).toBe("FINAL_ACCOUNT_PAUSED");
    const other = submissionFixture("DEMO"); other.observation = { ...(other.observation as object), data_status: "UNKNOWN" };
    expect(evaluateSubmissionEvidence(other).reason).toBe("FINAL_ACCOUNT_OBSERVATION_UNKNOWN");
    const mismatch = submissionFixture(); mismatch.risk = { ...(mismatch.risk as object), account_id: "another-account" };
    expect(evaluateSubmissionEvidence(mismatch).decision).toBe("BLOCKED");
  });
  it.each([
    { status: "UNKNOWN" }, { cash_sek: null }, { open_positions: -1 },
    { reserved_exposure_sek: null }, { unknown_reasons: ["MISSING_FILL"] },
    { information_cutoff_at: "2026-09-07T11:00:00.000Z" },
    { available_at: "2026-09-07T12:00:02.000Z" },
  ])("blocks invalid/latest unknown risk %j", change => {
    const fixture = submissionFixture(); fixture.risk = { ...(fixture.risk as object), ...change };
    expect(evaluateSubmissionEvidence(fixture).decision).toBe("BLOCKED");
  });
  it("rechecks current limits and expiry, including accumulated data age", () => {
    const smaller = submissionFixture(); const control: any = smaller.control; control.limits.maxOrderSek = 50;
    expect(evaluateSubmissionEvidence(smaller).reason).toBe("FINAL_ORDER_SIZE");
    const expired = submissionFixture(); expired.intent.expiresAt = expired.checkedAt;
    expect(evaluateSubmissionEvidence(expired).reason).toBe("FINAL_INTENT_EXPIRED");
    const stale = submissionFixture(); (stale.safety as any).context.dataAgeMs = 14500;
    expect(evaluateSubmissionEvidence(stale).reason).toBe("FINAL_FRESH_DATA");
  });
  it("does not let old PASS hide current provider permission or critical UNKNOWN", () => {
    const fixture = submissionFixture(); fixture.health = { ...(fixture.health as object), withdrawPermission: true };
    expect(evaluateSubmissionEvidence(fixture).reason).toBe("FINAL_NO_WITHDRAW_PERMISSION");
    const unknown = submissionFixture(); (unknown.safety as any).context.criticalSafety = "UNKNOWN";
    expect(evaluateSubmissionEvidence(unknown).reason).toBe("FINAL_CRITICAL_SAFETY");
  });

  it("rejects v1 KNOWN snapshots, missing/altered payloads and an unbound order", () => {
    for (const change of [{ ledger_version: "risk-ledger-v1" }, { ledger_payload: null }, { ledger_payload: {} }]) {
      const fixture = submissionFixture(); fixture.risk = { ...(fixture.risk as object), ...change };
      expect(evaluateSubmissionEvidence(fixture).decision).toBe("BLOCKED");
    }
    const altered = submissionFixture(); (altered.risk as any).ledger_payload.cashSek = 1000000;
    expect(evaluateSubmissionEvidence(altered).reason).toBe("FINAL_LEDGER_PAYLOAD_INVALID");
    const unbound = submissionFixture(); unbound.order.account_id = null;
    expect(evaluateSubmissionEvidence(unbound).reason).toBe("FINAL_ORDER_ACCOUNT_MISMATCH");
  });

  it("does not double-count its own queued reservation but keeps other pending BUYs", () => {
    const fixture = submissionFixture(); (fixture.control as any).limits.maxTotalExposureSek = 150;
    setLedger(fixture, { pendingOrders: [reservation("order-1", 100), reservation("other", 50)] });
    expect(evaluateSubmissionEvidence(fixture).decision).toBe("PASSED");
    const blocked = submissionFixture(); (blocked.control as any).limits.maxTotalExposureSek = 150;
    setLedger(blocked, { pendingOrders: [reservation("order-1", 100), reservation("other", 80)] });
    expect(evaluateSubmissionEvidence(blocked).reason).toBe("FINAL_TOTAL_EXPOSURE_LIMIT");
  });

  it("uses cash after OTHER reservations, not the ledger's gross cash scalar", () => {
    const fixture = submissionFixture(); (fixture.control as any).limits.maxTotalExposureSek = 500;
    setLedger(fixture, { openingCashSek: 200, pendingOrders: [reservation("other", 150)] });
    expect(evaluateSubmissionEvidence(fixture).reason).toBe("FINAL_AVAILABLE_CASH");
  });

  it("rejects stale economic coverage even with a fresh publication and knowledge cutoff", () => {
    const fixture = submissionFixture();
    setLedger(fixture, { economicCutoffAt: "2026-09-07T11:00:00.000Z" });
    expect(evaluateSubmissionEvidence(fixture).reason).toBe("FINAL_ACCOUNT_OR_RISK_STALE");
  });

  it("uses daily realized loss without erasing prior-day inventory basis or netting old gains", () => {
    const fixture = submissionFixture();
    setLedger(fixture, { fills: [ledgerFill("buy", "BUY", 2, 200, "2026-09-06T10:00:00.000Z"), ledgerFill("old-profit", "SELL", 1, 500, "2026-09-06T11:00:00.000Z"), ledgerFill("today-loss", "SELL", 1, 50, "2026-09-07T10:00:00.000Z")] });
    expect((fixture.risk as any).ledger_payload.realizedPnlSek).toBe(150);
    expect((fixture.risk as any).ledger_payload.dailyRealizedPnlSek).toBe(-150);
    expect(evaluateSubmissionEvidence(fixture).reason).toBe("FINAL_DAILY_LOSS_LIMIT");
  });

  it("SELL uses only its own instrument inventory less other SELL reservations", () => {
    const fixture = submissionFixture(); fixture.intent.side = "SELL";
    (fixture.control as any).limits.maxOpenPositions = 2;
    setLedger(fixture, { fills: [ledgerFill("buy", "BUY", 0.003, 10000, "2026-09-06T10:00:00.000Z")], marks: [{ instrumentId: "BTC-USDT", priceSek: 10000, observedAt: fixture.intent.informationCutoffAt, availableAt: fixture.intent.informationCutoffAt }], pendingOrders: [reservation("order-1", null, "SELL", 0.001), reservation("other", null, "SELL", 0.001)] });
    expect(evaluateSubmissionEvidence(fixture).decision).toBe("PASSED");
    fixture.intent.quantity = 0.003;
    expect(evaluateSubmissionEvidence(fixture).reason).toBe("FINAL_SELL_QUANTITY_UNAVAILABLE");
    fixture.intent.instrumentId = "ETH-USDT";
    expect(evaluateSubmissionEvidence(fixture).reason).toBe("FINAL_SELL_QUANTITY_UNAVAILABLE");
    fixture.intent.quantity = null;
    expect(evaluateSubmissionEvidence(fixture).reason).toBe("FINAL_SELL_QUANTITY_UNAVAILABLE");
  });
  it("rechecks a covered exit above all entry limits using current ledger quantities", () => {
    const f=submissionFixture(); f.intent.side="SELL";
    Object.assign((f.control as any).limits,{maxOpenPositions:1,maxTotalExposureSek:10,maxDailyLossSek:5});
    setLedger(f,{openingInventory:[{instrumentId:"BTC-USDT",quantity:2,referencePriceSek:100}],
      fills:[ledgerFill("loss","SELL",1,90,"2026-09-07T10:00:00.000Z")],
      marks:[{instrumentId:"BTC-USDT",priceSek:100,observedAt:f.intent.informationCutoffAt,availableAt:f.intent.informationCutoffAt}]});
    expect(evaluateSubmissionEvidence(f).decision).toBe("PASSED");
    (f.safety as any).policy_version="execution-safety-policy-v1";
    expect(evaluateSubmissionEvidence(f).reason).toBe("FINAL_SAFETY_EVIDENCE_UNKNOWN");
  });
});

function setLedger(fixture: SubmissionEvidence, change: Partial<AccountLedgerV2Input>) {
  const cutoff = fixture.intent.informationCutoffAt;
  const ledger = rebuildAccountLedgerV2({ accountId: "account-1", baselineAt: "2026-09-01T00:00:00.000Z", openingCashSek: 1000, openingCashStatus: "DECLARED", historyComplete: true, cutoffAt: cutoff, dailyWindowStartAt: "2026-09-07T00:00:00.000Z", fills: [], marks: [], pendingOrders: [], ...change });
  fixture.risk = { ...(fixture.risk as object), status: ledger.status, ledger_version: ledger.version, ledger_payload: ledger, cash_sek: ledger.cashSek, open_positions: ledger.openPositions, realized_pnl_sek: ledger.realizedPnlSek, reserved_exposure_sek: ledger.reservedBuySek, economic_cutoff_at: ledger.economicCutoffAt, information_cutoff_at: ledger.cutoffAt, unknown_reasons: ledger.unknownReasons };
}
function reservation(orderId: string, remainingNotionalSek: number | null, side: "BUY" | "SELL" = "BUY", remainingQuantity: number | null = null) { return { orderId, accountId: "account-1", instrumentId: "BTC-USDT", side, remainingQuantity, remainingNotionalSek, availableAt: "2026-09-07T12:00:00.000Z" }; }
function ledgerFill(fillId: string, side: "BUY" | "SELL", quantity: number, priceSek: number, occurredAt: string) { return { fillId, accountId: "account-1", instrumentId: "BTC-USDT", side, quantity, priceSek, feeSek: 0, feeAsset: "QUOTE" as const, feeBaseQuantity: null, occurredAt, availableAt: occurredAt }; }
