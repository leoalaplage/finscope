import type { Alert } from "./alerts";
import type { EconEvent } from "./econ";

/**
 * The reader's alerts, as rules they make, change, pause and delete: a price
 * crossing a level, a day's move past a size, the filings and the insider
 * purchases of a company or of everything they follow, and the US economic
 * releases. Kept in the browser (and the account, lib/account-sync.ts), read
 * by the ALRT screen and by the daily email (lib/email-alerts.ts).
 *
 * Pure: what fires is decided here from what the caller has read.
 */

export type RuleType = "price" | "move" | "filings" | "insider" | "econ" | "line";

/**
 * A line drawn on a chart, as an alert keeps it: its two points (a time in
 * seconds and a price), how far it runs, and whether the chart was
 * logarithmic, where a straight line is straight in the logarithm of price.
 */
export type LineReach = "level" | "hray" | "segment" | "ray" | "extended";
export interface AlertLine { reach: LineReach; a: { t: number; p: number }; b: { t: number; p: number }; log: boolean }
export type FilingKind = "results" | "report" | "leadership" | "deal" | "flag";

export const FILING_KINDS: Array<{ id: FilingKind; label: string }> = [
  { id: "results", label: "Results" },
  { id: "report", label: "10-K and 10-Q" },
  { id: "leadership", label: "Director or officer changes" },
  { id: "deal", label: "Deals and stakes" },
  { id: "flag", label: "Red flags" },
];

export const ECON_TOPICS: Array<{ id: string; label: string; match: RegExp }> = [
  { id: "cpi", label: "Inflation (CPI)", match: /^(?:Core )?CPI\b/i },
  { id: "ppi", label: "Producer prices (PPI)", match: /^(?:Core )?PPI\b/i },
  { id: "pce", label: "PCE prices", match: /PCE Price/i },
  { id: "jobs", label: "Jobs report", match: /^(?:Nonfarm Payrolls|Unemployment Rate|Average Hourly Earnings)/i },
  { id: "claims", label: "Jobless claims", match: /^Initial Jobless Claims/i },
  { id: "retail", label: "Retail sales", match: /^(?:Core )?Retail Sales/i },
  { id: "gdp", label: "GDP", match: /^GDP\b/i },
  { id: "fed", label: "Fed rate decision", match: /Fed Interest Rate Decision|FOMC Statement|FOMC Economic Projections/i },
  { id: "ism", label: "ISM surveys", match: /^ISM /i },
  { id: "sentiment", label: "Consumer sentiment", match: /Michigan|Consumer Confidence/i },
];

export interface AlertRule {
  id: string;
  type: RuleType;
  enabled: boolean;
  created: string;
  /** The company; null for every company the reader follows (watchlists, portfolio, notes). */
  ticker: string | null;
  direction?: "above" | "below";
  level?: number;
  /** A day's move, in per cent, either way. */
  movePct?: number;
  kinds?: FilingKind[];
  /** Insider purchases from this size, in dollars. */
  minValue?: number;
  topics?: string[];
  /** Economic releases: only when the print misses the consensus. */
  onlySurprise?: boolean;
  channels: { browser: boolean; email: boolean };
  /** A price alert fires once: when, and when the reader set it again. */
  firedAt?: string | null;
  armedAt?: string | null;
  label?: string;
  /** A chart line's alert: the line, and the drawing it was set on. */
  line?: AlertLine;
  drawingId?: string;
}

/**
 * Pure: time counted in trading days — weekdays only — so a line drawn across
 * daily candles, which skip weekends, runs on to the same slope it shows.
 */
export function tradingDays(seconds: number): number {
  const days = seconds / 86_400;
  const whole = Math.floor(days);
  const monday = whole + 3; // 1 January 1970 was a Thursday.
  const weeks = Math.floor(monday / 7);
  const weekday = ((monday % 7) + 7) % 7;
  return weeks * 5 + Math.min(weekday, 5) + (weekday < 5 ? days - whole : 0);
}

/** Pure: where a chart line stands at a moment, or null when it does not reach that moment. */
export function lineLevel(line: AlertLine, at: Date): number | null {
  if (line.reach === "level") return line.a.p;
  const now = at.getTime() / 1000;
  if (line.reach === "hray") return now >= line.a.t ? line.a.p : null;
  const x0 = tradingDays(line.a.t);
  const x1 = tradingDays(line.b.t);
  const x = tradingDays(now);
  if (Math.abs(x1 - x0) < 1e-9) return null;
  const along = (x - x0) / (x1 - x0);
  if (line.reach === "segment" && (along < 0 || along > 1)) return null;
  if (line.reach === "ray" && along < 0) return null;
  if (line.log && line.a.p > 0 && line.b.p > 0) return Math.exp(Math.log(line.a.p) + (Math.log(line.b.p) - Math.log(line.a.p)) * along);
  return line.a.p + (line.b.p - line.a.p) * along;
}

const LINE_NAMES: Record<LineReach, string> = { level: "horizontal line", hray: "horizontal ray", segment: "trend line", ray: "ray", extended: "extended line" };

function cleanLine(value: unknown): AlertLine | undefined {
  const line = value as Partial<AlertLine> | null;
  const point = (p: unknown) => {
    const q = p as { t?: unknown; p?: unknown } | null;
    return q && typeof q.t === "number" && Number.isFinite(q.t) && typeof q.p === "number" && Number.isFinite(q.p) ? { t: q.t, p: q.p } : null;
  };
  if (!line || !["level", "hray", "segment", "ray", "extended"].includes(line.reach as string)) return undefined;
  const a = point(line.a);
  const b = point(line.b);
  return a && b ? { reach: line.reach as LineReach, a, b, log: line.log === true } : undefined;
}

export const RULES_KEY = "finscope.io.alert-rules.v1";
export const RULE_LIMIT = 200;

const id = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** What everyone has before making their own: what the ALRT screen did until now, as three rules to change. */
export function defaultRules(now = new Date().toISOString()): AlertRule[] {
  return [
    { id: "default-filings", type: "filings", enabled: true, created: now, ticker: null, kinds: FILING_KINDS.map((kind) => kind.id), channels: { browser: true, email: true } },
    { id: "default-insider", type: "insider", enabled: true, created: now, ticker: null, minValue: 0, channels: { browser: true, email: true } },
    { id: "default-econ", type: "econ", enabled: true, created: now, ticker: null, topics: ["cpi", "jobs", "fed"], onlySurprise: false, channels: { browser: true, email: false } },
  ];
}

export const newRule = (type: RuleType, ticker: string | null): AlertRule => ({
  id: id(), type, enabled: true, created: new Date().toISOString(), ticker,
  ...(type === "price" ? { direction: "above" as const, level: undefined } : {}),
  ...(type === "move" ? { movePct: 5 } : {}),
  ...(type === "filings" ? { kinds: FILING_KINDS.map((kind) => kind.id) } : {}),
  ...(type === "insider" ? { minValue: 100_000 } : {}),
  ...(type === "econ" ? { topics: ["cpi"], onlySurprise: false } : {}),
  channels: { browser: true, email: true },
});

const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

/** The stored rules, each checked; none stored yet is the defaults. */
export function parseRules(raw: string | null): AlertRule[] {
  if (raw == null) return defaultRules();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return defaultRules(); }
  if (!Array.isArray(value)) return defaultRules();
  return value.slice(0, RULE_LIMIT).flatMap((entry): AlertRule[] => {
    if (!entry || typeof entry !== "object") return [];
    const rule = entry as Partial<AlertRule>;
    if (typeof rule.id !== "string" || !["price", "move", "filings", "insider", "econ", "line"].includes(rule.type as string)) return [];
    const ticker = typeof rule.ticker === "string" && TICKER.test(rule.ticker.toUpperCase()) ? rule.ticker.toUpperCase() : null;
    if ((rule.type === "price" || rule.type === "move" || rule.type === "line") && !ticker) return [];
    const line = rule.type === "line" ? cleanLine(rule.line) : undefined;
    if (rule.type === "line" && !line) return [];
    return [{
      id: rule.id, type: rule.type!, enabled: rule.enabled !== false, created: typeof rule.created === "string" ? rule.created : new Date(0).toISOString(), ticker,
      ...(rule.type === "price" ? { direction: rule.direction === "below" ? "below" as const : "above" as const, level: typeof rule.level === "number" && rule.level > 0 ? rule.level : undefined } : {}),
      ...(rule.type === "move" ? { movePct: typeof rule.movePct === "number" && rule.movePct > 0 ? rule.movePct : 5 } : {}),
      ...(rule.type === "filings" ? { kinds: (rule.kinds ?? []).filter((kind) => FILING_KINDS.some((entry) => entry.id === kind)) } : {}),
      ...(rule.type === "insider" ? { minValue: typeof rule.minValue === "number" && rule.minValue >= 0 ? rule.minValue : 0 } : {}),
      ...(rule.type === "econ" ? { topics: (rule.topics ?? []).filter((topic) => ECON_TOPICS.some((entry) => entry.id === topic)), onlySurprise: rule.onlySurprise === true } : {}),
      channels: { browser: rule.channels?.browser !== false, email: rule.channels?.email === true },
      firedAt: typeof rule.firedAt === "string" ? rule.firedAt : null,
      armedAt: typeof rule.armedAt === "string" ? rule.armedAt : null,
      ...(typeof rule.label === "string" && rule.label.trim() ? { label: rule.label.trim().slice(0, 80) } : {}),
      ...(rule.type === "line" ? { line, direction: rule.direction === "below" ? "below" as const : "above" as const, ...(typeof rule.drawingId === "string" ? { drawingId: rule.drawingId } : {}) } : {}),
    }];
  });
}

const money = (value: number) => `$${value.toLocaleString("en-US", { maximumFractionDigits: value < 10 ? 2 : 0 })}`;

/** "AAPL above $250", "Results, 10-K and 10-Q… for everything you follow". */
export function describeRule(rule: AlertRule): string {
  const who = rule.ticker ?? "everything you follow";
  switch (rule.type) {
    case "price": return `${rule.ticker} ${rule.direction === "below" ? "falls below" : "rises above"} ${rule.level != null ? money(rule.level) : "—"}`;
    case "move": return `${rule.ticker} moves ${rule.movePct}% or more in a day`;
    case "filings": {
      const kinds = rule.kinds ?? [];
      const what = kinds.length === FILING_KINDS.length ? "Every filing that matters" : kinds.map((kind) => FILING_KINDS.find((entry) => entry.id === kind)?.label).filter(Boolean).join(", ") || "No filing kind chosen";
      return `${what} · ${who}`;
    }
    case "insider": return `Insider purchases${rule.minValue ? ` from ${money(rule.minValue)}` : ""} · ${who}`;
    case "line": return `${rule.ticker} ${rule.direction === "below" ? "falls below" : "rises above"} your ${rule.line ? LINE_NAMES[rule.line.reach] : "line"}${rule.line?.reach === "level" ? ` at ${money(rule.line.a.p)}` : ""}`;
    case "econ": return `${(rule.topics ?? []).map((topic) => ECON_TOPICS.find((entry) => entry.id === topic)?.label).filter(Boolean).join(", ") || "No release chosen"}${rule.onlySurprise ? " · only when it misses the consensus" : ""}`;
  }
}

/** The companies whose filings and insider purchases the rules need read. */
export function ruleTickers(rules: AlertRule[], followed: string[]): string[] {
  const out = new Set<string>();
  for (const rule of rules) {
    if (!rule.enabled || (rule.type !== "filings" && rule.type !== "insider")) continue;
    if (rule.ticker) out.add(rule.ticker); else for (const ticker of followed) out.add(ticker);
  }
  return [...out].sort();
}

/** The companies whose price the rules need. */
export const quoteTickers = (rules: AlertRule[]) => [...new Set(rules.filter((rule) => rule.enabled && (rule.type === "price" || rule.type === "move" || rule.type === "line") && rule.ticker).map((rule) => rule.ticker!))];

/** Alerts that fire once, until the reader sets them again: a price level, a chart line. */
export const firesOnce = (type: RuleType | string) => type === "price" || type === "line";

export interface Fired {
  ruleId: string;
  ticker: string | null;
  kind: "price" | "move" | "econ" | "line" | Alert["kind"];
  at: string;
  title: string;
  detail: string | null;
  url: string;
}

export interface Inputs {
  followed: string[];
  /** Filing and insider alerts of the companies the rules name (lib/alerts-feed.ts). */
  alerts: Array<Alert & { value?: number | null }>;
  quotes: Record<string, { price: number | null; changePercent: number | null }>;
  econ: EconEvent[];
  now: Date;
}

const covers = (rule: AlertRule, ticker: string, followed: Set<string>) => (rule.ticker ? rule.ticker === ticker : followed.has(ticker));

/** Every alert the enabled rules fire now. A price alert that has fired and not been set again is not fired again. */
export function evaluate(rules: AlertRule[], inputs: Inputs): Fired[] {
  const followed = new Set(inputs.followed);
  const fired: Fired[] = [];
  const today = inputs.now.toISOString().slice(0, 10);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.type === "price" && rule.ticker && rule.level != null) {
      const price = inputs.quotes[rule.ticker]?.price;
      const met = price != null && (rule.direction === "below" ? price <= rule.level : price >= rule.level);
      const spent = rule.firedAt != null && (!rule.armedAt || rule.armedAt <= rule.firedAt);
      if (met && !spent) fired.push({ ruleId: rule.id, ticker: rule.ticker, kind: "price", at: inputs.now.toISOString(), title: `${rule.direction === "below" ? "Fell below" : "Rose above"} ${money(rule.level)}`, detail: `At ${money(price!)}`, url: `/t/s/${encodeURIComponent(rule.ticker)}` });
    }
    if (rule.type === "line" && rule.ticker && rule.line) {
      const price = inputs.quotes[rule.ticker]?.price;
      const level = lineLevel(rule.line, inputs.now);
      const met = price != null && level != null && (rule.direction === "below" ? price <= level : price >= level);
      const spent = rule.firedAt != null && (!rule.armedAt || rule.armedAt <= rule.firedAt);
      if (met && !spent) {
        fired.push({
          ruleId: rule.id, ticker: rule.ticker, kind: "line", at: inputs.now.toISOString(),
          title: `${rule.direction === "below" ? "Fell below" : "Rose above"} your ${LINE_NAMES[rule.line.reach]}`,
          detail: `At ${money(price!)}, the line at ${money(level!)}`, url: `/t/chart?s=${encodeURIComponent(rule.ticker)}`,
        });
      }
    }
    if (rule.type === "move" && rule.ticker && rule.movePct != null) {
      const change = inputs.quotes[rule.ticker]?.changePercent;
      if (change != null && Math.abs(change * 100) >= rule.movePct) {
        fired.push({ ruleId: rule.id, ticker: rule.ticker, kind: "move", at: `${today}T00:00:00.000Z`, title: `${change >= 0 ? "Up" : "Down"} ${Math.abs(change * 100).toFixed(1)}% today`, detail: `Your threshold: ${rule.movePct}%`, url: `/t/s/${encodeURIComponent(rule.ticker)}` });
      }
    }
    if (rule.type === "filings") {
      const kinds = new Set(rule.kinds ?? []);
      for (const alert of inputs.alerts) {
        if (alert.kind === "insider" || !kinds.has(alert.kind as FilingKind) || !covers(rule, alert.ticker, followed)) continue;
        fired.push({ ruleId: rule.id, ticker: alert.ticker, kind: alert.kind, at: alert.at, title: alert.title, detail: alert.detail, url: alert.url });
      }
    }
    if (rule.type === "insider") {
      for (const alert of inputs.alerts) {
        if (alert.kind !== "insider" || !covers(rule, alert.ticker, followed)) continue;
        if (rule.minValue && (alert.value ?? 0) < rule.minValue) continue;
        fired.push({ ruleId: rule.id, ticker: alert.ticker, kind: "insider", at: alert.at, title: alert.title, detail: alert.detail, url: alert.url });
      }
    }
    if (rule.type === "econ") {
      const topics = ECON_TOPICS.filter((topic) => (rule.topics ?? []).includes(topic.id));
      for (const event of inputs.econ) {
        if (!event.actual || !topics.some((topic) => topic.match.test(event.name))) continue;
        if (rule.onlySurprise && (event.surprise === "inline" || event.surprise == null)) continue;
        fired.push({
          ruleId: rule.id, ticker: null, kind: "econ", at: `${event.date}T${event.time ?? "00:00"}:00.000Z`,
          title: `${event.name}: ${event.actual}`,
          detail: `Consensus ${event.consensus ?? "—"} · previous ${event.previous ?? "—"}${event.surprise && event.surprise !== "inline" ? ` · ${event.surprise} consensus` : ""}`,
          url: "/t/eco",
        });
      }
    }
  }
  // One filing can answer two rules (a company's own and "everything you follow"): told once.
  const seen = new Set<string>();
  return fired.filter((entry) => {
    const key = `${entry.kind}|${entry.ticker}|${entry.title}|${entry.at}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => right.at.localeCompare(left.at));
}
