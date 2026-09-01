import { derivedValue } from "./finance";
import { METRIC_DEPENDENCIES, validationForMetric } from "./data-quality";
import { isFinancialBusiness } from "./business-type";
import type { CompanyDataset, MetricKey, Periodicity } from "./types";

export type CoverageStatus = "Available" | "Calculated" | "Partially available" | "Unavailable";
export type AuditStatus = "Available" | "Calculated" | "Partially available" | "Missing from source" | "Missing mapping" | "Missing dependency" | "Insufficient history" | "Validation failed" | "Source conflict" | "Not economically applicable";
export interface MetricAudit { metric: string; periodicity: Periodicity; status: AuditStatus; reason: string; firstPeriod: string | null; lastPeriod: string | null; available: number; total: number; internalGaps: number; leadingMissing: number; trailingMissing: number }
export interface CoverageCell { status: CoverageStatus; source: string; latestPeriod: string; reason?: string; attemptedAt?: string }
export const COVERAGE_METRICS = ["revenue","grossProfit","operatingIncome","netIncome","operatingCashFlow","capitalExpenditures","freeCashFlow","freeCashFlowMargin","revenuePerShare","freeCashFlowPerShare","basicShares","dilutedShares","sharesOutstanding","shareRepurchases","stockBasedCompensation","cashAndEquivalents","totalDebt"] as const;
const FINANCIAL_NOT_APPLICABLE = new Set(["freeCashFlow","freeCashFlowMargin","freeCashFlowPerShare","freeCashFlowAfterSbc","freeCashFlowAfterSbcPerShare","cashReturnOnCapital","roic","fcff"]);

function missingShape<T>(items: T[], has: (item: T) => boolean) {
  const first = items.findIndex(has);
  const fromEnd = [...items].reverse().findIndex(has);
  if (first < 0 || fromEnd < 0) return { internalGaps: 0, leadingMissing: items.length, trailingMissing: 0 };
  const last = items.length - 1 - fromEnd;
  return {
    leadingMissing: first,
    trailingMissing: items.length - 1 - last,
    internalGaps: items.slice(first, last + 1).filter((item) => !has(item)).length,
  };
}

export function buildCoverage(dataset: CompanyDataset, periodicity: Periodicity = "annual") {
  const periods=dataset.periods.filter((period)=>period.periodicity===periodicity).sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd));
  return Object.fromEntries(COVERAGE_METRICS.map((metric)=>{if(isFinancialBusiness(dataset.company.businessType)&&FINANCIAL_NOT_APPLICABLE.has(metric))return [metric,{status:"Unavailable",source:"—",latestPeriod:"—",reason:"Not economically applicable to a financial institution",attemptedAt:dataset.retrievedAt} satisfies CoverageCell];const withValue=periods.filter((period)=>derivedValue(period,metric)!=null);const latest=withValue.at(-1);if(!latest)return [metric,{status:"Unavailable",source:"—",latestPeriod:"—",reason:`No compatible standardized ${periodicity} fact`,attemptedAt:dataset.retrievedAt} satisfies CoverageCell];const fact=latest.facts[metric as MetricKey];const shape=missingShape(periods,(period)=>derivedValue(period,metric)!=null);const status:CoverageStatus=withValue.length<periods.length?"Partially available":fact?.provenance.status==="calculated"||!fact?"Calculated":"Available";const reason=status==="Partially available"?`${withValue.length}/${periods.length} periods · ${shape.internalGaps} internal gaps · ${shape.trailingMissing} trailing`:undefined;return [metric,{status,source:fact?.provenance.provider??"Calculated",latestPeriod:latest.periodEnd,reason,attemptedAt:dataset.retrievedAt} satisfies CoverageCell]}));
}

export function auditMetric(dataset: CompanyDataset, metric: string, periodicity: Periodicity): MetricAudit {
  const periods=dataset.periods.filter((period)=>period.periodicity===periodicity).sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd));
  const empty={internalGaps:0,leadingMissing:0,trailingMissing:0};
  if(!periods.length)return {metric,periodicity,status:"Insufficient history",reason:`No validated ${periodicity} periods could be constructed.`,firstPeriod:null,lastPeriod:null,available:0,total:0,...empty};
  if(isFinancialBusiness(dataset.company.businessType)&&FINANCIAL_NOT_APPLICABLE.has(metric))return {metric,periodicity,status:"Not economically applicable",reason:"Free-cash-flow and industrial return-on-capital measures are withheld for financial institutions; customer and clearing balances make the arithmetic economically misleading.",firstPeriod:null,lastPeriod:null,available:0,total:periods.length,...empty};
  const usable=periods.filter((period)=>derivedValue(period,metric)!=null); const first=usable[0]?.periodEnd??null; const last=usable.at(-1)?.periodEnd??null;
  const shape=missingShape(periods,(period)=>derivedValue(period,metric)!=null);
  const states=periods.map((period)=>validationForMetric(period,metric));
  if(states.some((state)=>state.status==="Confirmed invalid"))return {metric,periodicity,status:"Validation failed",reason:states.find((state)=>state.status==="Confirmed invalid")!.reason??"Confirmed invalid observation",firstPeriod:first,lastPeriod:last,available:usable.length,total:periods.length,...shape};
  if(states.some((state)=>state.status==="Source conflict"))return {metric,periodicity,status:"Source conflict",reason:states.find((state)=>state.status==="Source conflict")!.reason??"Conflicting source observations",firstPeriod:first,lastPeriod:last,available:usable.length,total:periods.length,...shape};
  if(!usable.length){const dependencies=METRIC_DEPENDENCIES[metric];const reason=dependencies?`Missing dependency: ${dependencies.filter((key)=>periods.every((period)=>period.facts[key]?.value==null)).join(", ")||dependencies.join(", ")}.`:`No standardized concept mapping or supported formula for ${metric}.`;return {metric,periodicity,status:dependencies?"Missing dependency":"Missing mapping",reason,firstPeriod:null,lastPeriod:null,available:0,total:periods.length,...shape}}
  const direct=usable.some((period)=>period.facts[metric as MetricKey]); const status:AuditStatus=usable.length<periods.length?"Partially available":direct?"Available":"Calculated"; const reason=usable.length===periods.length?`${usable.length}/${periods.length} periods validated.`:`${usable.length}/${periods.length} periods · ${shape.internalGaps} internal gaps · ${shape.leadingMissing} before first · ${shape.trailingMissing} after last.`; return {metric,periodicity,status,reason,firstPeriod:first,lastPeriod:last,available:usable.length,total:periods.length,...shape};
}
