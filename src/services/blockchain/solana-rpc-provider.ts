import { ProviderError } from "@/services/market-data/provider";
import { normalizeSolanaTransaction, deduplicateTransactions } from "./normalize-solana-transaction";
import type { BlockchainDataProvider, WalletTransactionBatch } from "./provider";

type Fetch = typeof fetch;

export class SolanaRpcProvider implements BlockchainDataProvider {
  readonly chain = "solana"; readonly name = "solana-rpc";
  constructor(private readonly rpcUrl: string, private readonly fetcher: Fetch = fetch) {}

  async getWalletTransactions(address: string, untilSignature?: string): Promise<WalletTransactionBatch> {
    const signatures = await this.rpc<Array<{ signature: string }>>("getSignaturesForAddress", [address, { limit: 10, ...(untilSignature ? { until: untilSignature } : {}) }]);
    const transactions = [];
    for (const item of signatures.value) {
      const transaction = await this.rpc<unknown>("getTransaction", [item.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
      if (transaction.value) transactions.push(...normalizeSolanaTransaction(transaction.value as Parameters<typeof normalizeSolanaTransaction>[0], address));
    }
    return { transactions: deduplicateTransactions(transactions), newestSignature: signatures.value[0]?.signature ?? null, rateLimit: signatures.rateLimit };
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<{ value: T; rateLimit: { remaining: number | null; resetAt: string | null } }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(this.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      } catch (error) {
        throw new ProviderError(`Solana RPC network failure: ${error instanceof Error ? error.message : "unknown error"}`, this.name, "unavailable", true);
      }
      const remaining = numericHeader(response.headers.get("x-ratelimit-remaining"));
      if (response.status === 429) {
        const providerDelay = retryAfter(response.headers.get("retry-after"));
        if (attempt < 2) { await delay(providerDelay ?? 1000 * 2 ** attempt); continue; }
        throw new ProviderError("Solana RPC rate limit reached after retries", this.name, "rate_limited", true, 429, providerDelay);
      }
      if (!response.ok) throw new ProviderError(`Solana RPC returned HTTP ${response.status}`, this.name, "unavailable", response.status >= 500, response.status);
      const payload = await response.json() as { result?: T; error?: { code: number; message: string } };
      if (payload.error || payload.result === undefined) throw new ProviderError(`Solana RPC error: ${payload.error?.message ?? "missing result"}`, this.name, "invalid_response", Boolean(payload.error?.code === -32005));
      return { value: payload.result, rateLimit: { remaining, resetAt: null } };
    }
    throw new ProviderError("Solana RPC retry limit reached", this.name, "rate_limited", true, 429);
  }
}

function numericHeader(value: string | null) { const parsed = value === null ? NaN : Number(value); return Number.isFinite(parsed) ? parsed : null; }
function retryAfter(value: string | null) { const seconds = numericHeader(value); return seconds === null ? null : seconds * 1000; }
function delay(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, Math.min(milliseconds, 10_000))); }
