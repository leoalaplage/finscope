export type Periodicity = "annual" | "quarterly" | "ttm";
export type FactStatus = "reported" | "restated" | "calculated" | "unavailable";
export type ValidationStatus = "Verified" | "Calculated and verified" | "Suspected anomaly" | "Confirmed invalid" | "Missing" | "Restated" | "Source conflict" | "Verified outlier";

export interface ValidationInfo {
  status: ValidationStatus;
  reason?: string;
  rawValue?: number | null;
  normalizedValue?: number | null;
  correction?: string;
  checkedAt: string;
}

export interface DataQualityIssue {
  id: string;
  ticker: string;
  metric: string;
  period: string;
  rawValue: number | null;
  normalizedValue: number | null;
  status: ValidationStatus;
  cause: string;
  sourceUrl: string;
  action: string;
  detectedAt: string;
}

export type MetricKey =
  | "revenue"
  | "grossProfit"
  | "costOfRevenue"
  | "operatingIncome"
  | "netIncome"
  | "operatingCashFlow"
  | "capitalExpenditures"
  | "acquisitions"
  | "dividendsPaid"
  | "freeCashFlow"
  | "dilutedShares"
  | "basicShares"
  | "sharesOutstanding"
  | "sharesIssued"
  | "treasuryShares"
  | "stockBasedCompensation"
  | "shareRepurchases"
  | "shareIssuance"
  | "netShareRepurchases"
  | "cashAndEquivalents"
  | "totalDebt"
  | "currentAssets"
  | "currentLiabilities"
  | "incomeBeforeTax"
  | "incomeTaxExpense"
  | "depreciationAndAmortization"
  | "dilutedEpsReported";

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
  validation?: ValidationInfo;
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
  regulatoryId?: string;
  businessType?: "operating" | "financial" | "international";
  resolutionStatus?: "verified" | "partial" | "unresolved";
  resolutionNote?: string;
}

export interface CompanyDataset {
  company: CompanyProfile;
  periods: FinancialPeriod[];
  retrievedAt: string;
  warnings: string[];
  quality?: {
    issues: DataQualityIssue[];
    invariants?: AccountingInvariantResult[];
    coverage: Array<{ periodicity: Periodicity; firstPeriod: string | null; lastPeriod: string | null; periodCount: number }>;
    stockSplits: Array<{ date: string; ratio: number }>;
    lastValidatedAt: string;
  };
}

export interface AccountingInvariantResult {
  id: string;
  ticker: string;
  metric: string;
  period: string;
  invariant: string;
  observed: number | null;
  recalculated: number | null;
  absoluteDifference: number | null;
  relativeDifference: number | null;
  sources: string[];
  probableCause: string;
  severity: "info" | "warning" | "error";
  status: "passed" | "failed" | "not-applicable";
}

export interface PricePoint {
  /** Legacy selected price. Kept for API compatibility; now always the split-adjusted price close. */
  close: number;
  /** Yahoo chart close: adjusted for stock splits, but not cash dividends. */
  priceClose?: number;
  /** Total-return proxy: adjusted for splits and cash distributions when supplied by the provider. */
  totalReturnClose?: number | null;
  adjustedClose: number | null;
  date: string;
  requestedDate: string;
  currency: string;
  ticker: string;
  type: "split-adjusted close" | "total-return adjusted close" | "close" | "adjusted close";
  fallback: "exact date" | "previous trading session" | "next trading session";
  distanceDays: number;
  sourceUrl: string;
}

export type MarketFrequency = "daily" | "weekly" | "monthly" | "quarterly" | "annual";
export type SeriesFrequency = "daily" | "weekly" | "monthly" | "market-quarterly" | "market-annual" | Periodicity;
export type TimeAlignment = "fiscal-period" | "as-reported";
export type MissingDataMode = "report-points" | "step-until-next-report";

export interface SeriesObservation {
  date: string;
  value: number | null;
  fiscalPeriodEnd?: string;
  filingDate?: string;
  frequency: SeriesFrequency;
  currency: string;
  unit: string;
  source: string;
  sourceUrl?: string;
  status: ValidationStatus | FactStatus | "Market data";
  rawObservation: true;
}

export interface MarketBar {
  date: string;
  periodStart: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adjustedClose: number | null;
  volume: number | null;
  currency: string;
  ticker: string;
  frequency: MarketFrequency;
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
  sourceConflictValues?: number[];
  normalizationNote?: string;
}
