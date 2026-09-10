export class ReadBudgetExceeded extends Error {
  constructor(readonly subject: string, readonly maximumRows: number) {
    super(`READ_BUDGET_EXCEEDED:${subject}:${maximumRows}`);
  }
}

/** Never treats a capped response as complete. Callers must supply stable
 * ordering and a fixed information cutoff when rows can arrive concurrently. */
export async function readBoundedPages<T>(
  subject: string,
  read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maximumRows = 5_000,
  pageSize = 500,
): Promise<T[]> {
  if (!Number.isSafeInteger(maximumRows) || maximumRows < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new Error("INVALID_READ_BUDGET");
  }
  const rows: T[] = [];
  while (rows.length <= maximumRows) {
    const requested = Math.min(pageSize, maximumRows + 1 - rows.length);
    const { data, error } = await read(rows.length, rows.length + requested - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (rows.length > maximumRows) throw new ReadBudgetExceeded(subject, maximumRows);
    if (page.length < requested) return rows;
  }
  throw new ReadBudgetExceeded(subject, maximumRows);
}

export function chunks<T>(items: T[], size = 100): T[][] {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("INVALID_CHUNK_SIZE");
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}
