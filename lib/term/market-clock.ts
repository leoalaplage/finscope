/**
 * Whether New York is trading, from the reader's clock alone.
 *
 * The status bar says it on every screen, and asking an API for it would make
 * the one line that is always visible the one that waits. The schedule is the
 * NYSE's published one: the regular session, the extended hours either side of
 * it, and the days it does not open. A year missing from the table is read as
 * having no holidays, which is wrong on about ten days and wrong in the safe
 * direction — it says OPEN on a day nothing trades, never CLOSED on one that does.
 */

export type MarketState = "PRE" | "OPEN" | "POST" | "CLOSED";

/** Full closures, as New York dates. */
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** Days the regular session ends at one o'clock. */
const EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

export interface NewYorkTime { date: string; weekday: number; minutes: number; clock: string }

const FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  weekday: "short", hourCycle: "h23",
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function newYorkTime(at: Date): NewYorkTime {
  const parts = Object.fromEntries(FORMAT.formatToParts(at).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday] ?? 0,
    minutes: hour * 60 + minute,
    clock: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

export function marketState(at: Date): MarketState {
  const ny = newYorkTime(at);
  if (ny.weekday === 0 || ny.weekday === 6 || HOLIDAYS.has(ny.date)) return "CLOSED";
  const close = EARLY_CLOSE.has(ny.date) ? 13 * 60 : 16 * 60;
  if (ny.minutes >= 4 * 60 && ny.minutes < 9 * 60 + 30) return "PRE";
  if (ny.minutes >= 9 * 60 + 30 && ny.minutes < close) return "OPEN";
  if (ny.minutes >= close && ny.minutes < 20 * 60) return "POST";
  return "CLOSED";
}
