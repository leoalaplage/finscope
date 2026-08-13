import { derivedValue } from "./finance";
import type { CompanyDataset, MetricKey, Periodicity } from "./types";

export type CoverageStatus = "Available" | "Calculated" | "Partially available" | "Unavailable";
export interface CoverageCell { status: CoverageStatus; source: string; latestPeriod: string; reason?: string; attemptedAt?: string }
export const COVERAGE_METRICS = ["revenue","grossProfit","operatingIncome","netIncome","operatingCashFlow","capitalExpenditures","freeCashFlow","freeCashFlowMargin","revenuePerShare","freeCashFlowPerShare","basicShares","dilutedShares","sharesOutstanding","shareRepurchases","stockBasedCompensation","cashAndEquivalents","totalDebt"] as const;

export function buildCoverage(dataset: CompanyDataset, periodicity: Periodicity = "annual") {
  const periods=dataset.periods.filter((period)=>period.periodicity===periodicity).sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd));
  return Object.fromEntries(COVERAGE_METRICS.map((metric)=>{const withValue=periods.filter((period)=>derivedValue(period,metric)!=null);const latest=withValue.at(-1);if(!latest)return [metric,{status:"Unavailable",source:"—",latestPeriod:"—",reason:`No compatible standardized ${periodicity} fact`,attemptedAt:dataset.retrievedAt} satisfies CoverageCell];const fact=latest.facts[metric as MetricKey];const status:CoverageStatus=fact?.provenance.status==="calculated"||!fact?"Calculated":withValue.length<Math.max(3,periods.length*.6)?"Partially available":"Available";return [metric,{status,source:fact?.provenance.provider??"Calculated",latestPeriod:latest.periodEnd,reason:status==="Partially available"?`${withValue.length}/${periods.length} periods`:undefined,attemptedAt:dataset.retrievedAt} satisfies CoverageCell]}));
}
