export type Periodicity = "annual" | "quarterly" | "ttm";
export type FactStatus = "reported" | "restated" | "calculated" | "unavailable";

export type MetricKey =
  | "revenue"
  | "grossProfit"
  | "operatingIncome"
  | "netIncome"
  | "operatingCashFlow"
  | "capitalExpenditures"
  | "freeCashFlow"
  | "dilutedShares"
  | "basicShares"
  | "sharesOutstanding"
  | "sharesIssued"
  | "treasuryShares"
  | "stockBasedCompensation"
  | "shareRepurchases"
  | "shareIssuance"
  | "netShareRepurchases";

export interface Provenance {
  provider: "SEC" | "Yahoo Finance" | "Calculated" | "Demo fixture";
  sourceUrl: string;
  accession?: string;
  filingDate?: string;
  retrievedAt: string;
  concept: string;
  status: FactStatus;
  formula?: string;
  note?: string;
  sourceAccessions?: string[];
}

export interface NormalizedFact {
  metric: MetricKey;
  value: number | null;
  currency: string;
  unit: "currency" | "shares";
  periodStart?: string;
  periodEnd: string;
  periodicity: Periodicity;
  fiscalYear: number;
  fiscalQuarter?: "Q1" | "Q2" | "Q3" | "Q4";
  provenance: Provenance;
}

export interface FinancialPeriod {
  label: string;
  fiscalYear: number;
  fiscalQuarter?: "Q1" | "Q2" | "Q3" | "Q4";
  durationDays?: number;
  ttmQuarterEnds?: string[];
  unavailableReason?: string;
  periodStart?: string;
  periodEnd: string;
  periodicity: Periodicity;
  filingDate: string;
  accession: string;
  currency: string;
  facts: Partial<Record<MetricKey, NormalizedFact>>;
}

export interface CompanyProfile {
  name: string;
  ticker: string;
  cik: string;
  exchange: string;
  currency: string;
  sector: string;
  description: string;
  yahooTicker?: string;
  tickerHistory?: Array<{ ticker: string; from?: string; to?: string }>;
  stockSplits?: Array<{ date: string; ratio: number }>;
}

export interface CompanyDataset {
  company: CompanyProfile;
  periods: FinancialPeriod[];
  retrievedAt: string;
  warnings: string[];
}

export interface PricePoint {
  close: number;
  adjustedClose: number | null;
  date: string;
  requestedDate: string;
  currency: string;
  ticker: string;
  type: "close" | "adjusted close";
  fallback: "exact date" | "previous trading session" | "next trading session";
  distanceDays: number;
  sourceUrl: string;
}

export interface RawFinancialFact {
  metric: MetricKey;
  value: number;
  currency: string;
  unit: "currency" | "shares";
  start?: string;
  end: string;
  filed: string;
  accession: string;
  fiscalYear: number;
  fiscalPeriod: "Q1" | "Q2" | "Q3" | "FY";
  form: "10-Q" | "10-K";
  concept: string;
  sourceUrl: string;
  retrievedAt: string;
  restated?: boolean;
}
