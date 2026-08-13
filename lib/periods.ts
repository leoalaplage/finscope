import type { FinancialPeriod, MetricKey, NormalizedFact, RawFinancialFact } from "./types";

export const FLOW_METRICS: MetricKey[] = [
  "revenue", "grossProfit", "operatingIncome", "netIncome", "operatingCashFlow",
  "capitalExpenditures", "stockBasedCompensation", "shareRepurchases", "shareIssuance",
  "incomeBeforeTax", "incomeTaxExpense", "depreciationAndAmortization",
];
export const WEIGHTED_SHARE_METRICS: MetricKey[] = ["basicShares", "dilutedShares"];
export const POINT_METRICS: MetricKey[] = ["sharesOutstanding", "sharesIssued", "treasuryShares", "cashAndEquivalents", "totalDebt", "currentAssets", "currentLiabilities"];
const SPLIT_ADJUSTED_METRICS: MetricKey[] = [...WEIGHTED_SHARE_METRICS, "sharesOutstanding", "sharesIssued", "treasuryShares"];

export function daysBetween(start?: string, end?: string) {
  if (!start || !end) return 0;
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

function latest<T extends { filed: string; end?: string }>(facts: T[]) {
  return [...facts].sort((a, b) => a.filed.localeCompare(b.filed) || (a.end ?? "").localeCompare(b.end ?? "")).at(-1);
}

export function dedupeFacts(facts: RawFinancialFact[]) {
  const groups = new Map<string, RawFinancialFact[]>();
  for (const fact of facts) {
    const key = [fact.metric, fact.start ?? "instant", fact.end, fact.fiscalYear, fact.fiscalPeriod, fact.form, fact.concept].join("|");
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  return [...groups.values()].map((group) => {
    const distinct = [...new Set(group.map((fact) => fact.value))];
    const magnitude = (value: number) => value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)));
    const buckets = new Map<number, RawFinancialFact[]>();
    for (const fact of group) {
      const key = magnitude(fact.value);
      buckets.set(key, [...(buckets.get(key) ?? []), fact]);
    }
    const ranked = [...buckets.entries()].sort((left, right) => right[0] - left[0] || right[1].length - left[1].length);
    const hasUnitConflict = ranked.length > 1 && ranked.some(([power]) => Math.abs(power - ranked[0][0]) >= 2);
    const selected = latest(hasUnitConflict ? ranked[0][1] : group)!;
    const inheritedConflicts = group.flatMap((fact)=>fact.sourceConflictValues??[]); const conflictValues=[...new Set([...distinct,...inheritedConflicts])];
    const conflict = hasUnitConflict || inheritedConflicts.length > 0;
    return {
      ...selected,
      restated: group.length > 1 && distinct.length > 1,
      sourceConflictValues: conflict ? conflictValues : undefined,
      normalizationNote: conflict ? (group.find((fact)=>fact.normalizationNote)?.normalizationNote ?? `Conflicting SEC magnitudes (${distinct.join(", ")}); selected the magnitude consistent with the SEC shares unit before split adjustment.`) : undefined,
    };
  }).sort((a, b) => a.end.localeCompare(b.end));
}

export function normalizeShareUnitScales(input: RawFinancialFact[]) {
  const shareMetrics = new Set(SPLIT_ADJUSTED_METRICS);
  const medians = new Map<MetricKey, number>();
  for (const metric of shareMetrics) {
    const powers=input.filter((fact)=>fact.metric===metric&&fact.value>0).map((fact)=>Math.log10(fact.value)).sort((a,b)=>a-b);
    if(powers.length)medians.set(metric,powers[Math.floor(powers.length/2)]);
  }
  return input.map((fact)=>{
    const median=medians.get(fact.metric); if(median==null||fact.value<=0)return fact;
    let value=fact.value; while(Math.log10(value)<median-2)value*=1000;
    if(value===fact.value)return fact;
    return {...fact,value,sourceConflictValues:[fact.value,value],normalizationNote:`SEC shares-unit inconsistency: raw ${fact.value} was ${value/fact.value}× below the company-level filing magnitude. Normalized to ${value}; raw value retained in the audit.`};
  });
}

/**
 * SEC `fy` identifies the fiscal year of the filing, not always the comparative
 * period carried inside it. Relabeling from the actual period end makes older
 * restatements compete in the same context instead of becoming duplicate years.
 */
export function relabelFiscalYears(input: RawFinancialFact[]) {
  const annualEnds = input.filter((fact) => fact.fiscalPeriod === "FY" && fact.form === "10-K").map((fact) => fact.end.slice(5));
  const fiscalEnd = [...new Set(annualEnds)].sort((left,right)=>annualEnds.filter((item)=>item===right).length-annualEnds.filter((item)=>item===left).length)[0] ?? "12-31";
  return input.map((fact) => {
    const calendarYear = Number(fact.end.slice(0,4));
    const endMonthDay = fact.end.slice(5);
    const fiscalYear = fact.fiscalPeriod === "FY" ? calendarYear : endMonthDay > fiscalEnd ? calendarYear + 1 : calendarYear;
    return { ...fact, fiscalYear };
  });
}

export function adjustPeriodsForSplits(periods: FinancialPeriod[], splits: Array<{ date: string; ratio: number }> = []) {
  return periods.map((period) => {
    const facts = { ...period.facts };
    for (const metric of SPLIT_ADJUSTED_METRICS) {
      const fact = facts[metric]; if (fact?.value == null) continue;
      // A later filing commonly restates comparative share counts for a split.
      // Only facts filed before the split still require our adjustment.
      const applicable = splits.filter((split) => period.periodEnd < split.date && (!fact.provenance.filingDate || fact.provenance.filingDate < split.date));
      const factor = applicable.reduce((product, split) => product * split.ratio, 1);
      if (factor === 1) continue;
      const value = fact.value * factor;
      facts[metric] = { ...fact, value, validation: fact.validation ? { ...fact.validation, normalizedValue: value, correction: `${fact.validation.correction ?? "Corroborated magnitude selected"}; then adjusted by the ${factor}:1 cumulative subsequent split factor.` } : fact.validation, provenance: { ...fact.provenance, provider: "Calculated", status: "calculated", formula: `Reported share count × ${factor}:1 cumulative subsequent split factor`, note: `Split-adjusted for ${applicable.map((split) => `${split.ratio}:1 on ${split.date}`).join(", ")}. Original SEC source remains linked.` } };
    }
    return { ...period, facts };
  });
}

function normalized(raw: RawFinancialFact, periodicity: "annual" | "quarterly", fiscalQuarter?: "Q1" | "Q2" | "Q3" | "Q4"): NormalizedFact {
  return {
    metric: raw.metric, value: raw.value, currency: raw.currency, unit: raw.unit,
    periodStart: raw.start, periodEnd: raw.end, periodicity, fiscalYear: raw.fiscalYear, fiscalQuarter,
    provenance: {
      provider: "SEC", sourceUrl: raw.sourceUrl, accession: raw.accession, filingDate: raw.filed,
      retrievedAt: raw.retrievedAt, concept: raw.concept, status: raw.restated ? "restated" : "reported",
      note: raw.normalizationNote ?? (raw.restated ? "Latest filing selected for a duplicated SEC context with a changed value." : "Directly reported standardized XBRL fact."),
    },
    validation: raw.sourceConflictValues ? {
      status: "Source conflict", reason: raw.normalizationNote, rawValue: raw.sourceConflictValues.find((value)=>value!==raw.value) ?? raw.value,
      normalizedValue: raw.value, correction: "Corroborated SEC magnitude selected; conflicting raw observations remain recorded in the quality audit.", checkedAt: raw.retrievedAt,
    } : undefined,
  };
}

function calculated(metric: MetricKey, value: number, current: RawFinancialFact, prior: RawFinancialFact, formula: string, quarter: "Q1" | "Q2" | "Q3" | "Q4", start: string): NormalizedFact {
  return {
    metric, value, currency: current.currency, unit: current.unit, periodStart: start,
    periodEnd: current.end, periodicity: "quarterly", fiscalYear: current.fiscalYear, fiscalQuarter: quarter,
    provenance: {
      provider: "Calculated", sourceUrl: current.sourceUrl, accession: current.accession, filingDate: current.filed,
      retrievedAt: current.retrievedAt, concept: current.concept, status: "calculated", formula,
      sourceAccessions: [...new Set([current.accession, prior.accession])],
      note: `Quarter isolated from cumulative SEC facts: ${formula}. Sources ${prior.end} and ${current.end}.`,
    },
  };
}

function contexts(facts: RawFinancialFact[], metric: MetricKey, fy: number, fp: RawFinancialFact["fiscalPeriod"]) {
  return facts.filter((fact) => fact.metric === metric && fact.fiscalYear === fy && fact.fiscalPeriod === fp);
}

function selectDirectQuarter(candidates: RawFinancialFact[]) {
  const direct = candidates.filter((fact) => {
    const days = daysBetween(fact.start, fact.end);
    return days >= 55 && days <= 125;
  });
  return latest(direct);
}

function selectCumulative(candidates: RawFinancialFact[]) {
  return latest(candidates.filter((fact) => daysBetween(fact.start, fact.end) > 125));
}

function selectAnnual(candidates: RawFinancialFact[]) {
  return latest(candidates.filter((fact) => {
    const days = daysBetween(fact.start, fact.end);
    return days >= 300 && days <= 400;
  }));
}

function quarterFact(facts: RawFinancialFact[], metric: MetricKey, fy: number, quarter: "Q1" | "Q2" | "Q3" | "Q4"): NormalizedFact | undefined {
  const fp = quarter === "Q4" ? "FY" : quarter;
  const candidates = contexts(facts, metric, fy, fp);
  // FY contexts can contain later comparative quarter facts carrying fp=FY.
  // Q4 must therefore be isolated from the full-year fact and Q3 YTD, never
  // selected merely because an FY-tagged duration happens to be ~90 days.
  const direct = quarter === "Q4" ? undefined : selectDirectQuarter(candidates);
  if (direct) return normalized(direct, "quarterly", quarter);

  if (quarter === "Q1") return undefined;
  const current = quarter === "Q4" ? selectAnnual(candidates) : selectCumulative(candidates);
  const priorFp = quarter === "Q2" ? "Q1" : quarter === "Q3" ? "Q2" : "Q3";
  const priorCandidates = contexts(facts, metric, fy, priorFp);
  const prior = quarter === "Q2" ? selectDirectQuarter(priorCandidates) : selectCumulative(priorCandidates);
  if (quarter === "Q4" && current && !prior && current.start) {
    const directQuarters = (["Q1", "Q2", "Q3"] as const).map((item) => selectDirectQuarter(contexts(facts, metric, fy, item)));
    if (directQuarters.every((fact): fact is RawFinancialFact => fact != null)) {
      const totalDays = daysBetween(current.start, current.end); const priorDays = directQuarters.reduce((sum, fact) => sum + daysBetween(fact.start, fact.end), 0); const isolatedDays = totalDays - priorDays;
      if (isolatedDays >= 55 && isolatedDays <= 125) {
        const value = WEIGHTED_SHARE_METRICS.includes(metric)
          ? (current.value * totalDays - directQuarters.reduce((sum, fact) => sum + fact.value * daysBetween(fact.start, fact.end), 0)) / isolatedDays
          : current.value - directQuarters.reduce((sum, fact) => sum + fact.value, 0);
        const start = new Date(Date.parse(directQuarters[2].end) + 86_400_000).toISOString().slice(0,10);
        return { metric, value, currency: current.currency, unit: current.unit, periodStart:start, periodEnd:current.end, periodicity:"quarterly", fiscalYear:fy, fiscalQuarter:"Q4", provenance:{provider:"Calculated",sourceUrl:current.sourceUrl,accession:current.accession,filingDate:current.filed,retrievedAt:current.retrievedAt,concept:current.concept,status:"calculated",formula:WEIGHTED_SHARE_METRICS.includes(metric)?"Q4 weighted shares = (annual weighted shares × annual days − Σ(Q1–Q3 weighted shares × quarter days)) / Q4 days":"Q4 = annual − Q1 − Q2 − Q3",sourceAccessions:[...new Set([current.accession,...directQuarters.map((fact)=>fact.accession)])],note:"Q4 isolated from the annual fact and three direct fiscal quarters; no value was imputed."} };
      }
    }
  }
  if (!current || !prior || !current.start || current.start !== prior.start || current.end <= prior.end) return undefined;
  const quarterStart = new Date(Date.parse(prior.end) + 86_400_000).toISOString().slice(0, 10);

  if (WEIGHTED_SHARE_METRICS.includes(metric)) {
    const currentDays = daysBetween(current.start, current.end);
    const priorDays = daysBetween(prior.start, prior.end);
    const isolatedDays = currentDays - priorDays;
    if (isolatedDays < 55 || isolatedDays > 125) return undefined;
    const value = (current.value * currentDays - prior.value * priorDays) / isolatedDays;
    return calculated(metric, value, current, prior, `(Cumulative weighted shares × ${currentDays} days − prior weighted shares × ${priorDays} days) / ${isolatedDays} days`, quarter, quarterStart);
  }
  return calculated(metric, current.value - prior.value, current, prior, `${quarter} = cumulative through ${quarter} − cumulative through ${priorFp}`, quarter, quarterStart);
}

function instantFact(facts: RawFinancialFact[], metric: MetricKey, fy: number, quarter: "Q1" | "Q2" | "Q3" | "Q4", end: string) {
  const fp = quarter === "Q4" ? "FY" : quarter;
  const exact = contexts(facts, metric, fy, fp).filter((fact) => fact.end === end);
  const raw = latest(exact);
  return raw ? normalized(raw, "quarterly", quarter) : undefined;
}

export function normalizeAnnualPeriods(input: RawFinancialFact[], currency: string) {
  const facts = dedupeFacts(relabelFiscalYears(normalizeShareUnitScales(input)));
  const years = [...new Set(facts.filter((fact) => fact.fiscalPeriod === "FY" && fact.form === "10-K").map((fact) => fact.fiscalYear))].sort();
  return years.map((fiscalYear): FinancialPeriod | null => {
    const annualFacts: FinancialPeriod["facts"] = {};
    let anchor: RawFinancialFact | undefined;
    for (const metric of [...FLOW_METRICS, ...WEIGHTED_SHARE_METRICS]) {
      const raw = selectAnnual(contexts(facts, metric, fiscalYear, "FY"));
      if (raw) { annualFacts[metric] = normalized(raw, "annual"); if (metric === "revenue") anchor = raw; }
    }
    if (!anchor) return null;
    for (const metric of POINT_METRICS) {
      const raw = latest(contexts(facts, metric, fiscalYear, "FY").filter((fact) => fact.end === anchor!.end));
      if (raw) annualFacts[metric] = normalized(raw, "annual");
    }
    if (annualFacts.shareRepurchases || annualFacts.shareIssuance) {
      const buybacks = annualFacts.shareRepurchases?.value ?? 0;
      const issuance = annualFacts.shareIssuance?.value ?? 0;
      annualFacts.netShareRepurchases = {
        metric: "netShareRepurchases", value: buybacks - issuance, currency, unit: "currency", periodStart: anchor.start,
        periodEnd: anchor.end, periodicity: "annual", fiscalYear,
        provenance: { provider: "Calculated", sourceUrl: anchor.sourceUrl, retrievedAt: anchor.retrievedAt, concept: "NetShareRepurchases", status: "calculated", formula: "Gross repurchases − stock issuance proceeds", note: "Cash-flow measure; not inferred from share-count change." },
      };
    }
    return { label: `FY ${fiscalYear}`, fiscalYear, periodStart: anchor.start, periodEnd: anchor.end, periodicity: "annual", filingDate: anchor.filed, accession: anchor.accession, currency, durationDays: daysBetween(anchor.start, anchor.end), facts: annualFacts };
  }).filter((period): period is FinancialPeriod => period !== null);
}

export function normalizeQuarterlyPeriods(input: RawFinancialFact[], currency: string) {
  const facts = dedupeFacts(relabelFiscalYears(normalizeShareUnitScales(input)));
  const years = [...new Set(facts.filter((fact) => fact.form === "10-Q" || fact.form === "10-K").map((fact) => fact.fiscalYear))].sort();
  const periods: FinancialPeriod[] = [];
  for (const fiscalYear of years) {
    for (const quarter of ["Q1", "Q2", "Q3", "Q4"] as const) {
      const revenue = quarterFact(facts, "revenue", fiscalYear, quarter);
      if (!revenue?.periodStart) continue;
      const periodFacts: FinancialPeriod["facts"] = { revenue };
      for (const metric of [...FLOW_METRICS, ...WEIGHTED_SHARE_METRICS]) {
        if (metric === "revenue") continue;
        const fact = quarterFact(facts, metric, fiscalYear, quarter);
        if (fact) periodFacts[metric] = fact;
      }
      for (const metric of POINT_METRICS) {
        const fact = instantFact(facts, metric, fiscalYear, quarter, revenue.periodEnd);
        if (fact) periodFacts[metric] = fact;
      }
      if (periodFacts.shareRepurchases || periodFacts.shareIssuance) {
        periodFacts.netShareRepurchases = {
          metric: "netShareRepurchases", value: (periodFacts.shareRepurchases?.value ?? 0) - (periodFacts.shareIssuance?.value ?? 0),
          currency, unit: "currency", periodStart: revenue.periodStart, periodEnd: revenue.periodEnd, periodicity: "quarterly", fiscalYear, fiscalQuarter: quarter,
          provenance: { provider: "Calculated", sourceUrl: revenue.provenance.sourceUrl, retrievedAt: revenue.provenance.retrievedAt, concept: "NetShareRepurchases", status: "calculated", formula: "Gross repurchases − issuance proceeds", note: "Cash-flow measure, distinct from the change in shares outstanding." },
        };
      }
      periods.push({ label: `${quarter} FY${fiscalYear}`, fiscalYear, fiscalQuarter: quarter, periodStart: revenue.periodStart, periodEnd: revenue.periodEnd, periodicity: "quarterly", filingDate: revenue.provenance.filingDate ?? "", accession: revenue.provenance.accession ?? "", currency, durationDays: daysBetween(revenue.periodStart, revenue.periodEnd), facts: periodFacts });
    }
  }
  return periods.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

function consecutive(window: FinancialPeriod[]) {
  if (window.length !== 4 || window.some((period) => !period.periodStart || period.durationDays == null || period.durationDays < 55 || period.durationDays > 125)) return false;
  for (let index = 1; index < window.length; index++) {
    const gap = daysBetween(window[index - 1].periodEnd, window[index].periodStart) - 2;
    if (Math.abs(gap) > 7) return false;
  }
  const total = window.reduce((sum, period) => sum + (period.durationDays ?? 0), 0);
  return total >= 330 && total <= 380;
}

export function buildTtmPeriods(quarters: FinancialPeriod[], currency: string) {
  const ordered = [...quarters].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const periods: FinancialPeriod[] = [];
  for (let index = 3; index < ordered.length; index++) {
    const window = ordered.slice(index - 3, index + 1);
    if (!consecutive(window)) continue;
    const latestQuarter = window[3];
    const facts: FinancialPeriod["facts"] = {};
    for (const metric of FLOW_METRICS) {
      const sourceFacts = window.map((period) => period.facts[metric]);
      if (sourceFacts.some((fact) => fact?.value == null)) continue;
      const value = sourceFacts.reduce((sum, fact) => sum + (fact!.value ?? 0), 0);
      facts[metric] = {
        metric, value, currency, unit: sourceFacts[0]!.unit, periodStart: window[0].periodStart,
        periodEnd: latestQuarter.periodEnd, periodicity: "ttm", fiscalYear: latestQuarter.fiscalYear, fiscalQuarter: latestQuarter.fiscalQuarter,
        provenance: { provider: "Calculated", sourceUrl: sourceFacts[3]!.provenance.sourceUrl, retrievedAt: sourceFacts[3]!.provenance.retrievedAt, concept: sourceFacts[3]!.provenance.concept, status: "calculated", formula: "Sum of four consecutive fiscal quarters", sourceAccessions: sourceFacts.flatMap((fact) => fact!.provenance.sourceAccessions ?? [fact!.provenance.accession ?? ""]).filter(Boolean), note: `TTM quarters: ${window.map((period) => period.label).join(", ")}.` },
      };
    }
    for (const metric of WEIGHTED_SHARE_METRICS) {
      const sourceFacts = window.map((period) => period.facts[metric]);
      if (sourceFacts.some((fact) => fact?.value == null)) continue;
      const totalDays = window.reduce((sum, period) => sum + (period.durationDays ?? 0), 0);
      const value = sourceFacts.reduce((sum, fact, factIndex) => sum + fact!.value! * (window[factIndex].durationDays ?? 0), 0) / totalDays;
      facts[metric] = { metric, value, currency, unit: "shares", periodStart: window[0].periodStart, periodEnd: latestQuarter.periodEnd, periodicity: "ttm", fiscalYear: latestQuarter.fiscalYear, fiscalQuarter: latestQuarter.fiscalQuarter, provenance: { provider: "Calculated", sourceUrl: sourceFacts[3]!.provenance.sourceUrl, retrievedAt: sourceFacts[3]!.provenance.retrievedAt, concept: sourceFacts[3]!.provenance.concept, status: "calculated", formula: "Day-weighted average of four quarterly weighted-average share counts", note: `Weighted across ${totalDays} days.` } };
    }
    for (const metric of POINT_METRICS) if (latestQuarter.facts[metric]) facts[metric] = { ...latestQuarter.facts[metric]!, periodicity: "ttm" };
    if (facts.shareRepurchases || facts.shareIssuance) facts.netShareRepurchases = { metric: "netShareRepurchases", value: (facts.shareRepurchases?.value ?? 0) - (facts.shareIssuance?.value ?? 0), currency, unit: "currency", periodStart: window[0].periodStart, periodEnd: latestQuarter.periodEnd, periodicity: "ttm", fiscalYear: latestQuarter.fiscalYear, fiscalQuarter: latestQuarter.fiscalQuarter, provenance: { provider: "Calculated", sourceUrl: latestQuarter.facts.revenue!.provenance.sourceUrl, retrievedAt: latestQuarter.facts.revenue!.provenance.retrievedAt, concept: "NetShareRepurchases", status: "calculated", formula: "TTM gross repurchases − TTM issuance proceeds" } };
    periods.push({ label: `TTM ${latestQuarter.fiscalQuarter} FY${latestQuarter.fiscalYear}`, fiscalYear: latestQuarter.fiscalYear, fiscalQuarter: latestQuarter.fiscalQuarter, periodStart: window[0].periodStart, periodEnd: latestQuarter.periodEnd, periodicity: "ttm", filingDate: latestQuarter.filingDate, accession: latestQuarter.accession, currency, durationDays: window.reduce((sum, period) => sum + (period.durationDays ?? 0), 0), ttmQuarterEnds: window.map((period) => period.periodEnd), facts });
  }
  return periods;
}
