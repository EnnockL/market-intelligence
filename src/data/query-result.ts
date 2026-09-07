/** Public read results never turn a failed request into a successful zero. */
export type ReadStatus = "ready" | "empty" | "error";
export interface ReadResult<T> { status: ReadStatus; data: T | null; errorCode: string | null }
type DatabaseResponse<T> = { data: T | null; error?: unknown };

export async function readQuery<T>(request: PromiseLike<DatabaseResponse<T>>): Promise<ReadResult<T>> {
  try {
    const result = await request;
    if (result.error) return failedRead(result.error);
    const empty = result.data === null || (Array.isArray(result.data) && result.data.length === 0);
    return { status: empty ? "empty" : "ready", data: result.data, errorCode: null };
  } catch (error) { return failedRead(error); }
}

export function failedRead<T>(error?: unknown): ReadResult<T> {
  // Messages may contain URLs, credentials or private payloads. Do not expose them.
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return { status: "error", data: null, errorCode: /^[A-Z0-9_]{1,32}$/.test(code) ? code : "READ_FAILED" };
}

export async function readCount(request: PromiseLike<{ count: number | null; error?: unknown }>): Promise<ReadResult<number>> {
  try {
    const result = await request;
    if (result.error || result.count === null || !Number.isFinite(result.count) || result.count < 0) return failedRead(result.error);
    return { status: result.count === 0 ? "empty" : "ready", data: result.count, errorCode: null };
  } catch (error) { return failedRead(error); }
}
