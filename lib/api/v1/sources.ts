import { METRIC_DEPENDENCIES, validationForMetric } from "../../data-quality";
import { FORMULAS } from "../../finance";
import type { CompanyDataset, MetricKey, Provenance } from "../../types";
import { V1_METRICS, type V1Metric } from "./metrics";

export interface V1SourceItem {
  metric: string;
  dependency: string;
  periodStart: string | null;
  periodEnd: string;
  provider: Provenance["provider"];
  sourceUrl: string;
  accession: string | null;
  filingDate: string | null;
  concept: string;
  status: Provenance["status"];
  formula: string | null;
  note: string | null;
}

export interface V1SourcesData {
  ticker: string;
  metric: V1Metric;
  period: string;
  validation: { status: string; reason: string | null };
  sources: V1SourceItem[];
}

export function companySources(dataset: CompanyDataset, metric: V1Metric, askedPeriod?: string | null): V1SourcesData | null {
  const internal = V1_METRICS[metric];
  const periods = dataset.periods.filter((period) => !askedPeriod || period.periodEnd === askedPeriod || period.label === askedPeriod);
  const period = periods.sort((left, right) => right.periodEnd.localeCompare(left.periodEnd))[0];
  if (!period) return null;
  const dependencies = period.facts[internal as MetricKey]
    ? [internal as MetricKey]
    : internal === "grossProfit"
      ? (["revenue", "costOfRevenue"] as MetricKey[])
      : METRIC_DEPENDENCIES[internal] ?? [internal as MetricKey];
  const sources = dependencies.flatMap((dependency): V1SourceItem[] => {
    const fact = period.facts[dependency];
    if (!fact) return [];
    return [{
      metric,
      dependency,
      periodStart: fact.periodStart ?? null,
      periodEnd: fact.periodEnd,
      provider: fact.provenance.provider,
      sourceUrl: fact.provenance.sourceUrl,
      accession: fact.provenance.accession ?? null,
      filingDate: fact.provenance.filingDate ?? null,
      concept: fact.provenance.concept,
      status: fact.provenance.status,
      formula: fact.provenance.formula ?? (FORMULAS[internal as keyof typeof FORMULAS] ?? null),
      note: fact.provenance.note ?? null,
    }];
  });
  const validation = validationForMetric(period, internal);
  return {
    ticker: dataset.company.ticker,
    metric,
    period: period.periodEnd,
    validation: { status: validation.status, reason: validation.reason ?? null },
    sources,
  };
}

