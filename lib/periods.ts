import type { FinancialPeriod, MetricKey, NormalizedFact, RawFinancialFact } from "./types";

export const FLOW_METRICS: MetricKey[] = [
  "revenue", "grossProfit", "costOfRevenue", "operatingIncome", "netIncome", "operatingCashFlow",
  "capitalExpenditures", "stockBasedCompensation", "shareRepurchases", "shareIssuance",
  "acquisitions", "dividendsPaid",
  "incomeBeforeTax", "incomeTaxExpense", "depreciationAndAmortization",
  "interestExpense", "dividendsPerShare",
  // Carried only so a share count can be recovered from it when the filer
  // publishes none; see recoverDilutedShares in the SEC adapter.
  "dilutedEpsReported",
];
export const WEIGHTED_SHARE_METRICS: MetricKey[] = ["basicShares", "dilutedShares"];
export const POINT_METRICS: MetricKey[] = ["sharesOutstanding", "sharesIssued", "treasuryShares", "cashAndEquivalents", "totalDebt", "currentAssets", "currentLiabilities", "totalEquity", "totalAssets", "goodwill", "intangibleAssets", "longTermDebtCurrent", "longTermDebtNoncurrent"];
const SPLIT_ADJUSTED_METRICS: MetricKey[] = [...WEIGHTED_SHARE_METRICS, "sharesOutstanding", "sharesIssued", "treasuryShares"];
/** Per-share amounts move the other way: a split divides them. */
const SPLIT_DIVIDED_METRICS: MetricKey[] = ["dilutedEpsReported", "dividendsPerShare"];

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
    for (const metric of [...SPLIT_ADJUSTED_METRICS, ...SPLIT_DIVIDED_METRICS]) {
      const fact = facts[metric]; if (fact?.value == null) continue;
      const divides = SPLIT_DIVIDED_METRICS.includes(metric);
      // A later filing commonly restates comparative share counts for a split.
      // Only facts filed before the split still require our adjustment.
      const applicable = splits.filter((split) => period.periodEnd < split.date && (!fact.provenance.filingDate || fact.provenance.filingDate < split.date));
      const factor = applicable.reduce((product, split) => product * split.ratio, 1);
      if (factor === 1) continue;
      const value = divides ? fact.value / factor : fact.value * factor;
      facts[metric] = { ...fact, value, validation: fact.validation ? { ...fact.validation, normalizedValue: value, correction: `${fact.validation.correction ?? "Corroborated magnitude selected"}; then adjusted by the ${factor}:1 cumulative subsequent split factor.` } : fact.validation, provenance: { ...fact.provenance, provider: "Calculated", status: "calculated", formula: divides ? `Reported per-share amount ÷ ${factor}:1 cumulative subsequent split factor` : `Reported share count × ${factor}:1 cumulative subsequent split factor`, note: `Split-adjusted for ${applicable.map((split) => `${split.ratio}:1 on ${split.date}`).join(", ")}. Original SEC source remains linked.` } };
    }
    return { ...period, facts };
  });
}

const POSITIVE_OUTFLOW_METRICS = new Set<MetricKey>(["capitalExpenditures","acquisitions","shareRepurchases","dividendsPaid","interestExpense"]);
export function normalizeFinancialSign(metric: MetricKey, value: number) { return POSITIVE_OUTFLOW_METRICS.has(metric) ? Math.abs(value) : value; }

function normalized(raw: RawFinancialFact, periodicity: "annual" | "quarterly", fiscalQuarter?: "Q1" | "Q2" | "Q3" | "Q4"): NormalizedFact {
  const value = normalizeFinancialSign(raw.metric, raw.value); const signChanged = value !== raw.value;
  return {
    metric: raw.metric, value, currency: raw.currency, unit: raw.unit,
    periodStart: raw.start, periodEnd: raw.end, periodicity, fiscalYear: raw.fiscalYear, fiscalQuarter,
    provenance: {
      provider: "SEC", sourceUrl: raw.sourceUrl, accession: raw.accession, filingDate: raw.filed,
      retrievedAt: raw.retrievedAt, concept: raw.concept, status: raw.restated ? "restated" : "reported",
      note: raw.normalizationNote ?? (signChanged ? "Raw cash outflow sign normalized to the FinScope positive-outflow convention; raw value retained." : raw.restated ? "Latest filing selected for a duplicated SEC context with a changed value." : "Directly reported standardized XBRL fact."),
    },
    validation: raw.sourceConflictValues || signChanged ? {
      status: raw.sourceConflictValues ? "Source conflict" : "Calculated and verified", reason: raw.normalizationNote ?? (signChanged ? "Provider outflow sign normalized." : undefined), rawValue: raw.sourceConflictValues?.find((item)=>item!==raw.value) ?? raw.value,
      normalizedValue: value, correction: signChanged ? "Normalized once to a positive cash-outflow convention." : "Corroborated SEC magnitude selected; conflicting raw observations remain recorded in the quality audit.", checkedAt: raw.retrievedAt,
    } : undefined,
  };
}

/**
 * A derived quarter that comes out impossible is dropped rather than published.
 *
 * Subtraction can only be as consistent as the facts it draws on, and a filer
 * that restates a year onto a narrower scope leaves the earlier quarters behind.
 * The arithmetic then produces negative revenue or a negative share count. This
 * application shows a hole where it has no trustworthy value, so the hole is
 * what the reader gets.
 */
const NEVER_NEGATIVE = new Set<MetricKey>(["revenue", "costOfRevenue", "basicShares", "dilutedShares", "sharesOutstanding", "totalEquity", "capitalExpenditures", "operatingCashFlow", "totalAssets", "goodwill", "intangibleAssets", "longTermDebtCurrent", "longTermDebtNoncurrent"]);
function implausible(metric: MetricKey, value: number) {
  if (!Number.isFinite(value)) return true;
  if (WEIGHTED_SHARE_METRICS.includes(metric) || metric === "sharesOutstanding") return value <= 0;
  return NEVER_NEGATIVE.has(metric) && value < 0;
}

function calculated(metric: MetricKey, value: number, current: RawFinancialFact, prior: RawFinancialFact, formula: string, quarter: "Q1" | "Q2" | "Q3" | "Q4", start: string): NormalizedFact {
  return {
    metric, value: normalizeFinancialSign(metric,value), currency: current.currency, unit: current.unit, periodStart: start,
    periodEnd: current.end, periodicity: "quarterly", fiscalYear: current.fiscalYear, fiscalQuarter: quarter,
    provenance: {
      provider: "Calculated", sourceUrl: current.sourceUrl, accession: current.accession, filingDate: current.filed,
      retrievedAt: current.retrievedAt, concept: current.concept, status: "calculated", formula,
      sourceAccessions: [...new Set([current.accession, prior.accession])],
      note: `Quarter isolated from cumulative SEC facts: ${formula}. Sources ${prior.end} and ${current.end}.`,
    },
  };
}

type FactIndex = Map<string, RawFinancialFact[]>;

/**
 * Deduped facts plus a lookup index, computed once per raw fact array.
 *
 * Every period asks for one metric in one fiscal context, and the answer used
 * to be found by scanning all of them. A large filer carries around 5,700
 * facts, and the quarterly pass alone asks roughly 2,400 times: thirteen
 * million comparisons to assemble one company. That was over half the CPU of a
 * cold request, and it is what made the Worker refuse whole batches.
 *
 * The annual and quarterly passes are handed the same array and would each
 * repeat the dedupe, so the result is memoised against that array by identity.
 */
const preparedFacts = new WeakMap<RawFinancialFact[], { facts: RawFinancialFact[]; index: FactIndex }>();

function prepare(input: RawFinancialFact[]) {
  const cached = preparedFacts.get(input);
  if (cached) return cached;
  const facts = dedupeFacts(relabelFiscalYears(normalizeShareUnitScales(input)));
  const index: FactIndex = new Map();
  for (const fact of facts) {
    const key = `${fact.metric}|${fact.fiscalYear}|${fact.fiscalPeriod}`;
    const bucket = index.get(key);
    if (bucket) bucket.push(fact); else index.set(key, [fact]);
  }
  const value = { facts, index };
  preparedFacts.set(input, value);
  return value;
}

/** Never mutated by callers, so the indexed array itself can be returned. */
function contexts(index: FactIndex, metric: MetricKey, fy: number, fp: RawFinancialFact["fiscalPeriod"]) {
  return index.get(`${metric}|${fy}|${fp}`) ?? [];
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

/**
 * A derived quarter may only be built from facts sharing one concept.
 *
 * Several filers publish two revenue concepts with materially different
 * values — Mastercard reports both net revenue and revenue including assessed
 * taxes, eight billion apart. Subtracting quarters tagged one way from a year
 * tagged the other produced impossible results: Mastercard's fourth quarter of
 * 2020 came out at minus 1.9 billion of revenue, which then poisoned every
 * margin, per-share figure and trailing window built on it.
 */
const sameConcept = (facts: RawFinancialFact[], concept: string) => facts.filter((fact) => fact.concept === concept);

function quarterFact(index: FactIndex, metric: MetricKey, fy: number, quarter: "Q1" | "Q2" | "Q3" | "Q4"): NormalizedFact | undefined {
  const fp = quarter === "Q4" ? "FY" : quarter;
  const candidates = contexts(index, metric, fy, fp);
  // FY contexts can contain later comparative quarter facts carrying fp=FY, so
  // a Q4 may not be picked merely because an FY-tagged duration happens to be
  // about ninety days. It is accepted only when it closes the fiscal year: the
  // annual fact ends on the same day, and the quarter starts after it began.
  // Several filers publish that quarter outright, and taking it is safer than
  // subtracting a restated year from quarters filed at the old scope.
  const annualHere = selectAnnual(candidates);
  const direct = quarter === "Q4"
    ? (annualHere ? selectDirectQuarter(sameConcept(candidates, annualHere.concept).filter((fact) => fact.end === annualHere.end && !!fact.start && fact.start > annualHere.start!)) : undefined)
    : selectDirectQuarter(candidates);
  if (direct) return normalized(direct, "quarterly", quarter);

  if (quarter === "Q1") return undefined;
  const current = quarter === "Q4" ? annualHere : selectCumulative(candidates);
  if (!current) return undefined;
  const priorFp = quarter === "Q2" ? "Q1" : quarter === "Q3" ? "Q2" : "Q3";
  const priorCandidates = sameConcept(contexts(index, metric, fy, priorFp), current.concept);
  const prior = quarter === "Q2" ? selectDirectQuarter(priorCandidates) : selectCumulative(priorCandidates);
  if (quarter === "Q4" && !prior && current.start) {
    const directQuarters = (["Q1", "Q2", "Q3"] as const).map((item) => selectDirectQuarter(sameConcept(contexts(index, metric, fy, item), current.concept)));
    if (directQuarters.every((fact): fact is RawFinancialFact => fact != null)) {
      const totalDays = daysBetween(current.start, current.end); const priorDays = directQuarters.reduce((sum, fact) => sum + daysBetween(fact.start, fact.end), 0); const isolatedDays = totalDays - priorDays;
      if (isolatedDays >= 55 && isolatedDays <= 125) {
        const rawValue = WEIGHTED_SHARE_METRICS.includes(metric)
          ? (current.value * totalDays - directQuarters.reduce((sum, fact) => sum + fact.value * daysBetween(fact.start, fact.end), 0)) / isolatedDays
          : current.value - directQuarters.reduce((sum, fact) => sum + fact.value, 0);
        if (implausible(metric, rawValue)) return undefined;
        const value = rawValue;
        const start = new Date(Date.parse(directQuarters[2].end) + 86_400_000).toISOString().slice(0,10);
        return { metric, value:normalizeFinancialSign(metric,value), currency: current.currency, unit: current.unit, periodStart:start, periodEnd:current.end, periodicity:"quarterly", fiscalYear:fy, fiscalQuarter:"Q4", provenance:{provider:"Calculated",sourceUrl:current.sourceUrl,accession:current.accession,filingDate:current.filed,retrievedAt:current.retrievedAt,concept:current.concept,status:"calculated",formula:WEIGHTED_SHARE_METRICS.includes(metric)?"Q4 weighted shares = (annual weighted shares × annual days − Σ(Q1–Q3 weighted shares × quarter days)) / Q4 days":"Q4 = annual − Q1 − Q2 − Q3",sourceAccessions:[...new Set([current.accession,...directQuarters.map((fact)=>fact.accession)])],note:"Q4 isolated from the annual fact and three direct fiscal quarters; no value was imputed; cash outflows use positive normalized magnitudes."} };
      }
    }
  }
  if (!prior || !current.start || current.start !== prior.start || current.end <= prior.end) return undefined;
  const quarterStart = new Date(Date.parse(prior.end) + 86_400_000).toISOString().slice(0, 10);

  if (WEIGHTED_SHARE_METRICS.includes(metric)) {
    const currentDays = daysBetween(current.start, current.end);
    const priorDays = daysBetween(prior.start, prior.end);
    const isolatedDays = currentDays - priorDays;
    if (isolatedDays < 55 || isolatedDays > 125) return undefined;
    const value = (current.value * currentDays - prior.value * priorDays) / isolatedDays;
    if (implausible(metric, value)) return undefined;
    return calculated(metric, value, current, prior, `(Cumulative weighted shares × ${currentDays} days − prior weighted shares × ${priorDays} days) / ${isolatedDays} days`, quarter, quarterStart);
  }
  if (implausible(metric, current.value - prior.value)) return undefined;
  return calculated(metric, current.value - prior.value, current, prior, `${quarter} = cumulative through ${quarter} − cumulative through ${priorFp}`, quarter, quarterStart);
}

function instantFact(index: FactIndex, metric: MetricKey, fy: number, quarter: "Q1" | "Q2" | "Q3" | "Q4", end: string) {
  const fp = quarter === "Q4" ? "FY" : quarter;
  const exact = contexts(index, metric, fy, fp).filter((fact) => fact.end === end);
  const raw = latest(exact);
  return raw ? normalized(raw, "quarterly", quarter) : undefined;
}

export function normalizeAnnualPeriods(input: RawFinancialFact[], currency: string) {
  const { facts, index } = prepare(input);
  const years = [...new Set(facts.filter((fact) => fact.fiscalPeriod === "FY" && fact.form === "10-K").map((fact) => fact.fiscalYear))].sort();
  return years.map((fiscalYear): FinancialPeriod | null => {
    const annualFacts: FinancialPeriod["facts"] = {};
    let anchor: RawFinancialFact | undefined;
    for (const metric of [...FLOW_METRICS, ...WEIGHTED_SHARE_METRICS]) {
      const raw = selectAnnual(contexts(index, metric, fiscalYear, "FY"));
      if (raw) { annualFacts[metric] = normalized(raw, "annual"); if (metric === "revenue") anchor = raw; }
    }
    if (!anchor) return null;
    for (const metric of POINT_METRICS) {
      const raw = latest(contexts(index, metric, fiscalYear, "FY").filter((fact) => fact.end === anchor!.end));
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
  const { facts, index } = prepare(input);
  const years = [...new Set(facts.filter((fact) => fact.form === "10-Q" || fact.form === "10-K").map((fact) => fact.fiscalYear))].sort();
  const periods: FinancialPeriod[] = [];
  for (const fiscalYear of years) {
    for (const quarter of ["Q1", "Q2", "Q3", "Q4"] as const) {
      const revenue = quarterFact(index, "revenue", fiscalYear, quarter);
      if (!revenue?.periodStart) continue;
      const periodFacts: FinancialPeriod["facts"] = { revenue };
      for (const metric of [...FLOW_METRICS, ...WEIGHTED_SHARE_METRICS]) {
        if (metric === "revenue") continue;
        const fact = quarterFact(index, metric, fiscalYear, quarter);
        if (fact) periodFacts[metric] = fact;
      }
      for (const metric of POINT_METRICS) {
        const fact = instantFact(index, metric, fiscalYear, quarter, revenue.periodEnd);
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
