/**
 * The day's earnings announcements, as Nasdaq's public calendar lists them.
 *
 * The dates a company has announced, and whether it reports before the open
 * or after the close — which nothing filed with the SEC says until the 8-K
 * arrives — with its market value, the fiscal quarter, last year's date and
 * reported earnings per share, and the analysts' consensus forecast for this
 * quarter with the number of analysts behind it. Once the day has passed,
 * Nasdaq adds the earnings per share reported and the surprise against the
 * consensus.
 *
 * The consensus is the one figure on this site that is not filed or computed
 * from filings, so it travels under its own names and the screens that show
 * it say whose it is.
 */

export type ReportTime = "before" | "after" | "unknown";

/**
 * The shape of a day's rows, carried in the address the screens ask for, so
 * an answer cached at the edge in an older shape is never handed to them.
 */
export const EARNINGS_DAY_SHAPE = "2";

export interface EarningsEvent {
  ticker: string;
  name: string;
  time: ReportTime;
  marketCap: number | null;
  /** "Sep/2026", as the company's fiscal quarter ends. */
  quarter: string | null;
  lastYearDate: string | null;
  lastYearEps: number | null;
  /** Analysts' consensus earnings per share for the quarter, and how many analysts. */
  consensusEps: number | null;
  analysts: number | null;
  /** After the report: earnings per share as reported, and the surprise against the consensus, in per cent. */
  reportedEps: number | null;
  surprise: number | null;
}

interface NasdaqRow {
  time?: string; symbol?: string; name?: string; marketCap?: string; fiscalQuarterEnding?: string;
  lastYearRptDt?: string; lastYearEPS?: string; epsForecast?: string; noOfEsts?: string; eps?: string; surprise?: string;
}

const money = (text: string | undefined) => {
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text.trim()) || text.includes("-");
  const value = Number(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) && text.replace(/[^0-9]/g, "") ? (negative ? -value : value) : null;
};

/** "10/14/2025" as an ISO date. */
const usDate = (text: string | undefined) => {
  const found = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text?.trim() ?? "");
  return found ? `${found[3]}-${found[1].padStart(2, "0")}-${found[2].padStart(2, "0")}` : null;
};

export function parseEarningsDay(payload: unknown): EarningsEvent[] {
  const rows = (payload as { data?: { rows?: NasdaqRow[] | null } | null })?.data?.rows ?? [];
  return rows.flatMap((row): EarningsEvent[] => {
    const ticker = row.symbol?.trim().toUpperCase().replace("/", ".");
    if (!ticker) return [];
    const time: ReportTime = row.time === "time-pre-market" ? "before" : row.time === "time-after-hours" ? "after" : "unknown";
    return [{
      ticker,
      name: row.name?.trim() ?? ticker,
      time,
      marketCap: money(row.marketCap),
      quarter: row.fiscalQuarterEnding?.trim() || null,
      lastYearDate: usDate(row.lastYearRptDt),
      lastYearEps: money(row.lastYearEPS),
      consensusEps: money(row.epsForecast),
      analysts: row.noOfEsts && /^\d+$/.test(row.noOfEsts.trim()) ? Number(row.noOfEsts) : null,
      reportedEps: money(row.eps),
      surprise: money(row.surprise),
    }];
  });
}

export async function fetchEarningsDay(date: string): Promise<EarningsEvent[]> {
  const response = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/",
    },
  });
  if (!response.ok) throw new Error(`Nasdaq returned ${response.status}.`);
  return parseEarningsDay(await response.json());
}

/** The weekdays from a date, as ISO dates; weekends hold no announcements worth a request. */
export function weekdaysFrom(start: string, count: number): string[] {
  const days: string[] = [];
  const at = new Date(`${start}T12:00:00Z`);
  while (days.length < count) {
    const weekday = at.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(at.toISOString().slice(0, 10));
    at.setUTCDate(at.getUTCDate() + 1);
  }
  return days;
}
