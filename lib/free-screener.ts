import { z } from "zod";
import { QS_COLUMNS } from "./qs-export";

export type ScreenUnit = "percent" | "ratio" | "billions" | "number" | "price";
export interface ScreenField { key: string; label: string; group: string; unit: ScreenUnit; source: "fundamental" | "consensus" | "technical" }
const fundamentals: Array<[string, string, ScreenUnit]> = [
  ["Market Cap", "Valuation", "billions"], ["ROIC", "Margins & returns", "percent"], ["ROIC 5Yr Avg", "Margins & returns", "percent"],
  ["Operating Margin", "Margins & returns", "percent"], ["FCF Margin 5Yr Avg", "Margins & returns", "percent"], ["Gross Margin 5Yr Avg", "Margins & returns", "percent"],
  ["FCF / Net Income", "Margins & returns", "percent"], ["SBC to Revenue", "Margins & returns", "percent"],
  ["Shares Outstanding 5Y CAGR", "Growth", "percent"], ["Net Debt / EBITDA", "Debt & liquidity", "ratio"],
  ["EBIT / Interest Expense", "Debt & liquidity", "ratio"], ["Current Ratio", "Debt & liquidity", "ratio"],
  ["Long-term Debt to Assets", "Debt & liquidity", "percent"], ["OCF/Capex", "Debt & liquidity", "ratio"],
  ...QS_COLUMNS.filter((key) => /CAGR/.test(key) && key !== "Shares Outstanding 5Y CAGR").map((key): [string, string, ScreenUnit] => [key, "Growth", "percent"]),
  ["FCF/Share 5Y R2", "Margins & returns", "number"], ["EV/EBIT", "Valuation", "ratio"], ["EV/FCF", "Valuation", "ratio"], ["FCF Yield", "Valuation", "percent"],
  ["OCF", "Cash flow", "billions"], ["Capex", "Cash flow", "billions"],
];
const consensus: Array<[string, string, ScreenUnit]> = [
  ["forwardPe", "Forward P/E · forecast", "ratio"], ["peg", "PEG · forecast", "ratio"],
  ["epsGrowth", "Expected EPS growth · FY to next FY", "percent"], ["epsRevision", "EPS consensus revision · 1 month", "percent"],
  ["targetUpside", "Price target upside", "percent"], ["buyShare", "Buy recommendations", "percent"], ["analysts", "EPS analysts", "number"],
];
const technical: Array<[string, string, ScreenUnit]> = [
  ["close", "Daily close", "price"], ["sma50", "SMA 50", "price"], ["sma200", "SMA 200", "price"],
  ["ema20", "EMA 20", "price"], ["ema200", "EMA 200", "price"], ["rsi14", "RSI 14", "number"],
  ["macd", "MACD", "price"], ["macdSignal", "MACD signal", "price"], ["volumeRatio", "Relative volume · 20 days", "ratio"],
  ["chg1", "Daily return", "percent"], ["chg20", "Return · 20 sessions", "percent"], ["chg252", "Return · 1 year", "percent"],
  ["fromHigh52", "Distance from 52-week high", "percent"], ["fromEma200", "Distance from EMA 200", "percent"], ["rsRating", "RS rating · S&P 500", "number"],
];
export const SCREEN_FIELDS: ScreenField[] = [
  ...fundamentals.map(([key, group, unit]): ScreenField => ({ key, label: key, group, unit, source: "fundamental" })),
  ...consensus.map(([key, label, unit]): ScreenField => ({ key, label, group: "Analysts' consensus", unit, source: "consensus" })),
  ...technical.map(([key, label, unit]): ScreenField => ({ key: `tech:${key}`, label, group: "Technical signals", unit, source: "technical" })),
];
export const SCREEN_FIELD = Object.fromEntries(SCREEN_FIELDS.map((field) => [field.key, field])) as Record<string, ScreenField>;
export const SCREEN_GROUPS = [...new Set(SCREEN_FIELDS.map((field) => field.group))];
export const SCREEN_OPERATORS = [
  ["gte", "≥"], ["gt", ">"], ["lte", "≤"], ["lt", "<"], ["eq", "="], ["neq", "≠"],
  ["between", "Between"], ["present", "Available"], ["missing", "Missing"],
  ["crossAbove", "Crosses above"], ["crossBelow", "Crosses below"],
] as const;
const fieldKey = z.string().refine((key) => Object.hasOwn(SCREEN_FIELD, key));
const conditionSchema = z.object({
  id: z.string().min(1).max(80), field: fieldKey,
  op: z.enum(["gte", "gt", "lte", "lt", "eq", "neq", "between", "present", "missing", "crossAbove", "crossBelow"]),
  target: z.enum(["number", "field"]), value: z.string().max(80), upper: z.string().max(80), other: fieldKey,
});
export type ScreenCondition = z.infer<typeof conditionSchema>;
const configSchema = z.object({
  mode: z.enum(["all", "any"]), scope: z.enum(["index", "watchlist"]), query: z.string().max(120), sectors: z.array(z.string().max(100)).max(30),
  conditions: z.array(conditionSchema).max(30), columns: z.array(fieldKey).min(1).max(24),
  sort: z.union([fieldKey, z.literal("ticker")]), descending: z.boolean(),
});
export type ScreenConfig = z.infer<typeof configSchema>;
export interface SavedScreen { id: string; name: string; config: ScreenConfig }
export interface ScreenStore { current: ScreenConfig; saved: SavedScreen[]; selected: string | null }
export const SCREEN_STORAGE_KEY = "finscope.free-screener.v1";
export const DEFAULT_SCREEN: ScreenConfig = {
  mode: "all", scope: "index", query: "", sectors: [], conditions: [],
  columns: ["Market Cap", "Revenue 5Y CAGR", "Operating Margin", "Net Debt / EBITDA", "FCF Yield", "forwardPe", "tech:rsi14"],
  sort: "Market Cap", descending: true,
};
export const newCondition = (id: string): ScreenCondition => ({ id, field: "Revenue 5Y CAGR", op: "gte", target: "number", value: "10", upper: "20", other: "Revenue 10Y CAGR" });

export function readScreenStore(raw: string | null): ScreenStore {
  const empty = { current: DEFAULT_SCREEN, saved: [], selected: null };
  try {
    const result = z.object({ current: configSchema, saved: z.array(z.object({ id: z.string().min(1).max(80), name: z.string().trim().min(1).max(60), config: configSchema })).max(50), selected: z.string().nullable() }).safeParse(JSON.parse(raw ?? "null"));
    if (!result.success) return empty;
    return { ...result.data, saved: result.data.saved.filter((row, at, rows) => rows.findIndex((entry) => entry.id === row.id) === at) };
  } catch { return empty; }
}

export function saveScreen(store: ScreenStore, name: string, id: string): ScreenStore {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return store;
  return { ...store, selected: id, saved: [{ id, name: trimmed, config: store.current }, ...store.saved.filter((entry) => entry.id !== id)].slice(0, 50) };
}

export interface ScreenRow {
  ticker: string; name: string; sector: string | null;
  currency: string | null;
  values: Record<string, number | null>;
  previous: Record<string, number | null>;
  dates: { fundamental: string | null; price: string | null; consensus: string | null; technical: string | null };
  period: string | null;
  epsBasis: string | null;
  sharesBasis: string | null;
  reasons: Partial<Record<ScreenField["source"] | "valuation", string>>;
}
const numeric = (text: string): number | null => text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : null;
export function conditionError(condition: ScreenCondition): string | null {
  if (!SCREEN_FIELD[condition.field]) return "Choose a metric.";
  if (condition.op === "present" || condition.op === "missing") return null;
  if ((condition.op === "crossAbove" || condition.op === "crossBelow") && SCREEN_FIELD[condition.field].source !== "technical") return "Crossovers require a technical signal.";
  if (condition.op === "between") {
    const low = numeric(condition.value), high = numeric(condition.upper);
    return low == null || high == null ? "Enter both bounds." : low > high ? "The lower bound must not exceed the upper bound." : null;
  }
  if (condition.target === "number") return numeric(condition.value) == null ? "Enter a finite number." : null;
  const left = SCREEN_FIELD[condition.field], right = SCREEN_FIELD[condition.other];
  if (!right || left.unit !== right.unit) return "Compare metrics with the same unit.";
  if ((condition.op === "crossAbove" || condition.op === "crossBelow") && right.source !== "technical") return "Both sides of a crossover must be technical signals.";
  return null;
}
type Match = "match" | "no" | "unknown";
export function conditionMatch(condition: ScreenCondition, row: ScreenRow): Match {
  const a = row.values[condition.field];
  const has = a != null && Number.isFinite(a);
  if (condition.op === "present") return has ? "match" : "no";
  if (condition.op === "missing") return has ? "no" : "match";
  if (!has) return "unknown";
  const b = condition.target === "field" && condition.op !== "between" ? row.values[condition.other] : numeric(condition.value);
  if (b == null || !Number.isFinite(b)) return "unknown";
  let holds = false;
  switch (condition.op) {
    case "gte": holds = a >= b; break;
    case "gt": holds = a > b; break;
    case "lte": holds = a <= b; break;
    case "lt": holds = a < b; break;
    case "eq": holds = a === b; break;
    case "neq": holds = a !== b; break;
    case "between": holds = a >= b && a <= Number(condition.upper); break;
    default: {
      const before = row.previous[condition.field];
      const targetBefore = condition.target === "field" ? row.previous[condition.other] : b;
      if (before == null || targetBefore == null || !Number.isFinite(before) || !Number.isFinite(targetBefore)) return "unknown";
      holds = condition.op === "crossAbove" ? a > b && before <= targetBefore : a < b && before >= targetBefore;
    }
  }
  return holds ? "match" : "no";
}

export function runScreen(rows: ScreenRow[], config: ScreenConfig, watchlist: readonly string[] = []) {
  const errors = config.conditions.map(conditionError).filter((error): error is string => error != null);
  const query = config.query.trim().toLocaleLowerCase();
  const scoped = rows.filter((row) => (config.scope !== "watchlist" || watchlist.includes(row.ticker))
    && (!config.sectors.length || (row.sector != null && config.sectors.includes(row.sector)))
    && (!query || `${row.ticker} ${row.name}`.toLocaleLowerCase().includes(query)));
  const matches: ScreenRow[] = [];
  let unknown = 0;
  if (!errors.length) for (const row of scoped) {
    const decisions = config.conditions.map((condition) => conditionMatch(condition, row));
    const result = !decisions.length ? "match" : config.mode === "all"
      ? decisions.includes("no") ? "no" : decisions.includes("unknown") ? "unknown" : "match"
      : decisions.includes("match") ? "match" : decisions.includes("unknown") ? "unknown" : "no";
    if (result === "match") matches.push(row);
    else if (result === "unknown") unknown++;
  }
  matches.sort((a, b) => {
    if (config.sort === "ticker") return (config.descending ? -1 : 1) * a.ticker.localeCompare(b.ticker);
    const left = a.values[config.sort], right = b.values[config.sort];
    if (left == null) return right == null ? a.ticker.localeCompare(b.ticker) : 1;
    if (right == null) return -1;
    return (config.descending ? -1 : 1) * (left - right) || a.ticker.localeCompare(b.ticker);
  });
  return { matches, unknown, considered: scoped.length, errors };
}

export const SCREEN_PRESETS: Array<{ name: string; config: ScreenConfig }> = [
  { name: "Quality & cash", config: { ...DEFAULT_SCREEN, conditions: [
    { ...newCondition("p1"), field: "ROIC", value: "15" }, { ...newCondition("p2"), field: "Net Debt / EBITDA", op: "lte", value: "2" }, { ...newCondition("p3"), field: "FCF Yield", value: "4" },
  ] } },
  { name: "Growth & trend", config: { ...DEFAULT_SCREEN, conditions: [newCondition("p1"),
    { ...newCondition("p2"), field: "tech:close", target: "field", other: "tech:sma200", op: "gt" },
  ], columns: ["Revenue 5Y CAGR", "FCF Per Share 5Y CAGR", "Operating Margin", "tech:close", "tech:sma200", "tech:rsi14"] } },
  { name: "Analysts revising up", config: { ...DEFAULT_SCREEN, conditions: [
    { ...newCondition("p1"), field: "epsRevision", op: "gt", value: "0" }, { ...newCondition("p2"), field: "epsGrowth", value: "10" },
  ], columns: ["forwardPe", "peg", "epsGrowth", "epsRevision", "targetUpside", "analysts"] } },
];
