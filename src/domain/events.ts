import { createHash } from "node:crypto";

export const EVENT_SCHEMA_VERSION = 1 as const;

export interface EventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventKey: string;
  eventType: string;
  schemaVersion: number;
  entityType: string;
  entityId: string;
  assetId: string | null;
  walletId: string | null;
  occurredAt: string;
  observedAt: string;
  availableAt: string;
  provider: string;
  sourceRef: string;
  dataQuality: number;
  payload: TPayload;
}

export function walletTradeEventKey(input: { walletId: string; transactionHash: string; instructionIndex: number }) {
  return `wallet-trade:${input.walletId}:${input.transactionHash}:${input.instructionIndex}`;
}

export function deterministicDigest(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
