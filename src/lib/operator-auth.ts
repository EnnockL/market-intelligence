import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OPERATOR_SESSION_TTL_SECONDS = 2 * 60 * 60;
export const OPERATOR_AUTH_REQUIRED = "Logga in som operatör på /operator för att fortsätta.";
const SIGNING_CONTEXT = "market-intelligence/operator-session/v1:";
const MAX_TOKEN_LENGTH = 4096;

export interface OperatorSession { expiresAt: number }

export function operatorTokenConfigured(token: string | undefined): token is string {
  return typeof token === "string" && token.length >= 32 && token.length <= MAX_TOKEN_LENGTH;
}

export function matchesOperatorToken(supplied: unknown, configured: string | undefined): boolean {
  if (!operatorTokenConfigured(configured) || typeof supplied !== "string" || !supplied || supplied.length > MAX_TOKEN_LENGTH) return false;
  // Hash first so unequal token lengths do not bypass the constant-time comparison.
  return timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(configured).digest());
}

export function signOperatorSession(token: string, now = Date.now()): string {
  if (!operatorTokenConfigured(token) || !Number.isFinite(now)) throw new Error("Operator access is not configured.");
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: issuedAt, exp: issuedAt + OPERATOR_SESSION_TTL_SECONDS, nonce: randomBytes(16).toString("hex") })).toString("base64url");
  return `${payload}.${signature(payload, token).toString("base64url")}`;
}

export function verifyOperatorSession(value: string | undefined, token: string | undefined, now = Date.now()): OperatorSession | null {
  if (!operatorTokenConfigured(token) || !value || value.length > 1024 || !Number.isFinite(now)) return null;
  const pieces = value.split(".");
  if (pieces.length !== 2 || !pieces.every(piece => /^[A-Za-z0-9_-]+$/.test(piece))) return null;
  const [payload, encodedSignature] = pieces;
  const receivedSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = signature(payload, token);
  if (receivedSignature.toString("base64url") !== encodedSignature || receivedSignature.length !== expectedSignature.length || !timingSafeEqual(receivedSignature, expectedSignature)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const currentSeconds = Math.floor(now / 1000);
    if (claims?.v !== 1 || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > currentSeconds || claims.exp <= currentSeconds || claims.exp - claims.iat !== OPERATOR_SESSION_TTL_SECONDS || typeof claims.nonce !== "string" || !/^[a-f0-9]{32}$/.test(claims.nonce)) return null;
    return { expiresAt: claims.exp * 1000 };
  } catch { return null; }
}

function signature(payload: string, token: string) {
  return createHmac("sha256", token).update(SIGNING_CONTEXT).update(payload).digest();
}

const RETURN_PATHS = new Set(["/", "/execution", "/data-collection", "/strategy-lab", "/strategy-validation", "/simulation", "/replay"]);
export function safeOperatorReturnPath(value: unknown): string {
  return typeof value === "string" && RETURN_PATHS.has(value) ? value : "/";
}
