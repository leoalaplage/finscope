import { cachedJson } from "./market-cache";
import { runtimeSecret } from "./runtime-env";

/**
 * ECO: the US economy as markets trade it — what is released when (CPI,
 * payrolls, PPI, retail sales, GDP, PCE, the Fed…), what each print was
 * against the economists' consensus and the one before, and how the S&P 500
 * futures and the 10-year yield took it.
 *
 * The calendar, the prints and the consensus are Nasdaq's public economic
 * calendar, each labelled as such; the times are New York's. Nasdaq files an
 * event under the following day, so its days are realigned on the Bureau of
 * Labor Statistics' own release calendar (bls.ics), the authority for when CPI
 * and the jobs report come out. The official series behind the headline
 * figures — CPI, core CPI, PPI, payrolls, unemployment, earnings — come from
 * the BLS's public API, for the charts.
 */

export type Importance = "high" | "medium" | "low";

export interface EconEvent {
  /** The day in New York, YYYY-MM-DD, and the time there, HH:MM (null for an all-day event). */
  date: string;
  time: string | null;
  name: string;
  actual: string | null;
  consensus: string | null;
  previous: string | null;
  importance: Importance;
  /** Above or below the consensus, where both are numbers in the same unit. */
  surprise: "above" | "below" | "inline" | null;
  description: string | null;
}

/** The releases markets move on. */
const HIGH = /^(?:CPI|Core CPI|PPI|Core PPI|Nonfarm Payrolls|Unemployment Rate|Average Hourly Earnings|GDP|GDP Price Index|PCE Price Index|Core PCE Price Index|Retail Sales|Core Retail Sales|Initial Jobless Claims|Fed Interest Rate Decision|FOMC|ISM Manufacturing PMI|ISM Non-Manufacturing PMI|ISM Services PMI|JOLTS Job Openings|CB Consumer Confidence|Michigan Consumer Sentiment|Michigan 1-Year Inflation Expectations|ADP Nonfarm Employment Change)\b/i;
const MEDIUM = /Fed|FOMC|Powell|Payrolls|Jobless|Housing Starts|Building Permits|New Home Sales|Existing Home Sales|Durable Goods|Industrial Production|Trade Balance|Import Price|Export Price|Philadelphia Fed|Empire State|Chicago PMI|S&P Global|Factory Orders|Personal Income|Personal Spending|Crude Oil Inventories|Treasury|Beige Book|Productivity|Labor Costs|Employment Cost/i;
/** Index levels and the like, printed beside the headline figure, add nothing a reader acts on. */
const NOISE = /Index, n\.s\.a|Index, s\.a|CPI Index|n\.s\.a\b|Redbook|IMF|OPEC|Atlanta Fed GDPNow \(Q\d\)$/i;

export const importanceOf = (name: string): Importance => (HIGH.test(name) ? "high" : MEDIUM.test(name) ? "medium" : "low");

const clean = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/&nbsp;/g, " ").replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").trim();
  return text ? text : null;
};

/** "3.7%", "-17.0K", "1,701K", "3.99M", "4.085%": a number and its unit, or null. */
export function parseFigure(text: string | null): { value: number; unit: string } | null {
  if (!text) return null;
  const match = /^([+-]?[\d,]*\.?\d+)\s*(%|K|M|B|T)?$/i.exec(text.replace(/\s+/g, ""));
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? { value, unit: (match[2] ?? "").toUpperCase() } : null;
}

export function surpriseOf(actual: string | null, consensus: string | null): EconEvent["surprise"] {
  const a = parseFigure(actual), c = parseFigure(consensus);
  if (!a || !c || a.unit !== c.unit) return null;
  if (a.value === c.value) return "inline";
  return a.value > c.value ? "above" : "below";
}

interface NasdaqRow { gmt?: string; country?: string; eventName?: string; actual?: string; consensus?: string; previous?: string; description?: string }

/**
 * Nasdaq prints a monthly and a yearly change under one name ("CPI" twice at
 * 08:30). Of such a pair of rates, the yearly one is the larger — it holds
 * twelve months of the monthly one — so the pair is named so.
 */
export function namePairs(events: EconEvent[]): EconEvent[] {
  const groups = new Map<string, EconEvent[]>();
  for (const event of events) groups.set(`${event.time}|${event.name}`, [...(groups.get(`${event.time}|${event.name}`) ?? []), event]);
  for (const group of groups.values()) {
    if (group.length !== 2) continue;
    const size = (event: EconEvent) => {
      const figure = parseFigure(event.consensus) ?? parseFigure(event.previous) ?? parseFigure(event.actual);
      return figure?.unit === "%" ? Math.abs(figure.value) : null;
    };
    const [first, second] = group, a = size(first), b = size(second);
    if (a == null || b == null || a === b) continue;
    const [yearly, monthly] = a > b ? [first, second] : [second, first];
    yearly.name = `${yearly.name}, y/y`;
    monthly.name = `${monthly.name}, m/m`;
  }
  return events;
}

/** Pure: Nasdaq's rows for one of its days, as the US events of `date`. */
export function eventsFrom(rows: NasdaqRow[], date: string): EconEvent[] {
  return namePairs(rows.flatMap((row): EconEvent[] => {
    const name = clean(row.eventName);
    if (row.country !== "United States" || !name || NOISE.test(name)) return [];
    const time = /^\d{2}:\d{2}$/.test(row.gmt ?? "") ? row.gmt! : null;
    const actual = clean(row.actual), consensus = clean(row.consensus), previous = clean(row.previous);
    return [{
      date, time: time === "00:00" ? null : time, name, actual, consensus, previous,
      importance: importanceOf(name), surprise: surpriseOf(actual, consensus),
      description: clean(row.description)?.replace(/&lt;br\/?&gt;/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400) ?? null,
    }];
  }));
}

const NASDAQ_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

async function nasdaqDay(key: string): Promise<NasdaqRow[]> {
  const response = await fetch(`https://api.nasdaq.com/api/calendar/economicevents?date=${key}`, { headers: NASDAQ_HEADERS });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Nasdaq answered ${response.status}.`); }
  const body = await response.json() as { data?: { rows?: NasdaqRow[] } };
  return body.data?.rows ?? [];
}

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Today in New York. */
export function newYorkDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The epoch of a New York wall-clock time. */
export function newYorkEpoch(date: string, time: string): number {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
  const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  return guess + (guess - shown);
}

/* --- The BLS's own calendar, to realign Nasdaq's days ----------------------- */

export interface BlsRelease { date: string; time: string; name: string }

export function blsCalendar(ics: string): BlsRelease[] {
  return [...ics.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].flatMap((match) => {
    const start = /DTSTART[^:]*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(match[1]);
    const name = /SUMMARY:(.*)/.exec(match[1])?.[1]?.trim();
    return start && name ? [{ date: `${start[1]}-${start[2]}-${start[3]}`, time: `${start[4]}:${start[5]}`, name }] : [];
  });
}

const BLS_AGENT = () => process.env.SEC_USER_AGENT || "Tenqay research application contact@example.com";

export async function fetchBlsCalendar(): Promise<BlsRelease[]> {
  const { body } = await cachedJson("bls-calendar:v1", 86_400, async () => {
    const response = await fetch("https://www.bls.gov/schedule/news_release/bls.ics", { headers: { "User-Agent": BLS_AGENT() } });
    if (!response.ok) { await response.body?.cancel(); return [] as BlsRelease[]; }
    return blsCalendar(await response.text());
  }, (value) => (value.length ? "full" : "empty"));
  return JSON.parse(body) as BlsRelease[];
}

/**
 * How many days Nasdaq files an event after it happens: the last CPI or jobs
 * report the BLS lists, looked for on its day and the day after. One unless
 * shown otherwise.
 */
export function nasdaqOffset(found: { sameDay: boolean; nextDay: boolean }): number {
  if (found.sameDay && !found.nextDay) return 0;
  return 1;
}

async function detectOffset(today: string): Promise<number> {
  const { body } = await cachedJson("econ-offset:v1", 86_400, async () => {
    const releases = await fetchBlsCalendar().catch(() => [] as BlsRelease[]);
    const anchor = releases.filter((release) => /^(Consumer Price Index|Employment Situation)$/.test(release.name) && release.date < today).at(-1);
    if (!anchor) return { offset: 1 };
    const look = async (key: string) => (await nasdaqDay(key).catch(() => [])).some((row) => row.country === "United States" && /^(CPI|Nonfarm Payrolls)$/.test(clean(row.eventName) ?? ""));
    const [sameDay, nextDay] = await Promise.all([look(anchor.date), look(shift(anchor.date, 1))]);
    return { offset: nasdaqOffset({ sameDay, nextDay }) };
  });
  return (JSON.parse(body) as { offset: number }).offset;
}

/** One New York day's events: kept six hours once past, a minute on the day itself, an hour ahead. */
async function eventsOn(date: string, today: string, offset: number): Promise<EconEvent[]> {
  const ttl = date < today ? 6 * 3600 : date === today ? 60 : 3600;
  const { body } = await cachedJson(`econ-day:v2:${date}`, ttl, async () => eventsFrom(await nasdaqDay(shift(date, offset)), date),
    (value) => (date === today ? "brief" : value.length ? "full" : "partial"));
  return JSON.parse(body) as EconEvent[];
}

/** Every US event from `back` days ago to `ahead` days on, oldest first. */
export async function econCalendar(back = 7, ahead = 14, now = new Date()): Promise<{ today: string; events: EconEvent[] }> {
  const today = newYorkDate(now);
  const offset = await detectOffset(today);
  const dates = Array.from({ length: back + ahead + 1 }, (_, index) => shift(today, index - back))
    .filter((date) => { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return day !== 0 && day !== 6; });
  const days = await Promise.all(dates.map((date) => eventsOn(date, today, offset).catch(() => [] as EconEvent[])));
  return { today, events: days.flat().sort((left, right) => `${left.date} ${left.time ?? "00:00"}`.localeCompare(`${right.date} ${right.time ?? "00:00"}`)) };
}

/* --- How the market took it ------------------------------------------------- */

export interface Reaction { equity: number | null; yield10: number | null; minutes: number }

interface Bars { t: number[]; c: Array<number | null> }

async function fiveMinute(symbol: string): Promise<Bars | null> {
  for (const base of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    const response = await fetch(`${base}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=5m&includePrePost=true`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 Tenqay/1.0" } });
    if (!response.ok) { await response.body?.cancel(); continue; }
    const result = (await response.json() as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } }).chart?.result?.[0];
    if (result?.timestamp?.length) return { t: result.timestamp, c: result.indicators?.quote?.[0]?.close ?? [] };
  }
  return null;
}

/** Pure: the last close at or before `at`, and the move to the last close within `minutes` after it. */
export function moveAround(bars: Bars, at: number, minutes: number): { before: number; after: number } | null {
  let before: number | null = null, after: number | null = null;
  for (let index = 0; index < bars.t.length; index++) {
    const time = bars.t[index] * 1000, close = bars.c[index];
    if (close == null) continue;
    if (time < at) before = close;
    else if (time <= at + minutes * 60_000) after = close;
  }
  return before != null && after != null ? { before, after } : null;
}

/**
 * The S&P 500 futures (ES=F) and the 10-year yield (^TNX) half an hour after
 * each high-importance release of the last five sessions, kept ten minutes.
 */
export async function reactions(events: EconEvent[], now = Date.now()): Promise<Record<string, Reaction>> {
  const recent = events.filter((event) => event.importance === "high" && event.time && event.actual && now - newYorkEpoch(event.date, event.time) < 5 * 86_400_000 && newYorkEpoch(event.date, event.time) < now);
  if (!recent.length) return {};
  const { body } = await cachedJson("econ-bars:v1", 600, async () => ({ es: await fiveMinute("ES=F"), tnx: await fiveMinute("^TNX") }));
  const { es, tnx } = JSON.parse(body) as { es: Bars | null; tnx: Bars | null };
  const out: Record<string, Reaction> = {};
  for (const event of recent) {
    const at = newYorkEpoch(event.date, event.time!);
    const equity = es ? moveAround(es, at, 30) : null;
    const rates = tnx ? moveAround(tnx, at, 30) : null;
    out[`${event.date} ${event.time}`] = {
      equity: equity ? equity.after / equity.before - 1 : null,
      // ^TNX is the yield in per cent: the change in basis points.
      yield10: rates ? Math.round((rates.after - rates.before) * 100) : null,
      minutes: 30,
    };
  }
  return out;
}

/* --- The official series, for the charts ------------------------------------ */

export const BLS_SERIES = [
  { id: "CUUR0000SA0", label: "CPI", transform: "yoy" },
  { id: "CUUR0000SA0L1E", label: "Core CPI", transform: "yoy" },
  { id: "CUSR0000SA0", label: "CPI, month on month", transform: "mom" },
  { id: "CUSR0000SA0L1E", label: "Core CPI, month on month", transform: "mom" },
  { id: "WPUFD4", label: "PPI final demand", transform: "yoy" },
  { id: "LNS14000000", label: "Unemployment rate", transform: "level" },
  { id: "CES0000000001", label: "Nonfarm payrolls, change", transform: "diff" },
  { id: "CES0500000003", label: "Average hourly earnings", transform: "yoy" },
] as const;

export interface EconSeries { id: string; label: string; unit: "percent" | "thousands"; points: Array<{ period: string; value: number }>; latest: string | null }

interface BlsObservation { year: string; period: string; value: string }

/** Pure: a BLS series' monthly observations, transformed — year on year, month on month, the monthly change, or as printed. */
export function transformSeries(observations: BlsObservation[], transform: "yoy" | "mom" | "level" | "diff"): Array<{ period: string; value: number }> {
  const monthly = observations.filter((row) => /^M(0[1-9]|1[0-2])$/.test(row.period) && Number.isFinite(Number(row.value)))
    .map((row) => ({ period: `${row.year}-${row.period.slice(1)}`, value: Number(row.value) }))
    .sort((left, right) => left.period.localeCompare(right.period));
  const byPeriod = new Map(monthly.map((row) => [row.period, row.value]));
  const back = (period: string, months: number) => {
    const [year, month] = period.split("-").map(Number);
    const total = year * 12 + (month - 1) - months;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
  };
  return monthly.flatMap((row) => {
    if (transform === "level") return [{ period: row.period, value: row.value }];
    const earlier = byPeriod.get(back(row.period, transform === "yoy" ? 12 : 1));
    if (earlier == null || earlier === 0) return [];
    const value = transform === "diff" ? row.value - earlier : (row.value / earlier - 1) * 100;
    return [{ period: row.period, value: Math.round(value * (transform === "diff" ? 1 : 100)) / (transform === "diff" ? 1 : 100) }];
  });
}

/** The series, read in one request to the BLS, kept six hours. */
export async function blsSeries(now = new Date()): Promise<EconSeries[]> {
  const { body } = await cachedJson("bls-series:v1", 6 * 3600, async () => {
    const year = now.getUTCFullYear();
    const response = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": BLS_AGENT() },
      // A free registration key (BLS_API_KEY) lifts the daily allowance, which unregistered is shared by every
      // site on the same Cloudflare address and spent early in the day.
      body: JSON.stringify({ seriesid: BLS_SERIES.map((series) => series.id), startyear: String(year - 6), endyear: String(year), ...(runtimeSecret("BLS_API_KEY") ? { registrationkey: runtimeSecret("BLS_API_KEY") } : {}) }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`The BLS answered ${response.status}.`); }
    const data = await response.json() as { status?: string; message?: string[]; Results?: { series?: Array<{ seriesID: string; data: BlsObservation[] }> } };
    if (data.status !== "REQUEST_SUCCEEDED") throw new Error(`The BLS refused: ${(data.message ?? []).join(" ") || data.status}`);
    return BLS_SERIES.flatMap((spec): EconSeries[] => {
      const found = data.Results?.series?.find((series) => series.seriesID === spec.id);
      if (!found) return [];
      const points = transformSeries(found.data, spec.transform).slice(-60);
      return [{ id: spec.id, label: spec.label, unit: spec.transform === "diff" ? "thousands" : "percent", points, latest: points.at(-1)?.period ?? null }];
    });
  }, (value) => (value.length ? "full" : "empty"));
  return JSON.parse(body) as EconSeries[];
}
