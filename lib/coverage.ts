import { derivedValue } from "./finance";
import { METRIC_DEPENDENCIES, validationForMetric } from "./data-quality";
import type { CompanyDataset, MetricKey, Periodicity } from "./types";

export type CoverageStatus = "Available" | "Calculated" | "Partially available" | "Unavailable";
export type AuditStatus = "Available" | "Calculated" | "Missing from source" | "Missing mapping" | "Missing dependency" | "Insufficient history" | "Validation failed" | "Source conflict" | "Not economically applicable";
export interface MetricAudit { metric: string; periodicity: Periodicity; status: AuditStatus; reason: string; firstPeriod: string | null; lastPeriod: string | null; available: number; total: number }
export interface CoverageCell { status: CoverageStatus; source: string; latestPeriod: string; reason?: string; attemptedAt?: string }
export const COVERAGE_METRICS = ["revenue","grossProfit","operatingIncome","netIncome","operatingCashFlow","capitalExpenditures","freeCashFlow","freeCashFlowMargin","revenuePerShare","freeCashFlowPerShare","basicShares","dilutedShares","sharesOutstanding","shareRepurchases","stockBasedCompensation","cashAndEquivalents","totalDebt"] as const;

export function buildCoverage(dataset: CompanyDataset, periodicity: Periodicity = "annual") {
  const periods=dataset.periods.filter((period)=>period.periodicity===periodicity).sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd));
  return Object.fromEntries(COVERAGE_METRICS.map((metric)=>{const withValue=periods.filter((period)=>derivedValue(period,metric)!=null);const latest=withValue.at(-1);if(!latest)return [metric,{status:"Unavailable",source:"—",latestPeriod:"—",reason:`No compatible standardized ${periodicity} fact`,attemptedAt:dataset.retrievedAt} satisfies CoverageCell];const fact=latest.facts[metric as MetricKey];const status:CoverageStatus=fact?.provenance.status==="calculated"||!fact?"Calculated":withValue.length<Math.max(3,periods.length*.6)?"Partially available":"Available";return [metric,{status,source:fact?.provenance.provider??"Calculated",latestPeriod:latest.periodEnd,reason:status==="Partially available"?`${withValue.length}/${periods.length} periods`:undefined,attemptedAt:dataset.retrievedAt} satisfies CoverageCell]}));
}

export function auditMetric(dataset: CompanyDataset, metric: string, periodicity: Periodicity): MetricAudit {
  const periods=dataset.periods.filter((period)=>period.periodicity===periodicity).sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd));
  if(!periods.length)return {metric,periodicity,status:"Insufficient history",reason:`No validated ${periodicity} periods could be constructed.`,firstPeriod:null,lastPeriod:null,available:0,total:0};
  const usable=periods.filter((period)=>derivedValue(period,metric)!=null); const first=usable[0]?.periodEnd??null; const last=usable.at(-1)?.periodEnd??null;
  const states=periods.map((period)=>validationForMetric(period,metric));
  if(states.some((state)=>state.status==="Confirmed invalid"))return {metric,periodicity,status:"Validation failed",reason:states.find((state)=>state.status==="Confirmed invalid")!.reason??"Confirmed invalid observation",firstPeriod:first,lastPeriod:last,available:usable.length,total:periods.length};
  if(states.some((state)=>state.status==="Source conflict"))return {metric,periodicity,status:"Source conflict",reason:states.find((state)=>state.status==="Source conflict")!.reason??"Conflicting source observations",firstPeriod:first,lastPeriod:last,available:usable.length,total:periods.length};
  if(!usable.length){const dependencies=METRIC_DEPENDENCIES[metric];const reason=dependencies?`Missing dependency: ${dependencies.filter((key)=>periods.every((period)=>period.facts[key]?.value==null)).join(", ")||dependencies.join(", ")}.`:`No standardized concept mapping or supported formula for ${metric}.`;return {metric,periodicity,status:dependencies?"Missing dependency":"Missing mapping",reason,firstPeriod:null,lastPeriod:null,available:0,total:periods.length}}
  const direct=usable.some((period)=>period.facts[metric as MetricKey]); const status:AuditStatus=direct?"Available":"Calculated"; return {metric,periodicity,status,reason:usable.length===periods.length?`${usable.length}/${periods.length} periods validated.`:`${usable.length}/${periods.length} periods; unavailable periods remain explicit gaps.`,firstPeriod:first,lastPeriod:last,available:usable.length,total:periods.length};
}
