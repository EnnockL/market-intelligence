import type { DataMode } from "@/data/dashboard-data";

export function DataStatus({ mode, updatedAt, message, provider }: { mode: DataMode; updatedAt: string | null; message: string; provider?: string }) {
  const timestamp = updatedAt ? `Updated ${new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" }).format(new Date(updatedAt))}` : message;
  return <div className={`data-status data-status--${mode}`} title={message}><i /><strong>{mode.toUpperCase()}</strong><span>{provider ? `${provider} · ${timestamp}` : timestamp}</span></div>;
}
