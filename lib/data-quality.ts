import { derivedValue } from "./finance";
import { runDatasetInvariants } from "./accounting-invariants";
import type { CompanyDataset, DataQualityIssue, FinancialPeriod, MetricKey, NormalizedFact, Periodicity, ValidationInfo, ValidationStatus } from "./types";

export const METRIC_DEPENDENCIES: Record<string, MetricKey[]> = {
  freeCashFlow: ["operatingCashFlow", "capitalExpenditures"],
  freeCashFlowAfterSbc: ["operatingCashFlow", "capitalExpenditures", "stockBasedCompensation"],
  freeCashFlowAfterSbcPerShare: ["operatingCashFlow", "capitalExpenditures", "stockBasedCompensation", "dilutedShares"],
  freeCashFlowAfterSbcMargin: ["operatingCashFlow", "capitalExpenditures", "stockBasedCompensation", "revenue"],
  grossMargin: ["grossProfit", "revenue"], operatingMargin: ["operatingIncome", "revenue"], netMargin: ["netIncome", "revenue"],
  operatingCashFlowMargin: ["operatingCashFlow", "revenue"], freeCashFlowMargin: ["operatingCashFlow", "capitalExpenditures", "revenue"],
  revenuePerShare: ["revenue", "dilutedShares"], grossProfitPerShare: ["grossProfit", "dilutedShares"],
  operatingIncomePerShare: ["operatingIncome", "dilutedShares"], netIncomePerShare: ["netIncome", "dilutedShares"],
  operatingCashFlowPerShare: ["operatingCashFlow", "dilutedShares"], freeCashFlowPerShare: ["operatingCashFlow", "capitalExpenditures", "dilutedShares"],
  stockBasedCompensationToRevenue: ["stockBasedCompensation", "revenue"], stockBasedCompensationToFcf: ["stockBasedCompensation", "operatingCashFlow", "capitalExpenditures"],
  cashConversion: ["operatingCashFlow", "capitalExpenditures", "netIncome"], effectiveTaxRate: ["incomeTaxExpense", "incomeBeforeTax"],
  netDebt: ["totalDebt", "cashAndEquivalents"], netWorkingCapital: ["currentAssets", "currentLiabilities", "cashAndEquivalents"],
};

const INVALID: ValidationStatus[] = ["Confirmed invalid"];

function defaultValidation(fact: NormalizedFact, checkedAt: string): ValidationInfo {
  if (fact.value == null || !Number.isFinite(fact.value)) return { status: "Confirmed invalid", reason: "Value is null or non-finite.", rawValue: fact.value, normalizedValue: null, checkedAt };
  if (fact.provenance.status === "calculated") return { status: "Calculated and verified", reason: fact.provenance.formula, rawValue: fact.value, normalizedValue: fact.value, checkedAt };
  if (fact.provenance.status === "restated") return { status: "Restated", reason: fact.provenance.note, rawValue: fact.value, normalizedValue: fact.value, checkedAt };
  return { status: "Verified", reason: "Finite standardized filing fact with traceable provenance.", rawValue: fact.value, normalizedValue: fact.value, checkedAt };
}

export function validationForMetric(period: FinancialPeriod, metric: string): ValidationInfo {
  const checkedAt = period.facts.revenue?.provenance.retrievedAt ?? new Date(0).toISOString();
  const direct = period.facts[metric as MetricKey];
  if (direct) return direct.validation ?? defaultValidation(direct, checkedAt);
  const dependencies = METRIC_DEPENDENCIES[metric];
  if (!dependencies) return { status: derivedValue(period, metric) == null ? "Missing" : "Calculated and verified", reason: derivedValue(period, metric) == null ? "No mapped fact or supported formula." : "Derived from validated dependencies.", checkedAt };
  const missing = dependencies.filter((key) => period.facts[key]?.value == null);
  if (missing.length) return { status: "Missing", reason: `Missing ${missing.join(", ")}.`, checkedAt };
  const invalid = dependencies.find((key) => INVALID.includes(period.facts[key]?.validation?.status ?? "Verified"));
  if (invalid) return { status: "Confirmed invalid", reason: `Dependency ${invalid} is confirmed invalid.`, checkedAt };
  const conflict = dependencies.find((key) => period.facts[key]?.validation?.status === "Source conflict");
  return { status: conflict ? "Source conflict" : "Calculated and verified", reason: conflict ? `Calculated with normalized ${conflict}; inspect its source conflict.` : "Formula and dependencies verified.", normalizedValue: derivedValue(period, metric), checkedAt };
}

export function validatedDerivedValue(period: FinancialPeriod, metric: string, mode: "validated" | "raw" = "validated") {
  const value = derivedValue(period, metric);
  if (mode === "raw") return value;
  return validationForMetric(period, metric).status === "Confirmed invalid" ? null : value;
}

function issueForFact(ticker: string, period: FinancialPeriod, metric: string, fact: NormalizedFact): DataQualityIssue | null {
  const validation = fact.validation;
  const normalizationChanged = validation?.rawValue != null && validation.normalizedValue != null && validation.rawValue !== validation.normalizedValue;
  if (!validation || (["Verified", "Calculated and verified", "Restated"].includes(validation.status) && !normalizationChanged)) return null;
  return {
    id: `${ticker}-${period.periodicity}-${period.periodEnd}-${metric}`, ticker, metric, period: period.periodEnd,
    rawValue: validation.rawValue ?? fact.value, normalizedValue: validation.normalizedValue ?? fact.value, status: validation.status,
    cause: validation.reason ?? "Validation exception", sourceUrl: fact.provenance.sourceUrl,
    action: validation.correction ?? (validation.status === "Suspected anomaly" ? "Retained and marked for review." : "Retained with explicit validation state."), detectedAt: validation.checkedAt,
  };
}

export function validateCompanyDataset(dataset: CompanyDataset): CompanyDataset {
  const checkedAt = dataset.retrievedAt;
  const periods = dataset.periods.map((period) => ({ ...period, facts: Object.fromEntries(Object.entries(period.facts).map(([metric, fact]) => {
    if (!fact) return [metric, fact];
    return [metric, { ...fact, validation: fact.validation ?? defaultValidation(fact, checkedAt) }];
  })) as FinancialPeriod["facts"] }));

  // Share counts should move gradually outside disclosed splits. Extreme values
  // remain visible but are explicitly marked instead of being silently removed.
  for (const periodicity of ["annual", "quarterly", "ttm"] as Periodicity[]) {
    const ordered = periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    for (const metric of ["basicShares", "dilutedShares", "sharesOutstanding"] as MetricKey[]) {
      for (let index = 1; index < ordered.length; index++) {
        const previous = ordered[index - 1].facts[metric]; const current = ordered[index].facts[metric];
        if (!previous?.value || !current?.value || current.validation?.status === "Source conflict") continue;
        const ratio = current.value / previous.value;
        if (ratio > 50 || ratio < 0.02) current.validation = { ...current.validation!, status: "Suspected anomaly", reason: `Share count changed by a factor of ${ratio.toPrecision(4)} versus the prior period without a matched normalization rule.`, rawValue: current.value, normalizedValue: current.value, correction: "Value retained; verify units, filing context and split history.", checkedAt };
      }
    }
  }
  const issues = periods.flatMap((period) => Object.entries(period.facts).map(([metric, fact]) => fact ? issueForFact(dataset.company.ticker, period, metric, fact) : null).filter((issue): issue is DataQualityIssue => issue !== null));
  const coverage = (["annual", "quarterly", "ttm"] as Periodicity[]).map((periodicity) => { const items = periods.filter((period) => period.periodicity === periodicity).sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd)); return { periodicity, firstPeriod: items[0]?.periodEnd ?? null, lastPeriod: items.at(-1)?.periodEnd ?? null, periodCount: items.length }; });
  const normalizedDataset={...dataset,periods};
  return { ...normalizedDataset, quality: { issues, invariants:runDatasetInvariants(normalizedDataset), coverage, stockSplits: dataset.company.stockSplits ?? [], lastValidatedAt: checkedAt } };
}
