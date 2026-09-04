import { isFinancialBusiness } from "../../business-type";
import { currentDatasetPeriod } from "../../current-period";
import { cagrForPeriods } from "../../finance";
import type { CompanyDataset, CompanyProfile, FinancialPeriod } from "../../types";
import { financialSeries, financialValue, type V1Metric } from "./metrics";
import type { V1CompanyIdentity, V1FinancialSeries, V1FinancialValue } from "./contracts";

export interface V1SearchItem extends V1CompanyIdentity {
  regulatoryId: string;
}

export interface V1SearchData {
  query: string;
  results: V1SearchItem[];
  nextCursor: string | null;
}

export interface V1CompanySummaryData {
  company: V1CompanyIdentity;
  latestPeriod: {
    label: string;
    periodStart: string | null;
    periodEnd: string;
    fiscalYear: number;
    fiscalQuarter: FinancialPeriod["fiscalQuarter"] | null;
    frequency: FinancialPeriod["periodicity"];
  };
  metrics: Record<string, V1FinancialValue>;
  growth: Record<"revenue5Y" | "freeCashFlow5Y" | "freeCashFlowPerShare5Y", V1GrowthValue>;
}

export interface V1GrowthValue {
  value: number | null;
  unit: "percent";
  frequency: "annual";
  status: "calculated" | "unavailable";
  startDate: string | null;
  endDate: string | null;
  years: number;
}

export interface V1FundamentalsData {
  company: Pick<V1CompanyIdentity, "ticker" | "name">;
  series: V1FinancialSeries[];
}

export function companyIdentity(profile: CompanyProfile): V1CompanyIdentity {
  return {
    ticker: profile.ticker,
    name: profile.name,
    cik: profile.cik,
    exchange: profile.exchange,
    sector: profile.sector,
    currency: profile.currency,
    businessType: profile.businessType ?? null,
    description: profile.description,
    resolutionStatus: profile.resolutionStatus ?? "partial",
  };
}

export function searchItem(profile: CompanyProfile): V1SearchItem {
  return { ...companyIdentity(profile), regulatoryId: profile.regulatoryId ?? (profile.cik ? `CIK ${profile.cik}` : "") };
}

export function companySummary(dataset: CompanyDataset): V1CompanySummaryData | null {
  const latest = currentDatasetPeriod(dataset);
  if (!latest) return null;
  const annual = dataset.periods.filter((period) => period.periodicity === "annual");
  const financial = isFinancialBusiness(dataset.company.businessType);
  const metricKeys: V1Metric[] = [
    "revenue", "grossProfit", "operatingIncome", "netIncome", "eps", "fcf", "fcfPerShare",
    "grossMargin", "operatingMargin", "netMargin", "fcfMargin", "sharesOutstanding", "cash", "totalDebt", "netDebt", "roic", "cashReturnOnCapital",
  ];
  const unavailableForFinancials = new Set<V1Metric>(["fcf", "fcfPerShare", "fcfMargin", "netDebt", "roic", "cashReturnOnCapital"]);
  const metrics = Object.fromEntries(metricKeys.map((metric) => {
    const result = financialValue(latest, metric);
    return [metric, financial && unavailableForFinancials.has(metric) ? { ...result, value: null, status: "unavailable" as const } : result];
  }));
  const growthValue = (result: ReturnType<typeof cagrForPeriods>, unavailable = false): V1GrowthValue => ({
    value: unavailable ? null : result.value,
    unit: "percent",
    frequency: "annual",
    status: unavailable || result.value == null ? "unavailable" : "calculated",
    startDate: result.startDate || null,
    endDate: result.endDate || null,
    years: result.years,
  });
  const revenueGrowth = cagrForPeriods(annual, "revenue", 5);
  const freeCashFlowGrowth = cagrForPeriods(annual, "freeCashFlow", 5);
  const freeCashFlowPerShareGrowth = cagrForPeriods(annual, "freeCashFlowPerShare", 5);
  return {
    company: companyIdentity(dataset.company),
    latestPeriod: {
      label: latest.label,
      periodStart: latest.periodStart ?? null,
      periodEnd: latest.periodEnd,
      fiscalYear: latest.fiscalYear,
      fiscalQuarter: latest.fiscalQuarter ?? null,
      frequency: latest.periodicity,
    },
    metrics,
    growth: {
      revenue5Y: growthValue(revenueGrowth),
      freeCashFlow5Y: growthValue(freeCashFlowGrowth, financial),
      freeCashFlowPerShare5Y: growthValue(freeCashFlowPerShareGrowth, financial),
    },
  };
}

export function companyFundamentals(
  dataset: CompanyDataset,
  metrics: V1Metric[],
  frequency: FinancialPeriod["periodicity"],
): V1FundamentalsData {
  return {
    company: { ticker: dataset.company.ticker, name: dataset.company.name },
    series: metrics.map((metric) => financialSeries(dataset.periods, metric, frequency)),
  };
}
