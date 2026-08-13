export const CHART_PALETTE = [
  { name: "Fluorescent yellow", value: "#D8FF5F" },
  { name: "Electric blue", value: "#4DA3FF" },
  { name: "Emerald green", value: "#36D399" },
  { name: "Orange", value: "#FF9F43" },
  { name: "Red", value: "#FF647C" },
  { name: "Purple", value: "#A78BFA" },
  { name: "Cyan", value: "#32D5E2" },
  { name: "Pink", value: "#F472B6" },
  { name: "Lime", value: "#84CC16" },
  { name: "Neutral grey", value: "#94A3B8" },
] as const;

export type ScaleMode = "zero" | "auto" | "custom" | "log";

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
  "Stock price": ["stockPrice"],
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
