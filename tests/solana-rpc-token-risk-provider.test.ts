import { describe, expect, it, vi } from "vitest";
import { FallbackTokenRiskProvider, SolanaRpcTokenRiskProvider } from "@/services/token-risk/solana-rpc-token-risk-provider";

function rpcResponse(result: unknown) { return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 }); }

describe("Solana RPC token risk provider", () => {
  it("normalizes authorities and holder concentration without inventing missing classifications", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const method = JSON.parse(String(init?.body)).method;
      if (method === "getAccountInfo") return rpcResponse({ value: { data: { parsed: { info: { mintAuthority: null, freezeAuthority: null, supply: "1000", extensions: [] } } } } });
      if (method === "getTokenLargestAccounts") return rpcResponse({ value: [{ amount: "100" }, { amount: "50" }] });
      return rpcResponse({ value: { amount: "1000" } });
    });
    const result = await new SolanaRpcTokenRiskProvider("https://rpc.example", fetcher as typeof fetch).assess("mint", new Date().toISOString());
    const components = (result.riskComponents as { components: Array<{ key:string; value:unknown; status:string }> }).components;
    expect(components.find((x) => x.key === "holder_concentration_top10")?.value).toBe(15);
    expect(components.find((x) => x.key === "mint_authority")?.status).toBe("safe");
    expect(result.rugStatus).toBe("UNKNOWN");
    expect(result.dataQuality).toBeLessThan(60);
  });

  it("marks a freeze authority as critical but remains UNKNOWN when overall coverage is insufficient", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const method = JSON.parse(String(init?.body)).method;
      if (method === "getAccountInfo") return rpcResponse({ value: { data: { parsed: { info: { mintAuthority: "mint-auth", freezeAuthority: "freeze-auth" } } } } });
      if (method === "getTokenLargestAccounts") return rpcResponse({ value: [{ amount: "900" }] });
      return rpcResponse({ value: { amount: "1000" } });
    });
    const result = await new SolanaRpcTokenRiskProvider("https://rpc.example", fetcher as typeof fetch).assess("mint", new Date().toISOString());
    expect((result.riskComponents as any).components.find((x:any) => x.key === "freeze_authority").status).toBe("critical");
    expect(result.rugStatus).toBe("UNKNOWN");
  });

  it("uses fallback deterministically when the primary provider fails", async () => {
    const primary = { name:"primary", assess:vi.fn(async()=>{ throw new Error("unauthorized"); }) };
    const fallback = { name:"fallback", assess:vi.fn(async(tokenId:string,cutoff:string)=>({ tokenId,provider:"fallback",riskVersion:"v1",assessedAt:cutoff,informationCutoffAt:cutoff,informationAvailableAt:cutoff,rugRiskScore:null,rugStatus:"UNKNOWN" as const,riskComponents:{},dataQuality:0 })) };
    expect((await new FallbackTokenRiskProvider(primary,fallback).assess("mint","2026-01-01T00:00:00Z")).provider).toBe("fallback");
  });
});
