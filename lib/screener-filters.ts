import { SCREEN_FIELD, type ScreenCondition, type ScreenField } from "./free-screener";

/**
 * The screener's quick filters and column views, Finviz-style: a grid of
 * named filters, each a drop-down of ready thresholds ("Under 15", "Over
 * 10%", "Net cash"), and tabs of column sets. A filter writes an ordinary
 * criterion (lib/free-screener.ts) under the id `f:<filter>`, so saved
 * searches, the AND/OR logic and the advanced rule builder keep working on
 * the same list; anything else in that list is an advanced rule.
 *
 * Values are in the units the editor states: percentage points for
 * percentages, billions for amounts, times for ratios.
 */

export interface FilterOption {
  label: string;
  op: ScreenCondition["op"];
  value?: string;
  upper?: string;
  /** Compare with another metric instead of a number (price above its SMA 200). */
  other?: string;
}

export interface QuickFilter { id: string; label: string; field: string; options: FilterOption[] }

export const FILTER_PREFIX = "f:";
export const isQuickCondition = (condition: Pick<ScreenCondition, "id">) => condition.id.startsWith(FILTER_PREFIX);

const over = (value: number, unit = ""): FilterOption => ({ label: `Over ${value}${unit}`, op: "gt", value: String(value) });
const under = (value: number, unit = ""): FilterOption => ({ label: `Under ${value}${unit}`, op: "lt", value: String(value) });
const between = (label: string, low: number, high: number): FilterOption => ({ label, op: "between", value: String(low), upper: String(high) });
const positive: FilterOption = { label: "Positive", op: "gt", value: "0" };
const negative: FilterOption = { label: "Negative", op: "lt", value: "0" };

const growth = [negative, positive, over(5, "%"), over(10, "%"), over(15, "%"), over(20, "%"), over(30, "%"), under(5, "%"), under(10, "%"), under(-10, "%")];
const margin = [negative, positive, over(5, "%"), over(10, "%"), over(15, "%"), over(20, "%"), over(30, "%"), over(40, "%"), under(10, "%")];
const multiple = [between("Low · under 15", 0, 15), under(10), under(20), under(25), under(30), under(40), over(15), over(25), over(40), over(50)];

const filter = (id: string, label: string, field: string, options: FilterOption[]): QuickFilter => ({ id, label, field, options });

export const FILTER_TABS: Array<{ id: string; label: string; filters: QuickFilter[] }> = [
  { id: "descriptive", label: "Descriptive", filters: [
    filter("cap", "Market cap", "Market Cap", [
      { label: "Mega · $200B+", op: "gte", value: "200" }, between("Large · $10–200B", 10, 200), between("Mid · $2–10B", 2, 10), { label: "Small · under $2B", op: "lt", value: "2" },
      { label: "Over $50B", op: "gt", value: "50" }, { label: "Over $100B", op: "gt", value: "100" }, { label: "Over $1T", op: "gt", value: "1000" },
    ]),
    filter("price", "Price", "tech:close", [under(10), under(20), under(50), over(50), over(100), over(500)]),
    filter("relvol", "Relative volume", "tech:volumeRatio", [over(1), over(1.5), over(2), over(3), under(0.5), under(1)]),
    filter("analysts", "Analysts", "analysts", [over(5), over(10), over(20), over(30), under(5)]),
  ] },
  { id: "valuation", label: "Valuation", filters: [
    filter("fpe", "Forward P/E", "forwardPe", [...multiple, { label: "Profitable · any", op: "present" }]),
    filter("peg", "PEG", "peg", [under(1), under(1.5), under(2), under(3), over(1), over(2), over(3)]),
    filter("evebit", "EV/EBIT", "EV/EBIT", [positive, ...multiple]),
    filter("evfcf", "EV/FCF", "EV/FCF", [positive, ...multiple]),
    filter("fcfy", "FCF yield", "FCF Yield", [negative, positive, over(2, "%"), over(4, "%"), over(6, "%"), over(8, "%"), over(10, "%"), under(2, "%")]),
    filter("upside", "Target upside", "targetUpside", [negative, positive, over(10, "%"), over(20, "%"), over(30, "%"), over(50, "%"), under(-10, "%")]),
  ] },
  { id: "profitability", label: "Profitability", filters: [
    filter("roic", "ROIC", "ROIC", margin),
    filter("roic5", "ROIC 5Y avg", "ROIC 5Yr Avg", margin),
    filter("opm", "Operating margin", "Operating Margin", margin),
    filter("gm5", "Gross margin 5Y", "Gross Margin 5Yr Avg", margin),
    filter("fcfm5", "FCF margin 5Y", "FCF Margin 5Yr Avg", margin),
    filter("conv", "FCF / net income", "FCF / Net Income", [over(80, "%"), over(100, "%"), under(50, "%"), under(80, "%")]),
    filter("sbc", "SBC / revenue", "SBC to Revenue", [under(1, "%"), under(2, "%"), under(5, "%"), over(5, "%"), over(10, "%")]),
  ] },
  { id: "growth", label: "Growth", filters: [
    filter("rev5", "Revenue 5Y", "Revenue 5Y CAGR", growth),
    filter("rev10", "Revenue 10Y", "Revenue 10Y CAGR", growth),
    filter("rps5", "Revenue/share 5Y", "Revenue Per Share 5Y CAGR", growth),
    filter("ni5", "Net income 5Y", "Net Income 5Y CAGR", growth),
    filter("fcfps5", "FCF/share 5Y", "FCF Per Share 5Y CAGR", growth),
    filter("r2", "FCF/share steadiness", "FCF/Share 5Y R2", [over(0.5), over(0.7), over(0.9), under(0.3)]),
    filter("shares", "Share count 5Y", "Shares Outstanding 5Y CAGR", [{ label: "Shrinking", op: "lt", value: "0" }, { label: "Buybacks · under −2%", op: "lt", value: "-2" }, { label: "Diluting · over 1%", op: "gt", value: "1" }, { label: "Diluting · over 3%", op: "gt", value: "3" }]),
    filter("epsg", "EPS growth next FY", "epsGrowth", growth),
  ] },
  { id: "balance", label: "Balance sheet", filters: [
    filter("nde", "Net debt / EBITDA", "Net Debt / EBITDA", [{ label: "Net cash", op: "lt", value: "0" }, under(1), under(2), under(3), over(3), over(4)]),
    filter("cover", "Interest cover", "EBIT / Interest Expense", [under(2), over(3), over(5), over(10), over(20)]),
    filter("current", "Current ratio", "Current Ratio", [under(1), over(1), over(1.5), over(2), over(3)]),
    filter("ltda", "LT debt / assets", "Long-term Debt to Assets", [under(10, "%"), under(20, "%"), under(30, "%"), under(40, "%"), over(30, "%"), over(50, "%")]),
    filter("ocfcapex", "OCF / capex", "OCF/Capex", [under(1), over(1), over(2), over(5), over(10)]),
  ] },
  { id: "consensus", label: "Consensus", filters: [
    filter("rev", "EPS revision 1M", "epsRevision", [{ label: "Raised", op: "gt", value: "0" }, { label: "Cut", op: "lt", value: "0" }, over(1, "%"), over(3, "%"), over(5, "%"), under(-3, "%")]),
    filter("buy", "Buy ratings", "buyShare", [over(50, "%"), over(70, "%"), over(90, "%"), under(30, "%")]),
    filter("cfpe", "Forward P/E", "forwardPe", multiple),
    filter("cpeg", "PEG", "peg", [under(1), under(2), over(2)]),
    filter("cupside", "Target upside", "targetUpside", [negative, positive, over(10, "%"), over(20, "%"), over(30, "%")]),
    filter("cepsg", "EPS growth next FY", "epsGrowth", growth),
  ] },
  { id: "technical", label: "Technical", filters: [
    filter("sma", "Price vs SMA", "tech:close", [
      { label: "Above SMA 50", op: "gt", other: "tech:sma50" }, { label: "Below SMA 50", op: "lt", other: "tech:sma50" },
      { label: "Above SMA 200", op: "gt", other: "tech:sma200" }, { label: "Below SMA 200", op: "lt", other: "tech:sma200" },
      { label: "Crossed above SMA 50", op: "crossAbove", other: "tech:sma50" }, { label: "Crossed below SMA 50", op: "crossBelow", other: "tech:sma50" },
      { label: "Crossed above SMA 200", op: "crossAbove", other: "tech:sma200" }, { label: "Crossed below SMA 200", op: "crossBelow", other: "tech:sma200" },
    ]),
    filter("cross", "SMA 50 vs 200", "tech:sma50", [
      { label: "SMA 50 above 200", op: "gt", other: "tech:sma200" }, { label: "SMA 50 below 200", op: "lt", other: "tech:sma200" },
      { label: "Golden cross", op: "crossAbove", other: "tech:sma200" }, { label: "Death cross", op: "crossBelow", other: "tech:sma200" },
    ]),
    filter("rsi", "RSI 14", "tech:rsi14", [{ label: "Overbought · over 70", op: "gt", value: "70" }, { label: "Oversold · under 30", op: "lt", value: "30" }, over(50), under(50), between("Neutral · 30–70", 30, 70)]),
    filter("perf1", "Performance today", "tech:chg1", [{ label: "Up", op: "gt", value: "0" }, { label: "Down", op: "lt", value: "0" }, over(2, "%"), over(5, "%"), under(-2, "%"), under(-5, "%")]),
    filter("perf20", "Performance 1M", "tech:chg20", [{ label: "Up", op: "gt", value: "0" }, { label: "Down", op: "lt", value: "0" }, over(5, "%"), over(10, "%"), over(20, "%"), under(-10, "%")]),
    filter("perf252", "Performance 1Y", "tech:chg252", [{ label: "Up", op: "gt", value: "0" }, { label: "Down", op: "lt", value: "0" }, over(20, "%"), over(50, "%"), over(100, "%"), under(-20, "%")]),
    filter("high", "From 52W high", "tech:fromHigh52", [{ label: "Within 5%", op: "gte", value: "-5" }, { label: "Within 10%", op: "gte", value: "-10" }, { label: "20%+ below", op: "lte", value: "-20" }, { label: "30%+ below", op: "lte", value: "-30" }, { label: "50%+ below", op: "lte", value: "-50" }]),
    filter("ema200", "From EMA 200", "tech:fromEma200", [{ label: "Above", op: "gt", value: "0" }, { label: "Below", op: "lt", value: "0" }, over(10, "%"), over(20, "%"), under(-10, "%"), under(-20, "%")]),
    filter("rs", "RS rating", "tech:rsRating", [over(50), over(70), over(80), over(90), under(30)]),
  ] },
];

export const QUICK_FILTERS: Record<string, QuickFilter> = Object.fromEntries(FILTER_TABS.flatMap((tab) => tab.filters).map((entry) => [entry.id, entry]));

/** The criterion a filter option stands for. */
export function conditionFor(filterId: string, option: FilterOption): ScreenCondition {
  const quick = QUICK_FILTERS[filterId];
  return {
    id: `${FILTER_PREFIX}${filterId}`, field: quick.field, op: option.op,
    target: option.other ? "field" : "number",
    value: option.value ?? "", upper: option.upper ?? "",
    other: option.other ?? quick.field,
  };
}

/** A custom range typed into a filter: both bounds, one, or none (no criterion). */
export function customCondition(filterId: string, low: string, high: string): ScreenCondition | null {
  const quick = QUICK_FILTERS[filterId];
  const hasLow = low.trim() !== "" && Number.isFinite(Number(low));
  const hasHigh = high.trim() !== "" && Number.isFinite(Number(high));
  if (!hasLow && !hasHigh) return null;
  const op = hasLow && hasHigh ? "between" : hasLow ? "gte" : "lte";
  return { id: `${FILTER_PREFIX}${filterId}`, field: quick.field, op, target: "number", value: hasLow ? low.trim() : high.trim(), upper: hasLow && hasHigh ? high.trim() : "", other: quick.field };
}

/** Which ready option a criterion is, by index; -1 when it is a custom range. */
export function optionIndex(filterId: string, condition: ScreenCondition): number {
  const quick = QUICK_FILTERS[filterId];
  return quick.options.findIndex((option) => option.op === condition.op
    && (option.other ? condition.target === "field" && condition.other === option.other : condition.target === "number"
      && (option.value ?? "") === condition.value && (option.op !== "between" || (option.upper ?? "") === condition.upper)));
}

/** The bounds a custom criterion was typed with, for its two inputs. */
export function customBounds(condition: ScreenCondition): { low: string; high: string } {
  if (condition.op === "between") return { low: condition.value, high: condition.upper };
  if (condition.op === "gte" || condition.op === "gt") return { low: condition.value, high: "" };
  if (condition.op === "lte" || condition.op === "lt") return { low: "", high: condition.value };
  return { low: "", high: "" };
}

const OP_TEXT: Record<string, string> = { gte: "≥", gt: ">", lte: "≤", lt: "<", eq: "=", neq: "≠", crossAbove: "crossed above", crossBelow: "crossed below" };

/** A criterion in a few words, for its chip: "Forward P/E · Under 20", "ROIC ≥ 12". */
export function describeCondition(condition: ScreenCondition): string {
  const filterId = isQuickCondition(condition) ? condition.id.slice(FILTER_PREFIX.length) : null;
  const quick = filterId ? QUICK_FILTERS[filterId] : null;
  if (quick) {
    const index = optionIndex(quick.id, condition);
    if (index >= 0) return `${quick.label} · ${quick.options[index].label}`;
  }
  const field = SCREEN_FIELD[condition.field];
  const name = quick?.label ?? field?.label ?? condition.field;
  if (condition.op === "present") return `${name} · available`;
  if (condition.op === "missing") return `${name} · missing`;
  if (condition.op === "between") return `${name} ${condition.value}–${condition.upper}`;
  const target = condition.target === "field" ? SCREEN_FIELD[condition.other]?.label ?? condition.other : condition.value;
  return `${name} ${OP_TEXT[condition.op] ?? condition.op} ${target}`;
}

/** Column sets, as Finviz's views. "custom" is the reader's own list. */
export const VIEWS: Array<{ id: string; label: string; columns: string[] }> = [
  { id: "overview", label: "Overview", columns: ["Market Cap", "forwardPe", "EV/FCF", "FCF Yield", "Revenue 5Y CAGR", "Operating Margin", "ROIC", "epsRevision", "tech:chg252"] },
  { id: "valuation", label: "Valuation", columns: ["Market Cap", "forwardPe", "peg", "EV/EBIT", "EV/FCF", "FCF Yield", "targetUpside", "epsGrowth"] },
  { id: "profitability", label: "Profitability", columns: ["ROIC", "ROIC 5Yr Avg", "Operating Margin", "Gross Margin 5Yr Avg", "FCF Margin 5Yr Avg", "FCF / Net Income", "SBC to Revenue"] },
  { id: "growth", label: "Growth", columns: ["Revenue 5Y CAGR", "Revenue 10Y CAGR", "Revenue Per Share 5Y CAGR", "Net Income 5Y CAGR", "FCF Per Share 5Y CAGR", "FCF/Share 5Y R2", "Shares Outstanding 5Y CAGR", "epsGrowth"] },
  { id: "balance", label: "Balance sheet", columns: ["Net Debt / EBITDA", "EBIT / Interest Expense", "Current Ratio", "Long-term Debt to Assets", "OCF/Capex", "OCF", "Capex"] },
  { id: "consensus", label: "Consensus", columns: ["forwardPe", "peg", "epsGrowth", "epsRevision", "targetUpside", "buyShare", "analysts"] },
  { id: "technical", label: "Technical", columns: ["tech:close", "tech:chg1", "tech:chg20", "tech:chg252", "tech:rsi14", "tech:fromHigh52", "tech:fromEma200", "tech:volumeRatio", "tech:rsRating"] },
];

/** Short headers for a dense table; the full name is the header's title. */
export const SHORT: Record<string, string> = {
  "Market Cap": "Mkt cap", forwardPe: "Fwd P/E", peg: "PEG", "EV/EBIT": "EV/EBIT", "EV/FCF": "EV/FCF", "FCF Yield": "FCF yld",
  targetUpside: "Upside", epsGrowth: "EPS g. FY+1", epsRevision: "EPS rev 1M", buyShare: "Buy %", analysts: "Analysts",
  ROIC: "ROIC", "ROIC 5Yr Avg": "ROIC 5Y", "Operating Margin": "Op margin", "Gross Margin 5Yr Avg": "Gross m. 5Y", "FCF Margin 5Yr Avg": "FCF m. 5Y",
  "FCF / Net Income": "FCF/NI", "SBC to Revenue": "SBC/rev", "Revenue 5Y CAGR": "Rev 5Y", "Revenue 10Y CAGR": "Rev 10Y",
  "Revenue Per Share 5Y CAGR": "Rev/sh 5Y", "Revenue Per Share 10Y CAGR": "Rev/sh 10Y", "Net Income 5Y CAGR": "NI 5Y", "Net Income 10Y CAGR": "NI 10Y",
  "FCF 5Y CAGR": "FCF 5Y", "FCF 10Y CAGR": "FCF 10Y", "FCF Per Share 5Y CAGR": "FCF/sh 5Y", "FCF Per Share 10Y CAGR": "FCF/sh 10Y",
  "FCF/Share 5Y R2": "FCF/sh R²", "Shares Outstanding 5Y CAGR": "Shares 5Y", "Net Debt / EBITDA": "ND/EBITDA",
  "EBIT / Interest Expense": "Int. cover", "Current Ratio": "Current", "Long-term Debt to Assets": "LTD/assets", "OCF/Capex": "OCF/capex",
  OCF: "OCF", Capex: "Capex", "tech:close": "Price", "tech:sma50": "SMA 50", "tech:sma200": "SMA 200", "tech:ema20": "EMA 20", "tech:ema200": "EMA 200",
  "tech:rsi14": "RSI", "tech:macd": "MACD", "tech:macdSignal": "MACD sig", "tech:volumeRatio": "Rel vol", "tech:chg1": "Today",
  "tech:chg20": "1M", "tech:chg252": "1Y", "tech:fromHigh52": "From high", "tech:fromEma200": "vs EMA200", "tech:rsRating": "RS",
};

/** Fields whose sign is the news: coloured green above zero and red below. */
export const SIGNED = new Set([
  "targetUpside", "epsGrowth", "epsRevision", "Revenue 5Y CAGR", "Revenue 10Y CAGR", "Revenue Per Share 5Y CAGR", "Revenue Per Share 10Y CAGR",
  "Net Income 5Y CAGR", "Net Income 10Y CAGR", "FCF 5Y CAGR", "FCF 10Y CAGR", "FCF Per Share 5Y CAGR", "FCF Per Share 10Y CAGR",
  "tech:chg1", "tech:chg20", "tech:chg252", "tech:fromEma200", "Operating Margin", "ROIC", "FCF Yield",
]);

/** A value as the table writes it: $2.82T, 18.9×, 12.3%, 54. */
export function formatValue(value: number | null | undefined, field: ScreenField, currency: string | null = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const size = Math.abs(value);
  const symbol = currency === "USD" || currency == null ? "$" : `${currency} `;
  switch (field.unit) {
    case "percent": return `${sign}${size.toFixed(size >= 100 ? 0 : 1)}%`;
    case "ratio": return `${sign}${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)}×`;
    case "billions": return size >= 1000 ? `${sign}${symbol}${(size / 1000).toFixed(2)}T` : size >= 1 ? `${sign}${symbol}${size.toFixed(size >= 100 ? 0 : 1)}B` : `${sign}${symbol}${(size * 1000).toFixed(0)}M`;
    case "price": return `${sign}${size.toFixed(2)}`;
    default: return field.key === "FCF/Share 5Y R2" ? value.toFixed(2) : `${sign}${size.toFixed(size >= 100 || Number.isInteger(size) ? 0 : 1)}`;
  }
}

const pick = (filterId: string, label: string): ScreenCondition => {
  const option = QUICK_FILTERS[filterId].options.find((entry) => entry.label === label);
  if (!option) throw new Error(`No option "${label}" in filter ${filterId}.`);
  return conditionFor(filterId, option);
};

/** Ready screens: quick filters, a view and a sort. */
export const RECIPES: Array<{ name: string; conditions: ScreenCondition[]; view: string; sort: string; descending: boolean }> = [
  { name: "Quality & cash", view: "profitability", sort: "ROIC", descending: true, conditions: [pick("roic", "Over 15%"), pick("nde", "Under 2"), pick("fcfy", "Over 4%")] },
  { name: "Cheap growers", view: "valuation", sort: "peg", descending: false, conditions: [pick("fpe", "Under 20"), pick("epsg", "Over 15%"), pick("peg", "Under 1.5")] },
  { name: "Analysts raising", view: "consensus", sort: "epsRevision", descending: true, conditions: [pick("rev", "Over 1%"), pick("epsg", "Over 10%")] },
  { name: "Net-cash compounders", view: "growth", sort: "Revenue 5Y CAGR", descending: true, conditions: [pick("nde", "Net cash"), pick("rev5", "Over 10%"), pick("opm", "Over 20%")] },
  { name: "Growth in an uptrend", view: "technical", sort: "tech:chg252", descending: true, conditions: [pick("rev5", "Over 10%"), pick("sma", "Above SMA 200"), pick("cross", "SMA 50 above 200")] },
  { name: "Oversold quality", view: "technical", sort: "tech:rsi14", descending: false, conditions: [pick("rsi", "Oversold · under 30"), pick("roic", "Over 15%")] },
  { name: "Near 52-week high", view: "technical", sort: "tech:fromHigh52", descending: true, conditions: [pick("high", "Within 5%"), pick("perf252", "Over 20%")] },
];
