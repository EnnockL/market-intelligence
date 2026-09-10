import type { ProviderOrder } from "./provider";

export interface OrderObservation {
  version: "execution-order-observation-v1";
  providerOrderId: string;
  clientOrderId: string;
  state: ProviderOrder["state"];
  filledQuantity: number;
  averagePrice: number | null;
  observedAt: string;
}

/** Narrow DTO: no raw provider errors, URLs, credentials or invented fills. */
export function normalizeOrderObservation(value: unknown, clientOrderId: string, now = Date.now()): OrderObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RECONCILIATION_OBSERVATION_INVALID");
  const row = value as Record<string, unknown>;
  if (typeof row.providerOrderId !== "string" || !row.providerOrderId || row.providerOrderId.length > 128
    || row.clientOrderId !== clientOrderId
    || !["ACKNOWLEDGED", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED"].includes(String(row.state))
    || typeof row.filledQuantity !== "number" || !Number.isFinite(row.filledQuantity) || row.filledQuantity < 0
    || !(row.averagePrice === null || (typeof row.averagePrice === "number" && Number.isFinite(row.averagePrice) && row.averagePrice > 0))
    || (row.filledQuantity > 0 && row.averagePrice === null) || (row.filledQuantity === 0 && row.averagePrice !== null)
    || typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt)) || Date.parse(row.observedAt) > now) {
    throw new Error("RECONCILIATION_OBSERVATION_INVALID");
  }
  return { version: "execution-order-observation-v1", providerOrderId: row.providerOrderId, clientOrderId,
    state: row.state as ProviderOrder["state"], filledQuantity: row.filledQuantity,
    averagePrice: row.averagePrice as number | null, observedAt: new Date(row.observedAt).toISOString() };
}
