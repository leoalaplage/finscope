import { cachedJson } from "./market-cache";

/**
 * FED: what the futures market prices for each coming FOMC meeting, the way
 * CME's FedWatch reads it. A 30-day fed funds future settles on the month's
 * average effective rate, so its price says what the rate is expected to
 * average; a meeting partway through a month splits that average into the
 * rate before it and the rate after it. Chained meeting by meeting from
 * today's effective rate (the New York Fed's), each expected change becomes
 * the odds of a quarter-point move.
 *
 * Sources: the New York Fed (effective rate, target range), the Federal
 * Reserve's own meeting calendar, and the CBOT futures as Yahoo quotes them.
 */

export interface Meeting { date: string }

export interface FedRow {
  /** The decision day. */
  date: string;
  /** The effective rate expected once it is decided, in per cent. */
  implied: number;
  /** Against today's effective rate, in basis points. */
  fromToday: number;
  /** This meeting's own expected move, in basis points. */
  move: number;
  /** The odds of this meeting's outcomes, in quarter-point steps: { -25: 0.7, 0: 0.3 }. */
  odds: Record<string, number>;
  /** The odds of each target range once it is decided, counted from today's: what CME's table shows. */
  ranges: Array<{ lower: number; upper: number; p: number }>;
}

export interface FedWatch { effr: number; lower: number; upper: number; asOf: string; rows: FedRow[]; source: string }

const MONTH_CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];
/** The CBOT symbol of a month's contract: ZQX26.CBT for November 2026. */
export const zqSymbol = (year: number, month: number) => `ZQ${MONTH_CODES[month - 1]}${String(year).slice(2)}.CBT`;
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthKey = (date: string) => date.slice(0, 7);
const nextMonth = (key: string) => { const [y, m] = key.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };

/** Pure: the Federal Reserve's calendar page, as the decision days (each meeting's last day). */
export function parseFomc(html: string): Meeting[] {
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const heads = [...html.matchAll(/(\d{4}) FOMC Meetings/g)].map((match) => ({ at: match.index ?? 0, year: Number(match[1]) })).sort((a, b) => a.at - b.at);
  const meetings: Meeting[] = [];
  heads.forEach((head, index) => {
    const part = html.slice(head.at, heads[index + 1]?.at ?? html.length);
    for (const match of part.matchAll(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g)) {
      const months = match[1].toLowerCase().split("/").map((name) => MONTHS.findIndex((month) => month.startsWith(name.trim().slice(0, 3))));
      const days = match[2].replace(/\*|\(.*?\)/g, "").trim().split("-").map((day) => Number(day.trim()));
      if (/notation|unscheduled/i.test(match[2]) || !days.every(Number.isFinite) || months[0] < 0) continue;
      const lastMonth = months.at(-1)! >= 0 ? months.at(-1)! : months[0];
      meetings.push({ date: `${head.year}-${String(lastMonth + 1).padStart(2, "0")}-${String(days.at(-1)).padStart(2, "0")}` });
    }
  });
  return [...new Map(meetings.map((meeting) => [meeting.date, meeting])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Pure: the odds of each coming meeting. For a meeting on day d of a month of
 * N days, the month's contract averages the old rate for d days and the new
 * one for the rest: new = (average − old·d/N) / (1 − d/N). Where the next
 * month has no meeting its contract gives the new rate whole, which is the
 * better reading, as CME takes it.
 */
export function fedOdds(input: { effr: number; lower?: number; meetings: Meeting[]; prices: Record<string, number>; today: string; limit?: number }): FedRow[] {
  const coming = input.meetings.filter((meeting) => meeting.date >= input.today).slice(0, input.limit ?? 8);
  const meetingMonths = new Set(coming.map((meeting) => monthKey(meeting.date)));
  const rows: FedRow[] = [];
  let before = input.effr;
  for (const meeting of coming) {
    const key = monthKey(meeting.date);
    const [year, month] = key.split("-").map(Number);
    const after = nextMonth(key);
    let implied: number | null = null;
    if (!meetingMonths.has(after) && input.prices[after] != null) implied = 100 - input.prices[after];
    else if (input.prices[key] != null) {
      const share = Number(meeting.date.slice(8)) / daysIn(year, month);
      implied = share < 1 ? (100 - input.prices[key] - before * share) / (1 - share) : before;
    }
    if (implied == null || !Number.isFinite(implied)) break;
    const move = (implied - before) * 100;
    // An expected change in quarter points, split between the two steps either side of it.
    const split = (basisPoints: number) => {
      const steps = basisPoints / 25;
      const low = Math.floor(steps), weight = steps - low;
      return [[low + 1, weight], [low, 1 - weight]].filter(([, p]) => p > 0.005).map(([step, p]) => ({ step, p: Math.round(p * 1000) / 1000 }));
    };
    const odds = Object.fromEntries(split(move).map(({ step, p }) => [String(step * 25), p]));
    const fromToday = (implied - input.effr) * 100;
    const ranges = input.lower == null ? [] : split(fromToday).map(({ step, p }) => ({ lower: Math.round((input.lower! + step * 0.25) * 100) / 100, upper: Math.round((input.lower! + (step + 1) * 0.25) * 100) / 100, p })).sort((a, b) => a.lower - b.lower);
    rows.push({ date: meeting.date, implied: Math.round(implied * 1000) / 1000, fromToday: Math.round(fromToday * 10) / 10, move: Math.round(move * 10) / 10, odds, ranges });
    before = implied;
  }
  return rows;
}

const AGENT = "Mozilla/5.0 Tenqay/1.0";

async function fomcMeetings(): Promise<Meeting[]> {
  const { body } = await cachedJson("fomc-calendar:v1", 86_400, async () => {
    const response = await fetch("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", { headers: { "User-Agent": AGENT } });
    if (!response.ok) { await response.body?.cancel(); return [] as Meeting[]; }
    return parseFomc(await response.text());
  }, (value) => (value.length ? "full" : "empty"));
  return JSON.parse(body) as Meeting[];
}

async function effective(): Promise<{ effr: number; lower: number; upper: number; asOf: string } | null> {
  const response = await fetch("https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json", { headers: { Accept: "application/json" } });
  if (!response.ok) { await response.body?.cancel(); return null; }
  const rate = (await response.json() as { refRates?: Array<{ effectiveDate: string; percentRate: number; targetRateFrom: number; targetRateTo: number }> }).refRates?.[0];
  return rate ? { effr: rate.percentRate, lower: rate.targetRateFrom, upper: rate.targetRateTo, asOf: rate.effectiveDate } : null;
}

async function futures(months: string[]): Promise<Record<string, number>> {
  const symbols = months.map((key) => zqSymbol(Number(key.slice(0, 4)), Number(key.slice(5, 7))));
  for (const base of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    const response = await fetch(`${base}/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(","))}&range=1d&interval=1d`, { headers: { Accept: "application/json", "User-Agent": AGENT } });
    if (!response.ok) { await response.body?.cancel(); continue; }
    const results = (await response.json() as { spark?: { result?: Array<{ symbol: string; response?: Array<{ meta?: { regularMarketPrice?: number } }> }> } }).spark?.result ?? [];
    const out: Record<string, number> = {};
    for (const result of results) {
      const at = symbols.indexOf(result.symbol);
      const price = result.response?.[0]?.meta?.regularMarketPrice;
      if (at >= 0 && typeof price === "number" && price > 50) out[months[at]] = price;
    }
    return out;
  }
  return {};
}

/** The odds for the coming meetings, kept fifteen minutes. */
export async function fedWatch(now = new Date()): Promise<FedWatch | null> {
  const { body } = await cachedJson("fedwatch:v1", 900, async () => {
    const [meetings, rate] = await Promise.all([fomcMeetings(), effective()]);
    if (!rate || !meetings.length) return null;
    const today = now.toISOString().slice(0, 10);
    const coming = meetings.filter((meeting) => meeting.date >= today).slice(0, 8);
    const months = [...new Set(coming.flatMap((meeting) => [monthKey(meeting.date), nextMonth(monthKey(meeting.date))]))];
    const prices = await futures(months);
    const rows = fedOdds({ effr: rate.effr, lower: rate.lower, meetings, prices, today });
    return rows.length ? { ...rate, rows, source: "Implied by CBOT 30-day fed funds futures; effective rate from the New York Fed; meetings from the Federal Reserve" } : null;
  }, (value) => (value ? "full" : "empty"));
  return JSON.parse(body) as FedWatch | null;
}
