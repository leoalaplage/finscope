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
  | "shareRepurchases"
  | "shareIssuance";

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
  provenance: Provenance;
}

export interface FinancialPeriod {
  label: string;
  fiscalYear: number;
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
}

export interface CompanyDataset {
  company: CompanyProfile;
  periods: FinancialPeriod[];
  retrievedAt: string;
  warnings: string[];
}

export interface PricePoint {
  close: number;
  date: string;
  currency: string;
  ticker: string;
  type: "fiscal-period close" | "current market price" | "period average";
  sourceUrl: string;
}
