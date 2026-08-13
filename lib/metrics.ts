import { FORMULAS } from "./finance";

export type MetricKind = "currency" | "shares" | "percent" | "perShare";
export interface MetricDefinition { label: string; short: string; color: string; kind: MetricKind; formula?: string }

export const METRICS: Record<string, MetricDefinition> = {
  revenue: { label: "Revenue", short: "Revenue", color: "#53d39c", kind: "currency" },
  grossProfit: { label: "Gross profit", short: "Gross profit", color: "#67b7ff", kind: "currency" },
  operatingIncome: { label: "Operating income", short: "Operating income", color: "#a78bfa", kind: "currency" },
  netIncome: { label: "Net income", short: "Net income", color: "#f4bc56", kind: "currency" },
  operatingCashFlow: { label: "Operating cash flow", short: "Operating CF", color: "#48cbd4", kind: "currency" },
  capitalExpenditures: { label: "Capital expenditures", short: "Capex", color: "#f9737f", kind: "currency" },
  freeCashFlow: { label: "Free cash flow", short: "Free cash flow", color: "#c8f169", kind: "currency", formula: FORMULAS.freeCashFlow },
  grossMargin: { label: "Gross margin", short: "Gross margin", color: "#67b7ff", kind: "percent", formula: FORMULAS.grossMargin },
  operatingMargin: { label: "Operating margin", short: "Operating margin", color: "#a78bfa", kind: "percent", formula: FORMULAS.operatingMargin },
  netMargin: { label: "Net margin", short: "Net margin", color: "#f4bc56", kind: "percent", formula: FORMULAS.netMargin },
  operatingCashFlowMargin: { label: "Operating cash flow margin", short: "OCF margin", color: "#48cbd4", kind: "percent", formula: FORMULAS.operatingCashFlowMargin },
  freeCashFlowMargin: { label: "Free cash flow margin", short: "FCF margin", color: "#c8f169", kind: "percent", formula: FORMULAS.freeCashFlowMargin },
  dilutedShares: { label: "Diluted weighted average shares", short: "Diluted shares", color: "#67b7ff", kind: "shares" },
  basicShares: { label: "Basic weighted average shares", short: "Basic shares", color: "#8c9db7", kind: "shares" },
  sharesOutstanding: { label: "Shares outstanding · period end", short: "Shares outstanding", color: "#f4bc56", kind: "shares" },
  sharesIssued: { label: "Shares issued", short: "Shares issued", color: "#c084fc", kind: "shares" },
  treasuryShares: { label: "Treasury shares", short: "Treasury shares", color: "#fb7185", kind: "shares" },
  stockBasedCompensation: { label: "Stock-based compensation", short: "SBC", color: "#f59e0b", kind: "currency" },
  shareRepurchases: { label: "Gross share repurchases", short: "Buybacks", color: "#53d39c", kind: "currency" },
  shareIssuance: { label: "Stock issuance proceeds", short: "Issuance proceeds", color: "#f9737f", kind: "currency" },
  netShareRepurchases: { label: "Net share repurchases", short: "Net buybacks", color: "#22c55e", kind: "currency", formula: "Gross repurchases − issuance proceeds" },
  revenuePerShare: { label: "Revenue per share", short: "Revenue / share", color: "#53d39c", kind: "perShare", formula: FORMULAS.revenuePerShare },
  grossProfitPerShare: { label: "Gross profit per share", short: "Gross profit / share", color: "#67b7ff", kind: "perShare", formula: FORMULAS.grossProfitPerShare },
  operatingIncomePerShare: { label: "Operating income per share", short: "Operating income / share", color: "#a78bfa", kind: "perShare", formula: FORMULAS.operatingIncomePerShare },
  netIncomePerShare: { label: "EPS · diluted", short: "EPS", color: "#f4bc56", kind: "perShare", formula: FORMULAS.netIncomePerShare },
  operatingCashFlowPerShare: { label: "Operating cash flow per share", short: "OCF / share", color: "#48cbd4", kind: "perShare", formula: FORMULAS.operatingCashFlowPerShare },
  freeCashFlowPerShare: { label: "Free cash flow per share", short: "FCF / share", color: "#c8f169", kind: "perShare", formula: FORMULAS.freeCashFlowPerShare },
  shareCountChange: { label: "Share count change", short: "Share count change", color: "#fb7185", kind: "percent", formula: "Current diluted shares / previous diluted shares − 1" },
  shareCountAbsoluteChange: { label: "Absolute share-count change", short: "Share change", color: "#f43f5e", kind: "shares", formula: "Current diluted shares − previous diluted shares" },
  cumulativeDilution: { label: "Cumulative dilution", short: "Cumulative dilution", color: "#e879f9", kind: "percent", formula: "Current diluted shares / first visible diluted shares − 1" },
  stockBasedCompensationToRevenue: { label: "SBC / Revenue", short: "SBC / Revenue", color: "#f59e0b", kind: "percent", formula: "Stock-based compensation / Revenue" },
  stockBasedCompensationToFcf: { label: "SBC / FCF", short: "SBC / FCF", color: "#f97316", kind: "percent", formula: "Stock-based compensation / Free cash flow" },
  cashConversion: { label: "Cash conversion", short: "FCF / Net income", color: "#2dd4bf", kind: "percent", formula: "Free cash flow / Net income" },
};

export const VIEW_METRICS = {
  income: ["revenue", "grossProfit", "operatingIncome", "netIncome"],
  cashflow: ["operatingCashFlow", "capitalExpenditures", "freeCashFlow", "stockBasedCompensation", "shareRepurchases", "shareIssuance", "netShareRepurchases"],
  margins: ["grossMargin", "operatingMargin", "netMargin", "operatingCashFlowMargin", "freeCashFlowMargin", "cashConversion"],
  pershare: ["revenuePerShare", "grossProfitPerShare", "operatingIncomePerShare", "netIncomePerShare", "operatingCashFlowPerShare", "freeCashFlowPerShare"],
  shares: ["dilutedShares", "basicShares", "sharesOutstanding", "sharesIssued", "treasuryShares", "shareCountAbsoluteChange", "shareCountChange", "cumulativeDilution", "shareRepurchases", "stockBasedCompensation", "shareIssuance", "netShareRepurchases", "stockBasedCompensationToRevenue", "stockBasedCompensationToFcf"],
} as const;

export const GROWTH_METRICS = [
  "revenue", "grossProfit", "operatingIncome", "netIncome", "operatingCashFlow", "freeCashFlow",
  "revenuePerShare", "grossProfitPerShare", "operatingIncomePerShare", "netIncomePerShare",
  "operatingCashFlowPerShare", "freeCashFlowPerShare", "basicShares", "dilutedShares", "sharesOutstanding",
];
