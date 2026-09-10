/** Provider payloads use lower case; older persisted fixtures may use upper
 * case. Unknown or unrecognised statuses never become evidence of coverage. */
export function riskCoveragePercent(value: unknown): number | null {
  const components = (value as { components?: unknown } | null)?.components;
  if (!Array.isArray(components) || !components.length) return null;
  const known = components.filter((component) => {
    const status = typeof component?.status === "string" ? component.status.toLowerCase() : "unknown";
    return ["safe", "warning", "critical"].includes(status);
  });
  return Math.round(known.length / components.length * 100);
}
