import type { FinancialPeriod, MetricKey, NormalizedFact, RawFinancialFact } from "./types";

export const FLOW_METRICS: MetricKey[] = [
  "revenue", "grossProfit", "costOfRevenue", "directOperatingCosts", "directMaterialCosts", "costsAndExpenses", "operatingIncome", "netIncome", "operatingCashFlow",
  "capitalExpenditures", "stockBasedCompensation", "shareRepurchases", "shareIssuance",
  "acquisitions", "dividendsPaid",
  "incomeBeforeTax", "incomeTaxExpense", "depreciationAndAmortization",
  "interestExpense", "interestPaid", "dividendsPerShare",
  "researchAndDevelopment", "sellingGeneralAndAdministrative", "operatingExpenses", "otherIncomeExpense",
  // Carried only so a share count can be recovered from it when the filer
  // publishes none; see recoverDilutedShares in the SEC adapter.
  "dilutedEpsReported",
];
export const WEIGHTED_SHARE_METRICS: MetricKey[] = ["basicShares", "dilutedShares"];
export const POINT_METRICS: MetricKey[] = ["sharesOutstanding", "sharesIssued", "treasuryShares", "cashAndEquivalents", "totalDebt", "currentAssets", "currentLiabilities", "totalEquity", "totalAssets", "goodwill", "intangibleAssets", "longTermDebtCurrent", "longTermDebtNoncurrent", "longTermDebtAndLeases", "otherLongTermDebt", "debtInstrumentCarryingAmount", "shortTermBorrowings", "financeLeaseLiability", "totalLiabilities", "propertyPlantAndEquipment", "inventory", "accountsReceivable", "accountsPayable", "shortTermInvestments", "longTermInvestments", "retainedEarnings"];
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
 * The forms that carry a full financial year.
 *
 * A domestic filer's is the 10-K. A foreign private issuer files a 20-F, a
 * Canadian one a 40-F, and neither files quarterly reports — so a company on
 * one of those has annual periods and no quarters, which is a real coverage
 * limit rather than a failure.
 */
export const ANNUAL_FORMS: ReadonlySet<string> = new Set(["10-K", "20-F", "40-F"]);
export const isAnnualForm = (form: string) => ANNUAL_FORMS.has(form);

/**
 * SEC `fy` identifies the fiscal year of the filing, not always the comparative
 * period carried inside it. Relabeling from the actual period end makes older
 * restatements compete in the same context instead of becoming duplicate years.
 */
export function relabelFiscalYears(input: RawFinancialFact[]) {
  const annualFacts = input.filter((fact) => fact.start && fact.fiscalPeriod === "FY" && isAnnualForm(fact.form)
    && daysBetween(fact.start, fact.end) >= 300 && daysBetween(fact.start, fact.end) <= 400);
  const annualEnds = annualFacts.map((fact) => fact.end.slice(5));
  const fiscalEnd = [...new Set(annualEnds)].sort((left,right)=>annualEnds.filter((item)=>item===right).length-annualEnds.filter((item)=>item===left).length)[0] ?? "12-31";
  /*
   * Match a short-duration or instant fact to an actual reported fiscal year
   * before falling back to a month/day rule. A 52/53-week filer does not have
   * one stable fiscal-end date: Johnson & Johnson has closed on dates from
   * December 29 through January 3. Comparing every quarter with one modal
   * month/day moved whole years of facts into the next fiscal year even though
   * the annual window containing them was present in the same payload.
   */
  const annualWindows = [...new Map(annualFacts.map((fact) => [`${fact.start}|${fact.end}`, {
    start: fact.start!, end: fact.end, fiscalYear: Number(fact.end.slice(0, 4)),
  }])).values()];
  const DAY = 86_400_000;
  return input.map((fact) => {
    const calendarYear = Number(fact.end.slice(0,4));
    const endMonthDay = fact.end.slice(5);
    /*
     * `FY` means "the year this filing is about", not "this fact covers a year".
     *
     * An annual report carries its own quarters as comparatives, and every one
     * of them inherits the filing's `fp: "FY"`. Dating those by the calendar
     * year of their end put Microsoft's September 2016 quarter — which is the
     * first quarter of its fiscal 2017 — into 2016, two quarters away from the
     * year it belongs to. The shortcut is right for a fact that really does
     * span the year, and for an instant; anything shorter is dated the way
     * every other period is, by whether it ends after the fiscal year does.
    */
    const spansTheYear = !fact.start || daysBetween(fact.start, fact.end) >= 300;
    const containing = spansTheYear ? undefined : annualWindows
      .filter((window) => {
        const start = Date.parse(window.start); const end = Date.parse(window.end);
        const factStart = Date.parse(fact.start ?? fact.end); const factEnd = Date.parse(fact.end);
        return factStart >= start - 7 * DAY && factEnd <= end && factEnd >= start - 7 * DAY && end - factEnd <= 370 * DAY;
      })
      .sort((left, right) => Date.parse(left.end) - Date.parse(right.end))[0];
    const fiscalYear = containing?.fiscalYear ?? (fact.fiscalPeriod === "FY" && spansTheYear ? calendarYear
      : endMonthDay > fiscalEnd ? calendarYear + 1 : calendarYear);
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

const POSITIVE_OUTFLOW_METRICS = new Set<MetricKey>(["capitalExpenditures","acquisitions","shareRepurchases","dividendsPaid","interestExpense","interestPaid"]);
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
 *
 * "Impossible" has to mean impossible, and it did not. Operating cash flow was
 * on this list, and operating cash flow is negative all the time: a company
 * burning cash has a negative quarter by definition, and an exchange has one
 * whenever clearing members take margin back. Cboe files its cash flow
 * cumulatively from January, so three of its four quarters are subtractions —
 * and being negative, three of four were thrown away. A trailing figure needs
 * all four, so the free cash flow of a profitable business disappeared from
 * 2010 to 2026 with nothing on the page to say why. It was not the only one.
 *
 * What belongs here is a quantity that cannot be negative in any world: a
 * revenue, a cost, a share count, a capital expenditure whose sign has already
 * been normalized. Not a net flow, and not a balance that buybacks can push
 * through zero.
 */
const NEVER_NEGATIVE = new Set<MetricKey>([
  // Quantities, not net flows: none of these can be below nought in any world.
  "revenue", "costOfRevenue", "directOperatingCosts", "directMaterialCosts", "costsAndExpenses", "researchAndDevelopment", "sellingGeneralAndAdministrative", "operatingExpenses",
  "basicShares", "dilutedShares", "sharesOutstanding",
  // Already normalized to a positive outflow magnitude, so a negative one is
  // arithmetic that went wrong rather than a company that was paid to invest.
  "capitalExpenditures",
  // Balances that cannot go through zero. Total equity is deliberately absent:
  // a company that has bought back more stock than it has retained earnings has
  // negative book equity, and several large ones do.
  "totalAssets", "goodwill", "intangibleAssets", "totalLiabilities",
  "longTermDebtCurrent", "longTermDebtNoncurrent", "longTermDebtAndLeases", "otherLongTermDebt",
  "debtInstrumentCarryingAmount", "shortTermBorrowings", "financeLeaseLiability",
  "propertyPlantAndEquipment", "inventory", "accountsReceivable", "accountsPayable",
  "shortTermInvestments", "longTermInvestments",
]);
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
type EndIndex = Map<string, RawFinancialFact[]>;

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
const preparedFacts = new WeakMap<RawFinancialFact[], { facts: RawFinancialFact[]; index: FactIndex; endIndex: EndIndex }>();

function prepare(input: RawFinancialFact[]) {
  const cached = preparedFacts.get(input);
  if (cached) return cached;
  const facts = dedupeFacts(relabelFiscalYears(normalizeShareUnitScales(input)));
  const index: FactIndex = new Map();
  const endIndex: EndIndex = new Map();
  for (const fact of facts) {
    const key = `${fact.metric}|${fact.fiscalYear}|${fact.fiscalPeriod}`;
    const bucket = index.get(key);
    if (bucket) bucket.push(fact); else index.set(key, [fact]);
    if (!fact.start) {
      const endKey = `${fact.metric}|${fact.end}`;
      const atEnd = endIndex.get(endKey);
      if (atEnd) atEnd.push(fact); else endIndex.set(endKey, [fact]);
    }
  }
  const value = { facts, index, endIndex };
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

/** The one concept that means every revenue the company earned. */
const TOTAL_REVENUE = "us-gaap:Revenues";
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Revenue is the total the filer reports, not a component of it.
 *
 * `RevenueFromContractWithCustomer...` is revenue recognised under the
 * contracts standard. `Revenues` is the income-statement line. For most filers
 * those are the same number and the preference order between them is a
 * formality — Costco tags 275.2bn under both. For a company that earns
 * materially outside contracts with customers they are not: Berkshire Hathaway
 * tags 247.2bn of contract revenue and 371.4bn of total revenues for 2025, the
 * 124bn difference being insurance premiums earned and investment income, and
 * FinScope published the smaller figure under the label "Revenue" — a third of
 * the company's income missing from the headline, from every margin computed
 * on it, and from every multiple.
 *
 * The rule is one-directional on purpose. A total cannot be smaller than a
 * component of itself, so `Revenues` wins only where it is strictly larger; a
 * filer whose `Revenues` sits below its contract tag is describing something
 * narrower under that name — Mastercard's net revenue against its gross — and
 * nothing here disturbs the concept already chosen. A tenth of a percent is
 * left as rounding.
 *
 * The reconciliation travels with the fact: the drawer states both figures and
 * their difference rather than silently swapping one for the other.
 */
export function preferTotalRevenue(candidates: RawFinancialFact[], chosen: RawFinancialFact | undefined) {
  if (!chosen || chosen.concept === TOTAL_REVENUE) return chosen;
  const total = latest(candidates.filter((fact) =>
    fact.concept === TOTAL_REVENUE && fact.end === chosen.end && fact.start === chosen.start && fact.currency === chosen.currency));
  if (!total || total.value <= chosen.value * 1.001) return chosen;
  const note = `Reconciled to the filer's total: ${compact.format(chosen.value)} tagged as ${chosen.concept.replace("us-gaap:", "")} and ${compact.format(total.value)} as Revenues, a difference of ${compact.format(total.value - chosen.value)} earned outside contracts with customers. The total is the income-statement line and is the figure reported here.`;
  return { ...total, normalizationNote: total.normalizationNote ? `${total.normalizationNote} ${note}` : note };
}

/**
 * The annual fact a year is published under, after that reconciliation.
 *
 * Used both to build the annual period and to choose the concept its quarters
 * are derived from, so a year stated as a total is never divided into quarters
 * tagged as a component of it.
 */
function publishedAnnual(index: FactIndex, metric: MetricKey, fy: number) {
  const all = contexts(index, metric, fy, "FY");
  // A zero under a generic revenue tag can be a discontinued segment or an
  // empty disclosure context published years after the positive income-
  // statement line. It must not erase a positive annual revenue for the same
  // fiscal year merely because its filing date is later.
  const positive = metric === "revenue" ? all.filter((fact) => fact.value > 0) : all;
  if (metric !== "revenue") return selectAnnual(positive.length ? positive : all);
  /*
   * `Revenues` is tested as a total, not allowed to win merely because it was
   * filed later. P&G carries a 28.4bn segment under that tag beside 82.0bn of
   * SalesRevenueNet for the same year; selecting the latest tag first made the
   * segment the company's whole revenue. Start from the preferred non-total
   * income-statement candidate, then promote Revenues only when it is actually
   * larger. If it is the only positive concept, it remains the fallback.
  */
  const nonTotal = positive.filter((fact) => fact.concept !== TOTAL_REVENUE);
  const chosen = selectAnnual(nonTotal) ?? selectAnnual(positive.length ? positive : all);
  return preferTotalRevenue(all, chosen);
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

/**
 * Two concepts are the same measure for a year when their annual figures agree.
 *
 * A tenth of a percent is a rounding difference between two taggings of one
 * number; anything more is a restatement that genuinely changed the year, and
 * its quarters are not this year's quarters.
 */
function sameMeasure(index: FactIndex, metric: MetricKey, fy: number, concept: string, published: RawFinancialFact): boolean {
  const rival = selectAnnual(sameConcept(contexts(index, metric, fy, "FY"), concept));
  if (!rival || rival.currency !== published.currency || published.value === 0) return false;
  return Math.abs(rival.value - published.value) / Math.abs(published.value) <= .001;
}

/**
 * An exact quarterly history on the accounting basis originally reported.
 *
 * A later filing sometimes restates an annual total without publishing the
 * restated quarter split. Microsoft fiscal 2016 is the important case: the
 * later annual is 91.154bn, while the previously filed year is 85.320bn and has
 * all three interim filings needed to isolate its four exact quarters. The same
 * shape appears after acquisitions, dispositions and taxonomy migrations.
 * There is no honest way to allocate an annual restatement across quarters.
 * Deleting the exact originally reported quarters, however, also deletes TTM
 * observations and makes a real filing history look like a data outage.
 *
 * The guard is chronology rather than a ticker or tag list: the old annual must
 * have been filed before the later basis, cover the identical fiscal window
 * and carry all three interim contexts. A simultaneous gross/net pair or a
 * total/component pair cannot satisfy it because neither predates the other.
 */
function historicalQuarterBasis(index: FactIndex, metric: MetricKey, fy: number, concept: string, published: RawFinancialFact): RawFinancialFact | undefined {
  if (concept === published.concept) return undefined;
  const rival = selectAnnual(sameConcept(contexts(index, metric, fy, "FY"), concept));
  if (!rival?.start || !published.start || rival.start !== published.start || rival.end !== published.end
    || rival.currency !== published.currency || rival.unit !== published.unit || rival.filed >= published.filed) return undefined;
  const hasEveryInterim = (["Q1", "Q2", "Q3"] as const).every((quarter) =>
    sameConcept(contexts(index, metric, fy, quarter), concept).length > 0);
  return hasEveryInterim ? rival : undefined;
}

/**
 * Every concept a quarter may be built from, the year's own first.
 *
 * A quarter is built from one concept end to end — that is what stops
 * Mastercard's net year being reduced by gross quarters — but insisting on the
 * *year's* concept alone threw away five quarters from seventeen of the
 * twenty-one companies here. The cause is one event: adopting the revenue
 * standard in 2018, filers restated the prior year under a new concept while
 * the quarters of that year stayed under the old one. The year then had a
 * concept its own quarters never carried, the derivation found nothing, and
 * every trailing window touching it disappeared — Apple lost two years, and the
 * ten-year view of a compounder became an eight-year one.
 *
 * Another concept is therefore allowed, but only where it is demonstrably the
 * same measure: its own annual figure has to match the published one. Apple's
 * 2016 revenue is 215.639bn under both the old tag and the new, so its quarters
 * are the year's quarters and the history is recovered. The one narrower rule
 * above covers an annual-only ASC 606 restatement: exact quarters stay on their
 * explicitly disclosed historical basis instead of being deleted or adjusted.
 */
function conceptsToTry(index: FactIndex, metric: MetricKey, fy: number): string[] {
  const published = publishedAnnual(index, metric, fy);
  const year = published?.concept;
  const filed = QUARTERS.flatMap((quarter) => contexts(index, metric, fy, quarter === "Q4" ? "FY" : quarter));
  const others = [...new Set(filed.map((fact) => fact.concept))].filter((concept) => concept !== year);
  if (!published || !year) return others;
  return [year, ...others.filter((concept) => sameMeasure(index, metric, fy, concept, published)
    || historicalQuarterBasis(index, metric, fy, concept, published) != null)];
}

/**
 * The one concept a fiscal year's four quarters are all built from.
 *
 * Chosen once for the year rather than per quarter: letting each quarter take
 * the first concept that happened to work mixed them, and four quarters from
 * two taggings do not add up to either year. Veeva's 2017 came out 11% away
 * from its own net income that way.
 *
 * Where two concepts are both allowed, the one the company actually filed the
 * most quarters under wins; the year's own concept breaks a tie.
 */
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
const conceptChoice = new WeakMap<FactIndex, Map<string, string | undefined>>();
function yearConcept(index: FactIndex, metric: MetricKey, fy: number): string | undefined {
  let cache = conceptChoice.get(index);
  if (!cache) { cache = new Map(); conceptChoice.set(index, cache); }
  const key = `${metric}|${fy}`;
  if (cache.has(key)) return cache.get(key);
  const candidates = conceptsToTry(index, metric, fy);
  let best: string | undefined; let bestScore = -1;
  for (const concept of candidates) {
    // Count both ordinary quarterly contexts and reported comparatives carried
    // by an annual filing. Otherwise an older concept with three 10-Qs beats a
    // fully restated concept merely because all of the latter's quarters sit
    // under FY/Q4. This is cached once per metric and fiscal year.
    const score = (["Q1", "Q2", "Q3"] as const).filter((quarter) =>
      sameConcept(contexts(index, metric, fy, quarter), concept).length > 0
      || comparativeQuarter(index, metric, fy, quarter, concept) != null).length;
    if (score > bestScore) { bestScore = score; best = concept; }
  }
  cache.set(key, best);
  return best;
}

/**
 * A quarter the filer published inside a later annual report, as a comparative.
 *
 * This is where a restated year's quarters actually are. Microsoft adopted the
 * revenue standard in fiscal 2018 and restated 2017 with it: the 2018 annual
 * report carries fiscal 2017's four quarters — 21.9, 25.8, 23.2 and 25.6
 * billion — under the same concept as the restated year, and they sum to the
 * 96.6 billion that year is now stated at. But they carry the filing's own
 * `fp: "FY"`, so nothing that looked in the quarterly contexts ever saw them,
 * and two years of Microsoft's history were missing from every quarterly and
 * trailing view.
 *
 * Matched by where the quarter falls in the year rather than by its label: the
 * first ends about ninety-one days after the year opens, the second about a
 * hundred and eighty-two, and a filer's quarters are never far off that.
 */
const QUARTER_DAYS = 91.31;
function comparativeQuarter(index: FactIndex, metric: MetricKey, fy: number, quarter: "Q1" | "Q2" | "Q3", concept: string | undefined): RawFinancialFact | undefined {
  const scoped = concept ? sameConcept(contexts(index, metric, fy, "FY"), concept) : contexts(index, metric, fy, "FY");
  const annual = selectAnnual(scoped);
  if (!annual?.start) return undefined;
  const position = quarter === "Q1" ? 1 : quarter === "Q2" ? 2 : 3;
  const target = Date.parse(annual.start) + position * QUARTER_DAYS * 86_400_000;
  return latest(scoped.filter((fact) => {
    if (!fact.start) return false;
    const days = daysBetween(fact.start, fact.end);
    return days >= 55 && days <= 125
      && fact.start >= annual.start! && fact.end < annual.end
      && Math.abs(Date.parse(fact.end) - target) <= 25 * 86_400_000;
  }));
}

function quarterFact(index: FactIndex, metric: MetricKey, fy: number, quarter: "Q1" | "Q2" | "Q3" | "Q4"): NormalizedFact | undefined {
  const all = contexts(index, metric, fy, quarter === "Q4" ? "FY" : quarter);
  const concept = yearConcept(index, metric, fy);
  let found = quarterFromConcept(index, metric, fy, quarter, concept ? sameConcept(all, concept) : all);
  if (!found && quarter !== "Q4") {
    // Nothing under the quarter's own label; the restated one may be sitting in
    // the annual report that restated it.
    const comparative = comparativeQuarter(index, metric, fy, quarter, concept);
    if (comparative) found = normalized(comparative, "quarterly", quarter);
  }
  if (!found || !concept) return found;
  const published = publishedAnnual(index, metric, fy);
  const historical = published ? historicalQuarterBasis(index, metric, fy, concept, published) : undefined;
  if (!published || !historical) return found;
  const note = `Exact quarter retained on the ${concept.replace("us-gaap:", "")} basis originally reported. A later filing changed the annual basis from ${compact.format(historical.value)} to ${compact.format(published.value)} under ${published.concept.replace("us-gaap:", "")} without publishing a quarterly allocation; no value is estimated.`;
  return { ...found, provenance: { ...found.provenance, note: found.provenance.note ? `${found.provenance.note} ${note}` : note } };
}

function quarterFromConcept(index: FactIndex, metric: MetricKey, fy: number, quarter: "Q1" | "Q2" | "Q3" | "Q4", candidates: RawFinancialFact[]): NormalizedFact | undefined {
  if (!candidates.length) return undefined;
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
  if (!prior || !current.start || !prior.start || Math.abs(Date.parse(current.start) - Date.parse(prior.start)) > 7 * 86_400_000 || current.end <= prior.end) return undefined;
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

function instantFact(endIndex: EndIndex, metric: MetricKey, fy: number, quarter: "Q1" | "Q2" | "Q3" | "Q4", end: string) {
  void fy; void quarter;
  // An instant balance belongs to its date, not to one filing's fy/fp labels.
  // The same balance is routinely repeated under FY, Q1 and Q2 contexts in
  // later filings; restricting it to the flow anchor's context manufactured
  // gaps in shares, cash and debt even when an exact-date fact was available.
  const raw = latest(endIndex.get(`${metric}|${end}`) ?? []);
  return raw ? normalized(raw, "quarterly", quarter) : undefined;
}

export function normalizeAnnualPeriods(input: RawFinancialFact[], currency: string) {
  const { facts, index, endIndex } = prepare(input);
  const years = [...new Set(facts.filter((fact) => fact.fiscalPeriod === "FY" && isAnnualForm(fact.form)).map((fact) => fact.fiscalYear))].sort();
  return years.map((fiscalYear): FinancialPeriod | null => {
    const annualFacts: FinancialPeriod["facts"] = {};
    let anchor: RawFinancialFact | undefined;
    for (const metric of [...FLOW_METRICS, ...WEIGHTED_SHARE_METRICS]) {
      const raw = publishedAnnual(index, metric, fiscalYear);
      // Revenue remains the preferred anchor because it is normally the first
      // full-year flow. A financial filer may publish no standardized revenue
      // concept at all, however; net income or another reported annual flow is
      // still sufficient to establish the exact fiscal window and attach its
      // point-in-time balance sheet. Goldman Sachs is the real-world case.
      if (raw) { annualFacts[metric] = normalized(raw, "annual"); anchor ??= raw; }
    }
    if (!anchor) return null;
    for (const metric of POINT_METRICS) {
      const raw = latest(endIndex.get(`${metric}|${anchor.end}`) ?? []);
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
  const { facts, index, endIndex } = prepare(input);
  const years = [...new Set(facts.filter((fact) => fact.form === "10-Q" || isAnnualForm(fact.form)).map((fact) => fact.fiscalYear))].sort();
  const periods: FinancialPeriod[] = [];
  for (const fiscalYear of years) {
    for (const quarter of ["Q1", "Q2", "Q3", "Q4"] as const) {
      const periodFacts: FinancialPeriod["facts"] = {};
      let anchor: NormalizedFact | undefined;
      for (const metric of [...FLOW_METRICS, ...WEIGHTED_SHARE_METRICS]) {
        const fact = quarterFact(index, metric, fiscalYear, quarter);
        if (fact) { periodFacts[metric] = fact; anchor ??= fact; }
      }
      if (!anchor?.periodStart) continue;
      for (const metric of POINT_METRICS) {
        const fact = instantFact(endIndex, metric, fiscalYear, quarter, anchor.periodEnd);
        if (fact) periodFacts[metric] = fact;
      }
      if (periodFacts.shareRepurchases || periodFacts.shareIssuance) {
        periodFacts.netShareRepurchases = {
          metric: "netShareRepurchases", value: (periodFacts.shareRepurchases?.value ?? 0) - (periodFacts.shareIssuance?.value ?? 0),
          currency, unit: "currency", periodStart: anchor.periodStart, periodEnd: anchor.periodEnd, periodicity: "quarterly", fiscalYear, fiscalQuarter: quarter,
          provenance: { provider: "Calculated", sourceUrl: anchor.provenance.sourceUrl, retrievedAt: anchor.provenance.retrievedAt, concept: "NetShareRepurchases", status: "calculated", formula: "Gross repurchases − issuance proceeds", note: "Cash-flow measure, distinct from the change in shares outstanding." },
        };
      }
      periods.push({ label: `${quarter} FY${fiscalYear}`, fiscalYear, fiscalQuarter: quarter, periodStart: anchor.periodStart, periodEnd: anchor.periodEnd, periodicity: "quarterly", filingDate: anchor.provenance.filingDate ?? "", accession: anchor.provenance.accession ?? "", currency, durationDays: daysBetween(anchor.periodStart, anchor.periodEnd), facts: periodFacts });
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
    if (facts.shareRepurchases || facts.shareIssuance) {
      const source = facts.shareRepurchases ?? facts.shareIssuance!;
      facts.netShareRepurchases = { metric: "netShareRepurchases", value: (facts.shareRepurchases?.value ?? 0) - (facts.shareIssuance?.value ?? 0), currency, unit: "currency", periodStart: window[0].periodStart, periodEnd: latestQuarter.periodEnd, periodicity: "ttm", fiscalYear: latestQuarter.fiscalYear, fiscalQuarter: latestQuarter.fiscalQuarter, provenance: { provider: "Calculated", sourceUrl: source.provenance.sourceUrl, retrievedAt: source.provenance.retrievedAt, concept: "NetShareRepurchases", status: "calculated", formula: "TTM gross repurchases − TTM issuance proceeds" } };
    }
    periods.push({ label: `TTM ${latestQuarter.fiscalQuarter} FY${latestQuarter.fiscalYear}`, fiscalYear: latestQuarter.fiscalYear, fiscalQuarter: latestQuarter.fiscalQuarter, periodStart: window[0].periodStart, periodEnd: latestQuarter.periodEnd, periodicity: "ttm", filingDate: latestQuarter.filingDate, accession: latestQuarter.accession, currency, durationDays: window.reduce((sum, period) => sum + (period.durationDays ?? 0), 0), ttmQuarterEnds: window.map((period) => period.periodEnd), facts });
  }
  return periods;
}
