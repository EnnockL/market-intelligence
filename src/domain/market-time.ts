export const MARKET_TIME_VERSION = "market-time-v1";
export type MarketSession = "ASIA" | "LONDON" | "NEW_YORK" | "PRE_MARKET" | "REGULAR" | "AFTER_HOURS" | "CLOSED";
export type SessionPhase = "OPENING" | "MIDDLE" | "CLOSING" | "CLOSED";

export interface SessionWindow { session: MarketSession; timeZone: string; openMinute: number; closeMinute: number; }
export interface MarketTimeContext {
  version: string; cutoffAt: string; weekday: string; utcTime: string; localExchangeTime: string;
  marketSession: MarketSession; sessionPhase: SessionPhase; minutesSinceOpen: number | null; minutesToClose: number | null;
  monthEnd: boolean; quarterEnd: boolean; optionsExpiry: boolean; earningsWindow: "UNKNOWN"; macroEventWindow: "UNKNOWN";
}

export const FX_SESSION_WINDOWS: SessionWindow[] = [
  { session: "ASIA", timeZone: "Asia/Tokyo", openMinute: 9 * 60, closeMinute: 17 * 60 },
  { session: "LONDON", timeZone: "Europe/London", openMinute: 8 * 60, closeMinute: 16 * 60 + 30 },
  { session: "NEW_YORK", timeZone: "America/New_York", openMinute: 8 * 60, closeMinute: 17 * 60 },
];

export function marketTimeContext(cutoffAt: string, exchangeTimeZone: string, windows: SessionWindow[] = FX_SESSION_WINDOWS): MarketTimeContext {
  const date = new Date(cutoffAt);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_MARKET_TIME");
  const local = parts(date, exchangeTimeZone);
  const active = windows.map(window => ({ window, local: parts(date, window.timeZone) })).filter(({ window, local }) => inside(local.minute, window.openMinute, window.closeMinute)).at(-1);
  const since = active ? elapsed(active.local.minute, active.window.openMinute) : null;
  const duration = active ? elapsed(active.window.closeMinute, active.window.openMinute) : null;
  return {
    version: MARKET_TIME_VERSION, cutoffAt: date.toISOString(), weekday: local.weekday, utcTime: date.toISOString().slice(11, 19),
    localExchangeTime: `${two(local.hour)}:${two(local.minuteOfHour)}:${two(local.second)}`, marketSession: active?.window.session ?? "CLOSED",
    sessionPhase: since === null || duration === null ? "CLOSED" : since < Math.min(90, duration / 3) ? "OPENING" : since >= duration - Math.min(60, duration / 4) ? "CLOSING" : "MIDDLE",
    minutesSinceOpen: since, minutesToClose: active && since !== null && duration !== null ? duration - since : null,
    monthEnd: isLastBusinessDay(date, exchangeTimeZone), quarterEnd: isLastBusinessDay(date, exchangeTimeZone) && [3, 6, 9, 12].includes(local.month),
    optionsExpiry: local.weekday === "Friday" && local.day >= 15 && local.day <= 21, earningsWindow: "UNKNOWN", macroEventWindow: "UNKNOWN",
  };
}

function inside(value: number, open: number, close: number) { return open <= close ? value >= open && value < close : value >= open || value < close; }
function elapsed(value: number, open: number) { return value >= open ? value - open : 1440 - open + value; }
function parts(date: Date, timeZone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(item => [item.type, item.value]));
  const hour = Number(values.hour), minuteOfHour = Number(values.minute);
  return { weekday: values.weekday, year: Number(values.year), month: Number(values.month), day: Number(values.day), hour, minuteOfHour, second: Number(values.second), minute: hour * 60 + minuteOfHour };
}
function isLastBusinessDay(date: Date, timeZone: string) { const current = parts(date, timeZone); for (let add = 1; add <= 3; add++) { const next = parts(new Date(date.getTime() + add * 86_400_000), timeZone); if (next.month !== current.month) return true; if (next.weekday !== "Saturday" && next.weekday !== "Sunday") return false; } return false; }
function two(value: number) { return String(value).padStart(2, "0"); }
