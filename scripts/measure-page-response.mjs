// Read-only, local HTTP timing probe. This does not measure browser rendering
// or Core Web Vitals, and must not be pointed at action/worker endpoints.
import { performance } from "node:perf_hooks";

const target = new URL(process.argv[2] ?? "http://localhost:3107/");
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
  throw new Error("This probe only accepts a local preview URL.");
}
const runs = Number(process.argv[3] ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error("Use 1–10 samples.");

for (let run = 1; run <= runs; run += 1) {
  const start = performance.now();
  const response = await fetch(target, {
    headers: { "Accept-Encoding": "identity" },
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  const headersAt = performance.now();
  const reader = response.body.getReader();
  let firstChunkAt = null;
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    firstChunkAt ??= performance.now();
    bytes += chunk.value.byteLength;
  }
  console.log(JSON.stringify({
    path: target.pathname, run, status: response.status,
    headersMs: Math.round(headersAt - start),
    firstChunkMs: firstChunkAt === null ? null : Math.round(firstChunkAt - start),
    completeMs: Math.round(performance.now() - start), bytes,
  }));
}
