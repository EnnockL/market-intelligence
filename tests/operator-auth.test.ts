import { describe, expect, it } from "vitest";
import { matchesOperatorToken, operatorTokenConfigured, OPERATOR_SESSION_TTL_SECONDS, safeOperatorReturnPath, signOperatorSession, verifyOperatorSession } from "@/lib/operator-auth";

const token = "test-only-operator-token-with-32-plus-characters";
const now = Date.parse("2026-09-07T10:00:00.000Z");

describe("operator session signature", () => {
  it("accepts an authentic unexpired session without exposing token or nonce", () => {
    const signed = signOperatorSession(token, now);
    expect(signed).not.toContain(token);
    expect(verifyOperatorSession(signed, token, now)).toEqual({ expiresAt: now + OPERATOR_SESSION_TTL_SECONDS * 1000 });
    expect(signOperatorSession(token, now)).not.toBe(signed);
  });
  it.each([undefined, "", "short"])("fails closed for missing or weak configuration: %s", configured => {
    expect(operatorTokenConfigured(configured)).toBe(false);
    expect(matchesOperatorToken(token, configured)).toBe(false);
    expect(verifyOperatorSession(signOperatorSession(token, now), configured, now)).toBeNull();
  });
  it("uses only the configured operator token and rejects oversized/invalid input", () => {
    expect(matchesOperatorToken(token, token)).toBe(true);
    expect(matchesOperatorToken(`${token}x`, token)).toBe(false);
    expect(matchesOperatorToken(null, token)).toBe(false);
    expect(matchesOperatorToken("x".repeat(4097), token)).toBe(false);
  });
  it.each([undefined, "", "invalid", "a.b.c", "a.=", "x".repeat(1025)])("rejects malformed cookies: %s", cookie => {
    expect(verifyOperatorSession(cookie, token, now)).toBeNull();
  });
  it("rejects expiration at the precise boundary and sessions issued in the future", () => {
    const signed = signOperatorSession(token, now);
    expect(verifyOperatorSession(signed, token, now + OPERATOR_SESSION_TTL_SECONDS * 1000 - 1)).not.toBeNull();
    expect(verifyOperatorSession(signed, token, now + OPERATOR_SESSION_TTL_SECONDS * 1000)).toBeNull();
    expect(verifyOperatorSession(signed, token, now - 1000)).toBeNull();
  });
  it("rejects changed claims, signatures and rotated keys", () => {
    const signed = signOperatorSession(token, now), [payload, signature] = signed.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const changedPayload = Buffer.from(JSON.stringify({ ...claims, exp: claims.exp + 3600 })).toString("base64url");
    expect(verifyOperatorSession(`${changedPayload}.${signature}`, token, now)).toBeNull();
    expect(verifyOperatorSession(`${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`, token, now)).toBeNull();
    expect(verifyOperatorSession(signed, `${token}-rotated`, now)).toBeNull();
    expect(verifyOperatorSession(signed, token, Number.NaN)).toBeNull();
  });
  it("never permits an external, protocol-relative or arbitrary return URL", () => {
    expect(safeOperatorReturnPath("/execution")).toBe("/execution");
    for (const path of ["https://example.com", "//example.com", "/\\example.com", "/operator", "/api/cron/forecast", "/execution?next=https://example.com", undefined]) expect(safeOperatorReturnPath(path)).toBe("/");
  });
});
