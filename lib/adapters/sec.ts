import { z } from "zod";
import { COMPANIES } from "../company-registry";
import { adjustPeriodsForSplits, buildTtmPeriods, isAnnualForm, normalizeAnnualPeriods, normalizeQuarterlyPeriods } from "../periods";
import { validateCompanyDataset } from "../data-quality";
import type { CompanyDataset, FinancialPeriod, MetricKey, RawFinancialFact } from "../types";

const SecUnitSchema = z.object({
  start: z.string().optional(), end: z.string(), val: z.number(), accn: z.string(),
  fy: z.number().nullable().optional(), fp: z.string().nullable().optional(), form: z.string(),
  filed: z.string(), frame: z.string().optional(),
});

const SecResponseSchema = z.object({
  entityName: z.string(),
  facts: z.record(z.string(), z.record(z.string(), z.object({ units: z.record(z.string(), z.array(SecUnitSchema)) }))),
});

type SecUnit = z.infer<typeof SecUnitSchema>;
type ConceptSpec = { namespace: "us-gaap" | "dei"; tags: string[]; unit: "currency" | "shares" | "perShare" };

export const SEC_CONCEPTS: Record<Exclude<MetricKey, "freeCashFlow" | "netShareRepurchases">, ConceptSpec> = {
  revenue: { namespace: "us-gaap", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"], unit: "currency" },
  grossProfit: { namespace: "us-gaap", tags: ["GrossProfit"], unit: "currency" },
  costOfRevenue: { namespace: "us-gaap", tags: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"], unit: "currency" },
  operatingIncome: { namespace: "us-gaap", tags: ["OperatingIncomeLoss"], unit: "currency" },
  // Preference order matters here. NetIncomeLoss is income attributable to the
  // parent; ProfitLoss is consolidated and includes noncontrolling interests.
  // Interactive Brokers tags no NetIncomeLoss at all — the public company owns
  // only a minority of the operating partnership — so falling straight to
  // ProfitLoss overstated its net income, margins and every per-share figure by
  // about four and a half times. The middle concept matches its reported EPS
  // exactly.
  netIncome: { namespace: "us-gaap", tags: ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"], unit: "currency" },
  operatingCashFlow: { namespace: "us-gaap", tags: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], unit: "currency" },
  // Tags are alternatives in preference order, not addends. The last two cover
  // filers that report no property-and-equipment line at all: Cboe and
  // Interactive Brokers use the net productive-assets concept, and Veeva
  // stopped tagging property purchases after FY2020 and now reports only
  // capitalized software. Without them free cash flow simply stopped.
  capitalExpenditures: { namespace: "us-gaap", tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForProceedsFromProductiveAssets", "PaymentsForSoftware"], unit: "currency" },
  acquisitions: { namespace: "us-gaap", tags: ["PaymentsToAcquireBusinessesNetOfCashAcquired", "PaymentsToAcquireBusinessesGross"], unit: "currency" },
  dividendsPaid: { namespace: "us-gaap", tags: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsOfOrdinaryDividends"], unit: "currency" },
  dilutedShares: { namespace: "us-gaap", tags: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"], unit: "shares" },
  // Only used to recover a share count when the filer publishes none directly.
  dilutedEpsReported: { namespace: "us-gaap", tags: ["EarningsPerShareDiluted"], unit: "perShare" },
  basicShares: { namespace: "us-gaap", tags: ["WeightedAverageNumberOfSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"], unit: "shares" },
  sharesOutstanding: { namespace: "dei", tags: ["EntityCommonStockSharesOutstanding"], unit: "shares" },
  sharesIssued: { namespace: "us-gaap", tags: ["CommonStockSharesIssued"], unit: "shares" },
  treasuryShares: { namespace: "us-gaap", tags: ["TreasuryStockShares"], unit: "shares" },
  stockBasedCompensation: { namespace: "us-gaap", tags: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"], unit: "currency" },
  shareRepurchases: { namespace: "us-gaap", tags: ["PaymentsForRepurchaseOfCommonStock"], unit: "currency" },
  shareIssuance: { namespace: "us-gaap", tags: ["ProceedsFromStockOptionsExercised", "ProceedsFromIssuanceOfCommonStock", "ProceedsFromIssuanceOfSharesUnderIncentiveAndShareBasedCompensationPlansIncludingStockOptions"], unit: "currency" },
  cashAndEquivalents: { namespace: "us-gaap", tags: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], unit: "currency" },
  // Only the combined concept. The current and non-current portions are two
  // halves of one balance, so choosing between them as fallbacks reported half
  // a company's debt: Apple tags no combined figure, and the old fallback order
  // returned its 12.4bn current portion as if that were the whole 90.7bn.
  // They are extracted separately below and summed when the total is absent.
  totalDebt: { namespace: "us-gaap", tags: ["LongTermDebtAndFinanceLeaseObligationsCurrentAndNoncurrent", "DebtLongtermAndShorttermCombinedAmount"], unit: "currency" },
  longTermDebtCurrent: { namespace: "us-gaap", tags: ["LongTermDebtCurrent"], unit: "currency" },
  longTermDebtNoncurrent: { namespace: "us-gaap", tags: ["LongTermDebtNoncurrent"], unit: "currency" },
  currentAssets: { namespace: "us-gaap", tags: ["AssetsCurrent"], unit: "currency" },
  // Including noncontrolling interests as a fallback: Visa reports almost only
  // that form, and invested capital wants the whole financing base anyway.
  totalEquity: { namespace: "us-gaap", tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], unit: "currency" },
  currentLiabilities: { namespace: "us-gaap", tags: ["LiabilitiesCurrent"], unit: "currency" },
  incomeBeforeTax: { namespace: "us-gaap", tags: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"], unit: "currency" },
  incomeTaxExpense: { namespace: "us-gaap", tags: ["IncomeTaxExpenseBenefit"], unit: "currency" },
  depreciationAndAmortization: { namespace: "us-gaap", tags: ["DepreciationDepletionAndAmortization", "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment", "Depreciation"], unit: "currency" },
  totalAssets: { namespace: "us-gaap", tags: ["Assets"], unit: "currency" },
  // Goodwill and acquired intangibles are subtracted from assets for the
  // tangible-return measure: they are the price paid for past acquisitions,
  // not capital the business currently operates.
  goodwill: { namespace: "us-gaap", tags: ["Goodwill"], unit: "currency" },
  intangibleAssets: { namespace: "us-gaap", tags: ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"], unit: "currency" },
  // Deliberately not InterestIncomeExpenseNet: a net figure nets interest
  // earned against interest paid, and coverage asks what the debt costs.
  interestExpense: { namespace: "us-gaap", tags: ["InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating"], unit: "currency" },
  dividendsPerShare: { namespace: "us-gaap", tags: ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"], unit: "perShare" },
  // Balance-sheet detail, carried so a statement can be drawn as a flow rather
  // than only totalled. Every one of these is optional: a filer that omits a
  // line leaves it out of the diagram instead of having a number invented.
  totalLiabilities: { namespace: "us-gaap", tags: ["Liabilities"], unit: "currency" },
  propertyPlantAndEquipment: { namespace: "us-gaap", tags: ["PropertyPlantAndEquipmentNet"], unit: "currency" },
  inventory: { namespace: "us-gaap", tags: ["InventoryNet"], unit: "currency" },
  accountsReceivable: { namespace: "us-gaap", tags: ["AccountsReceivableNetCurrent"], unit: "currency" },
  accountsPayable: { namespace: "us-gaap", tags: ["AccountsPayableCurrent"], unit: "currency" },
  shortTermInvestments: { namespace: "us-gaap", tags: ["MarketableSecuritiesCurrent", "ShortTermInvestments", "OtherShortTermInvestments"], unit: "currency" },
  longTermInvestments: { namespace: "us-gaap", tags: ["MarketableSecuritiesNoncurrent", "LongTermInvestments"], unit: "currency" },
  // Deliberately not in NEVER_NEGATIVE: a company that has distributed more
  // than it ever earned carries a deficit, and Apple's is minus 14bn.
  retainedEarnings: { namespace: "us-gaap", tags: ["RetainedEarningsAccumulatedDeficit"], unit: "currency" },
  researchAndDevelopment: { namespace: "us-gaap", tags: ["ResearchAndDevelopmentExpense"], unit: "currency" },
  sellingGeneralAndAdministrative: { namespace: "us-gaap", tags: ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"], unit: "currency" },
  operatingExpenses: { namespace: "us-gaap", tags: ["OperatingExpenses"], unit: "currency" },
  otherIncomeExpense: { namespace: "us-gaap", tags: ["NonoperatingIncomeExpense"], unit: "currency" },
};

function sourceUrl(cik: string, accession: string) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/`;
}

function extractFacts(
  namespaces: z.infer<typeof SecResponseSchema>["facts"],
  cik: string,
  currency: string,
  retrievedAt: string,
) {
  const output: RawFinancialFact[] = [];
  for (const [metric, spec] of Object.entries(SEC_CONCEPTS) as Array<[keyof typeof SEC_CONCEPTS, ConceptSpec]>) {
    const namespace = namespaces[spec.namespace] ?? {};
    // Insert fallbacks first so the first (preferred) taxonomy concept wins
    // when filing date and period end are otherwise identical.
    for (const tag of [...spec.tags].reverse()) {
      const node = namespace[tag];
      if (!node) continue;
      const unitKey = spec.unit === "shares" ? "shares" : spec.unit === "perShare" ? `${currency}/shares` : currency;
      const unitFacts: SecUnit[] = node.units[unitKey] ?? [];
      for (const fact of unitFacts) {
        // A foreign private issuer files a 20-F rather than a 10-K, and no
        // quarterly report at all. Reading only the domestic pair meant ASML —
        // 623 US GAAP concepts, every one of them on Form 20-F — normalized to
        // nothing and was served as an empty company with a 200 status.
        if ((fact.form !== "10-Q" && !isAnnualForm(fact.form)) || fact.fy == null || !["Q1", "Q2", "Q3", "FY"].includes(fact.fp ?? "")) continue;
        output.push({
          metric, value: fact.val, currency, unit: spec.unit === "perShare" ? "currency" : spec.unit, start: fact.start, end: fact.end,
          filed: fact.filed, accession: fact.accn, fiscalYear: fact.fy,
          fiscalPeriod: fact.fp as RawFinancialFact["fiscalPeriod"], form: fact.form as RawFinancialFact["form"],
          concept: `${spec.namespace}:${tag}`, sourceUrl: sourceUrl(cik, fact.accn), retrievedAt,
        });
      }
    }
  }
  return output;
}

/**
 * Recovers a diluted share count for filers that publish none directly.
 *
 * Diluted earnings per share is *defined* as net income over diluted shares, so
 * dividing one reported fact by the other returns the denominator the filer
 * used. This is arithmetic on published figures, not an estimate, and it is
 * marked calculated with its formula like any other derived value.
 *
 * It matters for companies with several share classes: they tag each class
 * separately, and the SEC's companyfacts endpoint carries only facts without
 * dimensions, so no combined share count reaches us. Alphabet is the case in
 * point — four usable years directly, twelve once EPS is used.
 */
function recoverDilutedShares(periods: FinancialPeriod[]): FinancialPeriod[] {
  return periods.map((period) => {
    if (period.facts.dilutedShares?.value != null) return period;
    const netIncome = period.facts.netIncome;
    const eps = period.facts.dilutedEpsReported;
    if (!netIncome?.value || !eps?.value || eps.periodEnd !== period.periodEnd) return period;
    const shares = netIncome.value / eps.value;
    if (!Number.isFinite(shares) || shares <= 0) return period;
    return { ...period, facts: { ...period.facts, dilutedShares: {
      metric: "dilutedShares", value: shares, currency: period.currency, unit: "shares",
      periodStart: period.periodStart, periodEnd: period.periodEnd, periodicity: period.periodicity, fiscalYear: period.fiscalYear,
      provenance: {
        provider: "Calculated", sourceUrl: eps.provenance.sourceUrl, retrievedAt: eps.provenance.retrievedAt,
        // The filing date has to travel with the recovered count. Split
        // adjustment only applies to facts filed before a split, and an EPS
        // taken from a later filing is already restated: without this, a share
        // count recovered from a post-split filing was multiplied by the split
        // a second time. It put Alphabet's 2020 count at 274 billion shares.
        accession: eps.provenance.accession, filingDate: eps.provenance.filingDate,
        concept: "DilutedSharesFromEps", status: "calculated",
        formula: "Net income / Diluted earnings per share",
        note: "The filer reports no combined diluted share count; several share classes are tagged separately and reach us only per class.",
      },
    } } };
  });
}

/**
 * Rebuilds total debt from its two halves when the filer tags no combined total.
 *
 * Most filers report the current and non-current portions of long-term debt as
 * separate line items and never publish the sum. Treating those as fallbacks
 * for one another returned whichever happened to be preferred — for Apple, the
 * 12.4bn current portion standing in for 90.7bn of borrowings. Everything built
 * on the balance sheet inherited the error: net debt read as net cash, and
 * return on invested capital came out at 247%.
 *
 * Summing them is addition on two published figures, not an estimate, so the
 * result is marked calculated and carries both source accessions.
 */
function combineDebtComponents(periods: FinancialPeriod[]): FinancialPeriod[] {
  return periods.map((period) => {
    if (period.facts.totalDebt?.value != null) return period;
    const current = period.facts.longTermDebtCurrent;
    const noncurrent = period.facts.longTermDebtNoncurrent;
    const parts = [current, noncurrent].filter((fact): fact is NonNullable<typeof fact> => fact?.value != null);
    if (!parts.length) return period;
    const base = noncurrent ?? current!;
    return { ...period, facts: { ...period.facts, totalDebt: {
      ...base, metric: "totalDebt", value: parts.reduce((sum, fact) => sum + fact.value!, 0),
      provenance: {
        ...base.provenance, provider: "Calculated", status: "calculated",
        concept: parts.map((fact) => fact.provenance.concept).join(" + "),
        formula: "Current portion of long-term debt + Non-current long-term debt",
        sourceAccessions: [...new Set(parts.map((fact) => fact.provenance.accession).filter((item): item is string => Boolean(item)))],
        note: parts.length === 1
          ? "The filer tags no combined debt total and only one portion is reported, so this is that portion alone."
          : "The filer tags no combined debt total; the two reported portions are summed.",
      },
    } } };
  });
}

/**
 * Repairs a dividend per share that the filer tags as a rate, not a total.
 *
 * Most filers tag dividends per share cumulatively: each quarter's context
 * carries the year to date, so the annual figure is the sum of the year and
 * differencing recovers each quarter. Visa does not. It tags the *quarterly
 * rate* against every context it files — 0.59 for the quarter, 0.59 for six
 * months, 0.59 for the year — which breaks the arithmetic in two places. The
 * fourth quarter comes out as the annual figure minus the third-quarter total,
 * which is zero, and the annual figure reads as one quarter's dividend.
 *
 * The signature is unmistakable: the annual tag equals the largest quarter
 * rather than their sum. When that holds, the missing quarter takes the tagged
 * rate and the year becomes the sum of its quarters — which is what the company
 * actually paid. A cumulative filer such as Apple, whose annual 1.02 is four
 * times its 0.25-ish quarters, does not match and is left alone.
 */
function reconcileDividendsPerShare(annual: FinancialPeriod[], quarterly: FinancialPeriod[]) {
  const repairedQuarters = new Map<string, number>();
  const repairedYears = new Map<number, number>();

  for (const year of annual) {
    const tagged = year.facts.dividendsPerShare?.value;
    if (tagged == null || tagged <= 0) continue;
    const quarters = quarterly.filter((period) => period.fiscalYear === year.fiscalYear);
    // Exactly four, or the sum is not the year: three quarters of a rate is a
    // three-quarter dividend, and publishing it as the annual figure would
    // understate it by a quarter.
    if (quarters.length !== 4) continue;
    const values = quarters.map((period) => period.facts.dividendsPerShare?.value ?? 0);
    // Only the quarters that came out positive count towards the signature. A
    // quarter derived by subtraction from a rate lands at zero when the tags
    // are equal and below zero when the year is tagged lower than the quarter
    // before it, and letting that negative into the sum hides the very pattern
    // it is evidence of.
    const usable = values.map((value) => Math.max(0, value));
    const largest = Math.max(...usable);
    const total = usable.reduce((sum, value) => sum + value, 0);
    // A cumulative tag sums to itself; a rate tag equals one quarter of it.
    const looksLikeRate = largest > 0 && Math.abs(tagged - largest) <= largest * .01 && total > tagged * 1.5;
    if (!looksLikeRate) continue;
    let repairedTotal = 0;
    for (const [index, quarter] of quarters.entries()) {
      const value = values[index] > 0 ? values[index] : tagged;
      if (values[index] <= 0) repairedQuarters.set(quarter.periodEnd, value);
      repairedTotal += value;
    }
    repairedYears.set(year.fiscalYear, repairedTotal);
  }

  const note = "The filer tags the same per-share rate against every context, so the year is the sum of its quarters rather than the tagged figure.";
  const rewrite = (period: FinancialPeriod, value: number): FinancialPeriod => {
    const existing = period.facts.dividendsPerShare;
    const base = existing ?? period.facts.dividendsPaid;
    if (!base) return period;
    return { ...period, facts: { ...period.facts, dividendsPerShare: {
      ...base, metric: "dividendsPerShare", value, unit: "currency",
      provenance: { ...base.provenance, provider: "Calculated", status: "calculated", formula: SUMMED_DIVIDEND_FORMULA, note },
    } } };
  };

  return {
    annual: annual.map((period) => repairedYears.has(period.fiscalYear) ? rewrite(period, repairedYears.get(period.fiscalYear)!) : period),
    quarterly: quarterly.map((period) => repairedQuarters.has(period.periodEnd) ? rewrite(period, repairedQuarters.get(period.periodEnd)!) : period),
    // True once any year has shown the signature. It never removes a reported
    // figure — one ambiguous year should not condemn a decade, and MSCI's first
    // dividend year looks exactly like a rate — but it does close the share
    // recovery on the years this filer leaves unprovable.
    ratesSeen: repairedYears.size > 0,
  };
}

/** The marker a repaired dividend carries, and the only one safe to divide by. */
const SUMMED_DIVIDEND_FORMULA = "Sum of the quarterly declared rates";

/**
 * Recovers a share count from the dividend, for filers that publish neither a
 * share count nor an earnings per share this endpoint can see.
 *
 * Visa is the case. It has three share classes, tags every per-class figure
 * with a dimension, and the SEC's companyfacts endpoint carries only
 * undimensioned facts — so there is no weighted-average share count and no
 * diluted EPS to divide into. Every per-share metric for one of the largest
 * companies in the watchlist was simply unavailable.
 *
 * But the total dividend paid and the dividend per share are both published
 * without dimensions, and one divided by the other is the number of shares that
 * dividend was paid on. That is arithmetic on two reported figures, like the
 * earnings recovery beside it, and it lands within a third of a percent of the
 * count Visa states in its own filings.
 *
 * It is a last resort: a directly reported count wins, then the earnings
 * recovery, then this.
 */
function recoverSharesFromDividends(periods: FinancialPeriod[], ratesSeen: boolean): FinancialPeriod[] {
  return periods.map((period) => {
    if (period.facts.dilutedShares?.value != null) return period;
    const paid = period.facts.dividendsPaid; const perShare = period.facts.dividendsPerShare;
    if (paid?.value == null || perShare?.value == null || perShare.value <= 0 || paid.value <= 0) return period;
    // Only a dividend proven to cover the whole period may be divided into the
    // cash paid over it. Visa tags the same quarterly rate against its annual
    // context, so dividing by the tag as filed would report four times the real
    // share count — wrong in a way that looks entirely plausible. A rate that
    // has been rebuilt from its quarters carries this marker; a native annual
    // total needs no repair and is trusted as filed.
    const summed = perShare.provenance.formula === SUMMED_DIVIDEND_FORMULA;
    if (period.periodicity === "annual" && ratesSeen && !summed) return period;
    const shares = paid.value / perShare.value;
    if (!Number.isFinite(shares) || shares <= 0) return period;
    return { ...period, facts: { ...period.facts, dilutedShares: {
      metric: "dilutedShares", value: shares, currency: period.currency, unit: "shares",
      periodStart: period.periodStart, periodEnd: period.periodEnd, periodicity: period.periodicity,
      fiscalYear: period.fiscalYear, fiscalQuarter: period.fiscalQuarter,
      provenance: {
        provider: "Calculated", sourceUrl: paid.provenance.sourceUrl, retrievedAt: paid.provenance.retrievedAt,
        accession: paid.provenance.accession, filingDate: paid.provenance.filingDate,
        concept: "SharesFromDividendsPaid", status: "calculated",
        formula: "Dividends paid / Dividends per share",
        note: "The filer publishes no combined share count and no diluted earnings per share; both are tagged per share class and reach us only per class. This is the count the dividend was paid on.",
      },
    } } };
  });
}

/**
 * The currency a filer actually reports in.
 *
 * Every monetary fact is filed under a unit key that is its ISO currency code,
 * and the extractor asks for exactly one of them. A company resolved from the
 * SEC's ticker registry is assumed to report in dollars, because that registry
 * says nothing about currency — so ASML, which files 623 US GAAP concepts on
 * Form 20-F and reports every one of them in euros, matched nothing at all and
 * came back as a company with no financial statements.
 *
 * The most-used monetary unit is the answer, and the declared one only where
 * the filer publishes no monetary facts at all. Preferring the declared
 * currency whenever it appears at all is not good enough: ASML files five
 * dollar amounts — hedging notionals and purchase commitments — among nine
 * thousand eight hundred euro ones, and those five were enough to keep
 * choosing dollars and finding nothing. A domestic filer's dominant unit is
 * the dollar, so nothing about them changes.
 *
 * `shares`, `pure` and `EUR/shares` are not currencies and are excluded by
 * shape.
 */
function reportingCurrency(namespaces: z.infer<typeof SecResponseSchema>["facts"], declared: string): string {
  const counts = new Map<string, number>();
  for (const node of Object.values(namespaces["us-gaap"] ?? {})) {
    for (const [unit, facts] of Object.entries(node.units)) {
      if (!/^[A-Z]{3}$/.test(unit)) continue;
      counts.set(unit, (counts.get(unit) ?? 0) + facts.length);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? declared;
}

export function normalizeSecPayload(payload: unknown, ticker: string, retrievedAt = new Date().toISOString(), resolvedCompany?: CompanyDataset["company"]): CompanyDataset {
  const resolved = resolvedCompany ?? COMPANIES.find((item) => item.ticker === ticker.toUpperCase());
  if (!resolved) throw new Error("Ticker not supported by the SEC adapter registry.");
  if (!resolved.cik) throw new Error(resolved.resolutionNote || "No reliable regulatory identifier is available for this instrument.");
  const parsed = SecResponseSchema.parse(payload);
  const currency = reportingCurrency(parsed.facts, resolved.currency);
  const company = currency === resolved.currency ? resolved : { ...resolved, currency };
  const rawFacts = extractFacts(parsed.facts, company.cik, company.currency, retrievedAt);
  // Order matters. The dividend rate is repaired first, because the share
  // recovery divides by it; the recovery runs before split adjustment, so the
  // count it produces is on the as-filed basis every other share fact starts
  // from and gets adjusted exactly once.
  const reconciled = reconcileDividendsPerShare(
    combineDebtComponents(recoverDilutedShares(normalizeAnnualPeriods(rawFacts, company.currency))),
    combineDebtComponents(recoverDilutedShares(normalizeQuarterlyPeriods(rawFacts, company.currency))),
  );
  const annual = adjustPeriodsForSplits(recoverSharesFromDividends(reconciled.annual, reconciled.ratesSeen), company.stockSplits);
  const quarterly = adjustPeriodsForSplits(recoverSharesFromDividends(reconciled.quarterly, reconciled.ratesSeen), company.stockSplits);
  const ttm = buildTtmPeriods(quarterly, company.currency);

  /*
   * A company with nothing in it is a failure, not an answer.
   *
   * This used to return an empty dataset with a 200, so the application had no
   * error to report and simply drew a company with no figures anywhere — which
   * is what "the search finds it but then there is no data" was. Two filers
   * reach here that way: one whose facts are all on a form we did not read, and
   * one that reports under IFRS, where not a single concept in this adapter's
   * map exists. Both are now said out loud.
   */
  if (!annual.length && !quarterly.length) {
    const spaces = Object.keys(parsed.facts);
    throw new Error(spaces.includes("ifrs-full") && !spaces.includes("us-gaap")
      ? `${parsed.entityName} reports under IFRS rather than US GAAP. FinScope reads US GAAP concepts, so this filer's statements cannot be normalized yet.`
      : `No standardized US GAAP facts were found for ${parsed.entityName} on Forms 10-K, 10-Q, 20-F or 40-F.`);
  }

  return validateCompanyDataset({
    company: { ...company, name: parsed.entityName }, periods: [...annual, ...quarterly, ...ttm], retrievedAt,
    warnings: [
      "Quarterly cash-flow facts may be isolated from year-to-date disclosures; every derived quarter is marked calculated with its source accessions.",
      ttm.length ? `TTM is available through ${ttm.at(-1)!.periodEnd} from four consecutive fiscal quarters.`
        : quarterly.length ? "TTM unavailable: four consecutive reliable quarters were not found."
        : "This filer publishes an annual report only — a foreign private issuer files no quarterly report with the SEC — so quarterly and trailing-twelve-month views are empty by construction rather than by failure.",
      "Standardized concepts only: company extensions and non-GAAP values remain separate and are not imputed.",
      ...(company.currency === "USD" ? [] : [
        // Stated rather than converted. An exchange rate applied silently to a
        // filed figure is the kind of quiet estimate this application exists
        // not to make, and a multiple that divides a dollar price by a euro
        // profit is wrong in a way that looks entirely plausible.
        `${company.name} reports in ${company.currency} while its shares are quoted in the currency of their listing. Statements are shown as filed and are not converted; any figure combining a price with a filed amount — market capitalisation, and every valuation multiple — mixes two currencies and should not be relied on for this company.`,
      ]),
    ],
  });
}

export async function fetchSecCompany(ticker: string): Promise<CompanyDataset> {
  const company = COMPANIES.find((item) => item.ticker === ticker.toUpperCase()) ?? await resolveSecCompany(ticker);
  if (!company.cik) throw new Error(company.resolutionNote || "No reliable regulatory identifier is available for this instrument.");
  const retrievedAt = new Date().toISOString();
  const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json`, {
    headers: { "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com", Accept: "application/json" },
    next: { revalidate: 21_600 },
  });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  return normalizeSecPayload(await response.json(), ticker, retrievedAt, company);
}

interface SecTickerEntry { cik_str: number; ticker: string; title: string }
export async function searchSecCompanies(query: string) {
  const response = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com" }, next: { revalidate: 86_400 } });
  if (!response.ok) throw new Error(`SEC company registry returned ${response.status}.`);
  const entries = Object.values(await response.json() as Record<string, SecTickerEntry>); const needle = query.trim().toUpperCase();
  return entries.filter((entry) => entry.ticker.includes(needle) || entry.title.toUpperCase().includes(needle)).slice(0, 12).map((entry) => ({ name: entry.title, ticker: entry.ticker, cik: String(entry.cik_str).padStart(10,"0"), regulatoryId: `CIK ${String(entry.cik_str).padStart(10,"0")}`, exchange: "US listing", currency: "USD", yahooTicker: entry.ticker, sector: "Unclassified", description: "Dynamically resolved from the SEC company registry.", resolutionStatus: "partial" as const, resolutionNote: "The CIK is verified by the SEC. The exchange listing and the split history are not, so long per-share price series for this company are unadjusted.", businessType: "operating" as const }));
}
async function resolveSecCompany(ticker: string) {
  const results = await searchSecCompanies(ticker); const exact = results.find((entry) => entry.ticker === ticker.toUpperCase());
  if (!exact) throw new Error("Ticker could not be resolved uniquely in the SEC registry.");
  return exact;
}

const SubmissionsSchema = z.object({
  cik: z.union([z.string(), z.number()]).optional(),
  filings: z.object({
    recent: z.object({
      form: z.array(z.string()),
      filingDate: z.array(z.string()),
      reportDate: z.array(z.string()),
      accessionNumber: z.array(z.string()).optional(),
    }),
  }),
});

/** The periodic reports a checkup cares about; an 8-K is news, not a statement. */
const PERIODIC = new Set(["10-K", "10-Q", "20-F", "40-F"]);

export interface LatestFiling {
  form: string;
  /** When the company filed it. */
  filingDate: string;
  /** The period it reports on, which is what a dataset can be compared against. */
  reportDate: string;
  accession?: string;
}

/**
 * The most recent periodic report this company has filed, from the SEC itself.
 *
 * This is the only way to answer "is what we hold the latest there is" without
 * trusting our own cache to tell us about its own staleness — which is exactly
 * the reasoning that let Veeva's results sit unseen for days. The submissions
 * document is a couple of hundred kilobytes and carries the form, the filing
 * date and the period each report covers, so the comparison is against the
 * company's own calendar rather than against a clock.
 */
export async function fetchLatestFiling(cik: string): Promise<LatestFiling | null> {
  const padded = cik.padStart(10, "0");
  const response = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: { "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com", Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  const recent = SubmissionsSchema.parse(await response.json()).filings.recent;
  let best: LatestFiling | null = null;
  for (let index = 0; index < recent.form.length; index++) {
    if (!PERIODIC.has(recent.form[index])) continue;
    const candidate: LatestFiling = {
      form: recent.form[index],
      filingDate: recent.filingDate[index],
      reportDate: recent.reportDate[index],
      accession: recent.accessionNumber?.[index],
    };
    // Ordered newest first in practice, but compared rather than assumed: an
    // amendment can be filed out of order and a checkup must not be fooled.
    if (!best || candidate.reportDate > best.reportDate) best = candidate;
  }
  return best;
}
