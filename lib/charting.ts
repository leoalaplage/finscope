/**
 * Categorical series colours, in fixed assignment order.
 *
 * These are stepped for a white chart surface and verified with the palette
 * validator rather than chosen by eye: every slot sits inside the L 0.43–0.77
 * lightness band, clears the chroma floor, and keeps adjacent pairs separable
 * under protanopia, deuteranopia and tritanopia (worst adjacent ΔE 9.1) as well
 * as for normal vision (worst adjacent ΔE 19.6).
 *
 * The previous palette was inherited from a dark theme this interface no longer
 * has. Its first and most-used entry was a fluorescent yellow measuring 1.11:1
 * against white — a line the reader could barely see.
 *
 * Slots below 3:1 contrast rely on the direct end-labels and the data table for
 * relief, which the method requires and this workspace provides.
 */
export const CHART_PALETTE = [
  { name: "Blue", value: "#2a78d6" },
  { name: "Orange", value: "#eb6834" },
  { name: "Aqua", value: "#1baf7a" },
  { name: "Yellow", value: "#eda100" },
  { name: "Magenta", value: "#e87ba4" },
  { name: "Green", value: "#008300" },
  { name: "Violet", value: "#4a3aa7" },
  { name: "Red", value: "#e34948" },
] as const;

export type ScaleMode = "zero" | "auto" | "custom" | "log" | "fit";
export type CurveStyle = "straight" | "curved" | "step";
export type AnomalyMode = "validated" | "raw";
export const CHART_DEFAULTS = { window: "max" as const, curve: "straight" as CurveStyle, anomalyMode: "validated" as AnomalyMode, robustScale: false };

export function rechartsCurve(style: CurveStyle) { return style === "curved" ? "monotone" as const : style === "step" ? "stepAfter" as const : "linear" as const; }

export function robustValues(values: Array<number | null | undefined>) {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a,b)=>a-b);
  if (finite.length < 5) return finite;
  const at = (fraction: number) => finite[Math.min(finite.length - 1, Math.max(0, Math.floor((finite.length - 1) * fraction)))];
  const q1 = at(.25); const q3 = at(.75); const iqr = q3 - q1;
  return finite.filter((value) => value >= q1 - 1.5 * iqr && value <= q3 + 1.5 * iqr);
}

export function chartDomain(values: Array<number | null | undefined>, mode: ScaleMode, custom?: { min: number; max: number }) {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (mode === "custom") {
    if (!custom || !Number.isFinite(custom.min) || !Number.isFinite(custom.max) || custom.min >= custom.max) return { domain: ["auto", "auto"] as const, warning: "Custom minimum must be lower than maximum." };
    return { domain: [custom.min, custom.max] as [number, number] };
  }
  if (mode === "auto" || finite.length === 0) return { domain: ["auto", "auto"] as const };
  if (mode === "log") {
    if (finite.some((value) => value <= 0)) return { domain: ["auto", "auto"] as const, warning: "Logarithmic scale requires strictly positive values." };
    return { domain: ["auto", "auto"] as const };
  }
  if (mode === "fit") {
    // Frames the data itself with a small margin. Useful when the interesting
    // variation is a few percent sitting a long way from zero, which anchoring
    // to zero would flatten into a straight line.
    const minimum = Math.min(...finite); const maximum = Math.max(...finite);
    if (minimum === maximum) return { domain: [minimum - 1, maximum + 1] as [number, number] };
    const margin = (maximum - minimum) * 0.08;
    // The breathing room must not invent a sign the data never had: a share
    // price framed down to -39 reads as though it could go negative.
    const lower = minimum >= 0 ? Math.max(0, minimum - margin) : minimum - margin;
    const upper = maximum <= 0 ? Math.min(0, maximum + margin) : maximum + margin;
    return { domain: [lower, upper] as [number, number] };
  }
  const minimum = Math.min(...finite); const maximum = Math.max(...finite);
  if (minimum < 0) {
    const lower = minimum * 1.08; const upper = maximum > 0 ? maximum * 1.08 : 0;
    return { domain: [lower, upper] as [number, number] };
  }
  return { domain: [0, maximum === 0 ? 1 : maximum * 1.08] as [number, number] };
}

export const METRIC_CATEGORIES: Record<string, string[]> = {
  "Income statement": ["revenue", "grossProfit", "operatingIncome", "netIncome", "incomeBeforeTax", "incomeTaxExpense"],
  "Cash flow": ["operatingCashFlow", "capitalExpenditures", "freeCashFlow", "depreciationAndAmortization"],
  Margins: ["grossMargin", "operatingMargin", "netMargin", "operatingCashFlowMargin", "freeCashFlowMargin"],
  "Per share": ["revenuePerShare", "grossProfitPerShare", "operatingIncomePerShare", "netIncomePerShare", "operatingCashFlowPerShare", "freeCashFlowPerShare"],
  Growth: ["revenueGrowth", "freeCashFlowGrowth", "freeCashFlowPerShareGrowth"],
  CAGR: ["revenueCagr", "freeCashFlowCagr", "freeCashFlowPerShareCagr"],
  "Shares and dilution": ["basicShares", "dilutedShares", "sharesOutstanding", "shareCountChange", "cumulativeDilution"],
  "Capital allocation": ["shareRepurchases", "shareIssuance", "netShareRepurchases", "stockBasedCompensation"],
  Valuation: ["marketCapitalization", "priceToSales", "priceToEarnings", "priceToFreeCashFlow", "freeCashFlowYield"],
  "Stock price": ["stockPrice", "stockTotalReturn"],
  "Quality metrics": ["cashConversion", "stockBasedCompensationToRevenue", "stockBasedCompensationToFcf", "marginStability", "roic"],
};

export const CHART_PRESETS: Record<string, string[]> = {
  "Revenue & Revenue Growth": ["revenue", "revenueGrowth"],
  "FCF & FCF Margin": ["freeCashFlow", "freeCashFlowMargin"],
  "FCF & FCF per Share": ["freeCashFlow", "freeCashFlowPerShare"],
  "FCF per Share & Diluted Shares": ["freeCashFlowPerShare", "dilutedShares"],
  "Revenue per Share & FCF per Share": ["revenuePerShare", "freeCashFlowPerShare"],
  "Margins Overview": ["grossMargin", "operatingMargin", "netMargin", "freeCashFlowMargin"],
  "Capital Allocation": ["shareRepurchases", "shareIssuance", "stockBasedCompensation", "dilutedShares"],
  "Stock Price & FCF per Share": ["stockPrice", "freeCashFlowPerShare"],
  "Quality Overview": ["freeCashFlowPerShare", "freeCashFlowMargin", "cashConversion", "dilutedShares"],
};

export function indexedTo100(values: Array<number | null>) {
  const start = values.find((value): value is number => value != null && value !== 0);
  return values.map((value) => value == null || start == null ? null : value / start * 100);
}

export function convertHistoricalCurrency(value: number | null, rate: number | null) {
  return value == null || rate == null || rate <= 0 ? null : value * rate;
}
