import { z } from "zod";
import { COMPANIES } from "../company-registry";
import { adjustPeriodsForSplits, buildTtmPeriods, isAnnualForm, normalizeAnnualPeriods, normalizeQuarterlyPeriods } from "../periods";
import { validateCompanyDataset } from "../data-quality";
import { businessTypeFromSic, classifyBusiness, verifiedBusinessType } from "../business-type";
import type { BusinessType, CompanyDataset, FinancialPeriod, MetricKey, NormalizedFact, RawFinancialFact } from "../types";

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
type ConceptSpec = {
  namespace: "us-gaap" | "dei"; tags: string[]; unit: "currency" | "shares" | "perShare";
  /** Further taxonomies to try, in preference order after `tags`. */
  also?: Array<{ namespace: "us-gaap" | "dei"; tags: string[] }>;
};

export const SEC_CONCEPTS: Record<Exclude<MetricKey, "freeCashFlow" | "netShareRepurchases">, ConceptSpec> = {
  // Financial institutions commonly state the top line net of interest expense
  // rather than under generic Revenues. It is a fallback only: an industrial
  // filer's contract/total revenue concepts retain their existing preference.
  revenue: { namespace: "us-gaap", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenuesNetOfInterestExpense"], unit: "currency" },
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
  /*
   * Tags are alternatives in preference order, not addends.
   *
   * The middle two cover filers that report no property-and-equipment line at
   * all: Cboe and Interactive Brokers use the net productive-assets concept,
   * and Veeva stopped tagging property purchases after FY2020 and now reports
   * only capitalized software. Without them free cash flow simply stopped.
   *
   * The last two came out of a sweep of 110 filers, which found ten companies
   * publishing an operating cash flow this adapter could read and a capital
   * expenditure it could not. Eli Lilly tags its property purchases under the
   * "other" variant, and a property company spends through capital
   * improvements rather than acquisitions — Douglas Emmett has no free cash
   * flow at all without it.
   *
   * `PaymentsToAcquireIntangibleAssets` was considered and rejected. It is the
   * only capital line Alibaba tags here, but intangible purchases are not
   * property spending: reading them as the whole of capital expenditure would
   * understate what the company actually spends and overstate the cash it
   * keeps. A stated gap is better than a plausible wrong number.
   *
   * ConocoPhillips and Phillips 66 remain without one, and nothing here can
   * fix that: both report capital expenditure only as a company extension,
   * which this endpoint does not carry.
   */
  capitalExpenditures: { namespace: "us-gaap", tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForProceedsFromProductiveAssets", "PaymentsForSoftware", "PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsForCapitalImprovements"], unit: "currency" },
  acquisitions: { namespace: "us-gaap", tags: ["PaymentsToAcquireBusinessesNetOfCashAcquired", "PaymentsToAcquireBusinessesGross"], unit: "currency" },
  dividendsPaid: { namespace: "us-gaap", tags: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsOfOrdinaryDividends"], unit: "currency" },
  dilutedShares: { namespace: "us-gaap", tags: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"], unit: "shares" },
  // Only used to recover a share count when the filer publishes none directly.
  dilutedEpsReported: { namespace: "us-gaap", tags: ["EarningsPerShareDiluted"], unit: "perShare" },
  basicShares: { namespace: "us-gaap", tags: ["WeightedAverageNumberOfSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"], unit: "shares" },
  /*
   * The count of shares in issue at a stated point in time.
   *
   * Two concepts carry it and only the cover-page one was read. That one is
   * dated as of the day stated on the cover — Apple's is 17 October against a
   * 27 September year end. It used to be thrown away because point facts were
   * anchored only to the fiscal close. Six of the seven companies in the data
   * audit then had no share count at all, and market capitalisation silently
   * fell back to the diluted weighted average: 1.6% away from Apple's real
   * count, 3.2% from JPMorgan's, 4.4% from Rivian's.
   *
   * `us-gaap:CommonStockSharesOutstanding` is the balance-sheet parenthetical,
   * instant-dated at the period end, and it is exactly the 14,773,260,000
   * shares Apple states. It leads; the cover-page count is attached only to
   * the same accession, kept on its real observation date and labelled as the
   * fallback for filers that publish no parenthetical. Filers with several
   * share classes tag both per class, so they reach this endpoint through
   * neither — which is why the diluted fallback survives, now labelled rather
   * than silent.
   */
  sharesOutstanding: { namespace: "us-gaap", tags: ["CommonStockSharesOutstanding"], unit: "shares", also: [{ namespace: "dei", tags: ["EntityCommonStockSharesOutstanding"] }] },
  sharesIssued: { namespace: "us-gaap", tags: ["CommonStockSharesIssued"], unit: "shares" },
  treasuryShares: { namespace: "us-gaap", tags: ["TreasuryStockShares"], unit: "shares" },
  stockBasedCompensation: { namespace: "us-gaap", tags: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"], unit: "currency" },
  shareRepurchases: { namespace: "us-gaap", tags: ["PaymentsForRepurchaseOfCommonStock"], unit: "currency" },
  shareIssuance: { namespace: "us-gaap", tags: ["ProceedsFromStockOptionsExercised", "ProceedsFromIssuanceOfCommonStock", "ProceedsFromIssuanceOfSharesUnderIncentiveAndShareBasedCompensationPlansIncludingStockOptions"], unit: "currency" },
  cashAndEquivalents: { namespace: "us-gaap", tags: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], unit: "currency" },
  // A true all-debt concept only. Long-term aggregates and short-term
  // borrowings are extracted separately below: JPM publishes both and calling
  // the former "total debt" omitted 64.8bn from the same balance sheet.
  totalDebt: { namespace: "us-gaap", tags: ["DebtLongtermAndShorttermCombinedAmount"], unit: "currency" },
  // `DebtCurrent` is the broad balance-sheet total for debt due within a year:
  // short-term borrowings *and* the current maturities of long-term debt. It is
  // therefore a synonym for the current portion, never an addend beside it —
  // NVIDIA files 999m under both concepts for the same date, and treating the
  // second as separate short-term borrowing reported 9,467m of debt against the
  // 8,468m its own long-term-debt tag states.
  longTermDebtCurrent: { namespace: "us-gaap", tags: ["LongTermDebtCurrent", "DebtCurrent"], unit: "currency" },
  // `LongTermDebtAndCapitalLeaseObligations` is the same balance with finance
  // leases folded in, and for many filers it is the only non-current figure in
  // the quarterly statements — Home Depot and AbbVie tag nothing else at their
  // latest balance-sheet date.
  longTermDebtNoncurrent: { namespace: "us-gaap", tags: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"], unit: "currency" },
  longTermDebtAndLeases: { namespace: "us-gaap", tags: ["LongTermDebtAndFinanceLeaseObligationsCurrentAndNoncurrent", "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities"], unit: "currency" },
  otherLongTermDebt: { namespace: "us-gaap", tags: ["LongTermDebt", "ConvertibleLongTermNotesPayable", "UnsecuredLongTermDebt", "NotesPayable"], unit: "currency" },
  // A validation anchor, not a total-debt fallback. Its gross amount can prove
  // whether a filer's ambiguous `LongTermDebt` line is non-current: when gross
  // debt agrees with LongTermDebt + current debt, but not with LongTermDebt on
  // its own, the two balance-sheet lines are demonstrably non-overlapping.
  debtInstrumentCarryingAmount: { namespace: "us-gaap", tags: ["DebtInstrumentCarryingAmount"], unit: "currency" },
  // Borrowing that is not the current maturity of long-term debt: commercial
  // paper, bank lines, overdrafts. Genuinely additive to a long-term balance,
  // which is what makes JPMorgan's 64.8bn belong beside its 435.2bn.
  shortTermBorrowings: { namespace: "us-gaap", tags: ["ShortTermBorrowings", "OtherShortTermBorrowings"], unit: "currency" },
  financeLeaseLiability: { namespace: "us-gaap", tags: ["FinanceLeaseLiability"], unit: "currency" },
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
    // One flat preference order across taxonomies: a metric may be tagged in
    // us-gaap by one filer and in dei by another.
    const candidates = [{ namespace: spec.namespace, tags: spec.tags }, ...(spec.also ?? [])]
      .flatMap((source) => source.tags.map((tag) => ({ space: source.namespace, tag })));
    // Insert fallbacks first so the first (preferred) taxonomy concept wins
    // when filing date and period end are otherwise identical.
    for (const { space, tag } of candidates.reverse()) {
      const namespace = namespaces[space] ?? {};
      const node = namespace[tag];
      if (!node) continue;
      const unitKey = spec.unit === "shares" ? "shares" : spec.unit === "perShare" ? `${currency}/shares` : currency;
      const unitFacts: SecUnit[] = node.units[unitKey] ?? [];
      for (const fact of unitFacts) {
        // A foreign private issuer files a 20-F rather than a 10-K, and no
        // quarterly report at all. Reading only the domestic pair meant ASML —
        // 623 US GAAP concepts, every one of them on Form 20-F — normalized to
        // nothing and was served as an empty company with a 200 status.
        const fiscalPeriod = fact.fp === "Q4" && isAnnualForm(fact.form) ? "FY" : fact.fp;
        /*
         * Some annual filings label the whole filing — including its annual
         * fact and the comparative quarters inside it — `fp: "Q4"` rather
         * than `fp: "FY"`. Mastercard's 2019 10-K does exactly that for the
         * restated 2017 revenue quarters. Dropping Q4 therefore removed two
         * reported quarters and five trailing windows even though the values
         * were present in Company Facts. Within an annual form Q4 has the same
         * filing-context role as FY; duration still distinguishes a quarter
         * from a full year later in the normalizer.
         */
        if ((fact.form !== "10-Q" && !isAnnualForm(fact.form)) || fact.fy == null || !["Q1", "Q2", "Q3", "FY"].includes(fiscalPeriod ?? "")) continue;
        output.push({
          metric, value: fact.val, currency, unit: spec.unit === "perShare" ? "currency" : spec.unit, start: fact.start, end: fact.end,
          filed: fact.filed, accession: fact.accn, fiscalYear: fact.fy,
          fiscalPeriod: fiscalPeriod as RawFinancialFact["fiscalPeriod"], form: fact.form as RawFinancialFact["form"],
          concept: `${space}:${tag}`, sourceUrl: sourceUrl(cik, fact.accn), retrievedAt,
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
function combinedDebtFact(parts: NormalizedFact[], formula: string, note: string): NormalizedFact {
  const base = parts[0];
  const calculated = parts.length > 1;
  return {
    ...base,
    metric: "totalDebt",
    value: parts.reduce((sum, fact) => sum + fact.value!, 0),
    provenance: {
      ...base.provenance,
      provider: calculated ? "Calculated" : base.provenance.provider,
      status: calculated ? "calculated" : base.provenance.status,
      concept: parts.map((fact) => fact.provenance.concept).join(" + "),
      formula: calculated ? formula : base.provenance.formula,
      sourceAccessions: [...new Set(parts.map((fact) => fact.provenance.accession).filter((item): item is string => Boolean(item)))],
      note,
    },
  };
}

type AmbiguousLongTermRole = "noncurrent" | "includes-current";

/**
 * `LongTermDebt` is used inconsistently in real filings: NVIDIA uses it for an
 * all-in long-term total, while Adobe uses it for the non-current balance-sheet
 * line. Guessing the role either double-counts one filer or drops current debt
 * for the other.
 *
 * `DebtInstrumentCarryingAmount` provides independent evidence. Gross and net
 * debt can differ slightly through discounts and issuance costs; within 3% is
 * accepted as a reconciliation, and one interpretation must beat the other by
 * at least 2 percentage points. Conflicting or weak evidence yields no role and
 * preserves fail-closed behavior.
 */
function ambiguousLongTermRole(periods: FinancialPeriod[]): AmbiguousLongTermRole | null {
  const votes: AmbiguousLongTermRole[] = [];
  for (const period of periods) {
    const current = period.facts.longTermDebtCurrent?.value;
    const longTerm = period.facts.otherLongTermDebt?.value;
    const gross = period.facts.debtInstrumentCarryingAmount?.value;
    if (current == null || current <= 0 || longTerm == null || longTerm <= 0 || gross == null || gross <= 0) continue;
    const scale = Math.max(Math.abs(gross), 1);
    const standaloneDistance = Math.abs(gross - longTerm) / scale;
    const summedDistance = Math.abs(gross - (longTerm + current)) / scale;
    if (summedDistance <= .03 && standaloneDistance - summedDistance >= .02) votes.push("noncurrent");
    else if (standaloneDistance <= .03 && summedDistance - standaloneDistance >= .02) votes.push("includes-current");
  }
  if (!votes.length) return null;
  return votes.every((vote) => vote === votes[0]) ? votes[0] : null;
}

function combineDebtComponents(periods: FinancialPeriod[], businessType: BusinessType | undefined): FinancialPeriod[] {
  const longTermRole = ambiguousLongTermRole(periods);
  return periods.map((period) => {
    if (period.facts.totalDebt?.value != null) return period;
    const current = period.facts.longTermDebtCurrent;
    const noncurrent = period.facts.longTermDebtNoncurrent;
    const longTermCombined = period.facts.longTermDebtAndLeases;
    const otherLongTerm = period.facts.otherLongTermDebt;
    const shortTerm = period.facts.shortTermBorrowings;
    const financeLease = period.facts.financeLeaseLiability;

    let parts: NormalizedFact[] = [];
    let formula = "";
    /** Said on the figure when the reading is known to leave a category out. */
    let excludes = "";
    if (current?.value != null && noncurrent?.value != null) {
      parts = [current, noncurrent];
      formula = "Current portion of long-term debt + Non-current long-term debt";
      // A separately filed short-term borrowing is additive to the two
      // long-term portions. Its absence is not read as zero.
      //
      // Unless the current side is the broad `DebtCurrent` total, which already
      // contains short-term borrowing as well as current maturities: adding the
      // narrower line to it would count that borrowing twice.
      const currentIsBroad = current.provenance.concept === "us-gaap:DebtCurrent";
      if (shortTerm?.value != null && !currentIsBroad) { parts.push(shortTerm); formula += " + Short-term borrowings"; }
    } else if (longTermCombined?.value != null) {
      parts = [longTermCombined];
      formula = "Long-term debt and lease obligations, current and non-current";
      if (shortTerm?.value != null) { parts.push(shortTerm); formula += " + Short-term borrowings"; }
      // Banks explicitly publish short-term borrowings alongside this
      // aggregate. Their absence cannot be read as a filed zero.
      else if (businessType === "bank") return period;
    } else if (otherLongTerm?.value != null && current?.value != null && longTermRole === "noncurrent") {
      // The independent gross carrying amount proves that this filer's
      // ambiguous LongTermDebt concept is its non-current balance-sheet line.
      // Adobe's Q1 reconciliation establishes the role for its later quarter:
      // 4.802bn non-current + 1.843bn current = 6.645bn total debt.
      parts = [otherLongTerm, current];
      formula = "Reported non-current long-term debt + Current debt, role validated against gross debt carrying amount";
      const currentIsBroad = current.provenance.concept === "us-gaap:DebtCurrent";
      if (shortTerm?.value != null && !currentIsBroad) { parts.push(shortTerm); formula += " + Short-term borrowings"; }
    } else if (otherLongTerm?.value != null && shortTerm?.value != null) {
      // LongTermDebt and UnsecuredLongTermDebt explicitly exclude short-term
      // borrowing. They only become a total when the matching short-term line
      // exists on the same balance-sheet date.
      parts = [otherLongTerm, shortTerm];
      formula = "Reported long-term debt + Short-term borrowings";
      if (financeLease?.value != null) { parts.push(financeLease); formula += " + Finance lease liability"; }
    } else if (noncurrent?.value != null && shortTerm?.value != null) {
      // The non-current balance beside a separately filed short-term one, which
      // is what Caterpillar and AbbVie publish and what no branch above reads.
      parts = [noncurrent, shortTerm];
      formula = "Non-current long-term debt + Short-term borrowings";
      excludes = "Current maturities of long-term debt are not separately tagged at this date and are not included.";
    } else if (otherLongTerm?.value != null && current?.value === 0) {
      /*
       * A filed zero closes the balance sheet.
       *
       * `LongTermDebt` is the whole long-term balance including its current
       * maturities, so a current-debt line filed at zero says two things at
       * once: nothing matures within the year, and there is no short-term
       * borrowing either — `DebtCurrent` covers both. The long-term figure is
       * then the entire borrowing, proved rather than assumed. Adobe files
       * exactly this: 6.21bn of long-term debt against a stated zero, and its
       * invested capital was withheld for want of a number it had published.
       *
       * A non-zero current line cannot be added here: it overlaps the current
       * maturities already inside the long-term figure, and the filing does not
       * say by how much.
       */
      parts = [otherLongTerm, current];
      formula = "Reported long-term debt, with current debt filed as zero";
    }
    /*
     * The most complete filed reading, rather than nothing at all.
     *
     * A sweep of 110 US filers on 1 September found 27% with no debt total —
     * Meta, Home Depot, Caterpillar, McDonald's, Thermo Fisher among them. None
     * of them is debt-free. Each publishes a borrowing balance; what none of
     * them publishes is the *pair* the rules above insist on, because a filer
     * with no short-term facility tags no short-term line and one whose debt is
     * all long-dated tags no current portion.
     *
     * Refusing those is not caution, it is a third of the market missing its
     * leverage. So a single filed long-term balance is read as the debt total,
     * and what that reading leaves out is said on the figure rather than left
     * for the reader to discover. Nothing is assumed to be zero and nothing is
     * summed across concepts that overlap; the difference from before is only
     * that one filed number is allowed to stand alone.
     */
    if (!parts.length && otherLongTerm?.value != null) {
      parts = [otherLongTerm];
      formula = "Long-term debt as filed, including current maturities";
      excludes = "The filer tags no separate short-term borrowing at this date, so any is not included.";
    }
    if (!parts.length && noncurrent?.value != null) {
      parts = [noncurrent];
      formula = "Non-current long-term debt as filed";
      excludes = "Current maturities and short-term borrowing are not separately tagged at this date and are not included.";
    }
    if (!parts.length) return period;
    // A single filed balance is not a calculation, so it keeps its own
    // provenance and the note carries what it is; a sum says how it was made.
    const note = [
      parts.length > 1
        ? "Only simultaneously reported, non-overlapping borrowing components are summed; an absent component is never treated as zero."
        : `${formula}.`,
      excludes,
    ].filter(Boolean).join(" ");
    const totalDebt = combinedDebtFact(parts, formula, note);
    return { ...period, facts: { ...period.facts, totalDebt } };
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

/**
 * The splits a filer declares itself.
 *
 * Share counts are filed on the basis of the day they were filed, so a split
 * leaves every earlier count incomparable with every later one until it is
 * restated onto today's basis. That restatement used to come from one place: a
 * list kept by hand in the company registry, covering the twenty-one companies
 * on the built-in watchlist and nothing else. So Amazon, reached by typing its
 * ticker, showed 504 million shares for 2019 and 10.2 billion for 2020, and
 * every per-share figure before the split was twenty times too large — its 2019
 * earnings per share read $22.99 beside 2020's $2.09, and the ten-year growth
 * of cash per share came out as a collapse.
 *
 * Filers publish the event themselves.
 * `StockholdersEquityNoteStockSplitConversionRatio1` carries the ratio in an
 * instant context on the date it took effect; Amazon's is 20 on 27 May 2022.
 * Reading it makes the correction work for any company rather than for a
 * curated list, and it is a filed fact like any other rather than a jump
 * inferred from the numbers.
 *
 * A declared ratio is a candidate, not an instruction. Filers tag it against
 * far more contexts than the event deserves — Tesla carries one against every
 * quarter end it has closed since, fifteen of them — and taking each at face
 * value multiplied its share history into nothing. Alphabet declares the
 * announcement and the effective date a fortnight apart, which applied a
 * twenty-for-one split twice. So each candidate has to explain a discontinuity
 * that is actually in the data before it is applied; see `confirmedStockSplits`.
 *
 * Only forward splits are read. A reverse split is tagged as the ratio by some
 * filers and as its reciprocal by others, and applying one the wrong way up
 * would be far worse than leaving it alone; those companies keep the behaviour
 * they have until the direction can be established from the filing itself.
 */
const SPLIT_CONCEPTS = ["StockholdersEquityNoteStockSplitConversionRatio1", "StockholdersEquityNoteStockSplitConversionRatio"];

export function filedStockSplits(namespaces: z.infer<typeof SecResponseSchema>["facts"]): Array<{ date: string; ratio: number }> {
  const byDate = new Map<string, number>();
  for (const tag of SPLIT_CONCEPTS) {
    for (const fact of namespaces["us-gaap"]?.[tag]?.units?.pure ?? []) {
      // At or below one is a reverse split or a rounding artefact, and a
      // hundred-for-one split does not happen; both are left alone.
      if (!(fact.val > 1) || fact.val > 100 || !fact.end) continue;
      // The same event is repeated by every later filing that mentions it.
      byDate.set(fact.end, Math.max(byDate.get(fact.end) ?? 0, fact.val));
    }
  }
  return [...byDate].map(([date, ratio]) => ({ date, ratio })).sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * The declared splits that explain a break in this company's own share counts.
 *
 * The test of a split is not that a filer mentioned a ratio; it is that the
 * share count changes by that ratio across it. So each candidate is checked
 * against the series it claims to explain: the last year filed before the date
 * and the first filed after it must differ by the declared ratio, within the
 * few percent a year of ordinary issuance moves. Amazon's twenty-for-one is
 * confirmed by 504 million shares becoming 10.2 billion; Tesla's fourteen
 * repeats of its ratio explain nothing and are dropped, and so is the second
 * copy of Alphabet's, because by then the first has already been applied.
 *
 * Run against the series *after* the hand-verified registry splits, so a
 * company whose splits are already known finds nothing left to explain and is
 * never adjusted twice.
 */
export function confirmedStockSplits(candidates: Array<{ date: string; ratio: number }>, adjustedAnnual: FinancialPeriod[]): Array<{ date: string; ratio: number }> {
  const series = adjustedAnnual
    .map((period) => ({ filed: period.facts.dilutedShares?.provenance.filingDate ?? period.filingDate, shares: period.facts.dilutedShares?.value ?? null }))
    .filter((item): item is { filed: string; shares: number } => item.shares != null && item.shares > 0 && Boolean(item.filed))
    .sort((left, right) => left.filed.localeCompare(right.filed));
  const confirmed: Array<{ date: string; ratio: number }> = [];
  for (const candidate of [...candidates].sort((left, right) => left.date.localeCompare(right.date))) {
    const before = series.filter((item) => item.filed < candidate.date).at(-1);
    const after = series.find((item) => item.filed >= candidate.date);
    if (!before || !after) continue;
    const observed = after.shares / before.shares;
    // Everything already confirmed has been applied to the earlier side, so a
    // second candidate for the same event no longer has a break to explain.
    const outstanding = confirmed.reduce((product, event) => product * event.ratio, 1);
    if (Math.abs(observed / (candidate.ratio * outstanding) - 1) > .08) continue;
    confirmed.push(candidate);
  }
  return confirmed;
}

export function normalizeSecPayload(payload: unknown, ticker: string, retrievedAt = new Date().toISOString(), resolvedCompany?: CompanyDataset["company"]): CompanyDataset {
  const resolved = resolvedCompany ?? COMPANIES.find((item) => item.ticker === ticker.toUpperCase());
  if (!resolved) throw new Error("Ticker not supported by the SEC adapter registry.");
  if (!resolved.cik) throw new Error(resolved.resolutionNote || "No reliable regulatory identifier is available for this instrument.");
  const parsed = SecResponseSchema.parse(payload);
  const currency = reportingCurrency(parsed.facts, resolved.currency);
  const classified = classifyBusiness(resolved);
  const company = currency === classified.currency ? classified : { ...classified, currency };
  const rawFacts = extractFacts(parsed.facts, company.cik, company.currency, retrievedAt);
  // Order matters. The dividend rate is repaired first, because the share
  // recovery divides by it; the recovery runs before split adjustment, so the
  // count it produces is on the as-filed basis every other share fact starts
  // from and gets adjusted exactly once.
  const reconciled = reconcileDividendsPerShare(
    combineDebtComponents(recoverDilutedShares(normalizeAnnualPeriods(rawFacts, company.currency)), company.businessType),
    combineDebtComponents(recoverDilutedShares(normalizeQuarterlyPeriods(rawFacts, company.currency)), company.businessType),
  );
  // The hand-verified splits first; then any the filer declared that still
  // explain a break in what is left, which is what covers a company nobody
  // curated a list for.
  const verifiedAnnual = adjustPeriodsForSplits(recoverSharesFromDividends(reconciled.annual, reconciled.ratesSeen), company.stockSplits);
  const verifiedQuarterly = adjustPeriodsForSplits(recoverSharesFromDividends(reconciled.quarterly, reconciled.ratesSeen), company.stockSplits);
  const detected = confirmedStockSplits(filedStockSplits(parsed.facts), verifiedAnnual);
  const stockSplits = [...(company.stockSplits ?? []), ...detected].sort((left, right) => left.date.localeCompare(right.date));
  const annual = adjustPeriodsForSplits(verifiedAnnual, detected);
  const quarterly = adjustPeriodsForSplits(verifiedQuarterly, detected);
  const ttm = buildTtmPeriods(quarterly, company.currency);
  const identityKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const payloadIdentityMismatch = identityKey(parsed.entityName) !== identityKey(company.name);

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
    // The ticker registry binds ticker to CIK and is the identity authority.
    // Company Facts occasionally carries a subsidiary-like display name for
    // that same CIK (BAC currently says "BofA Finance LLC"). Retain the exact
    // registry/profile identity and surface the disagreement instead of
    // relabelling the requested stock.
    // The splits travel with the company, so the quality panel reports the
    // ones actually applied rather than only the hand-verified ones.
    company: { ...company, stockSplits }, periods: [...annual, ...quarterly, ...ttm], retrievedAt,
    warnings: [
      ...(payloadIdentityMismatch ? [`SEC identity mismatch: the ticker registry identifies ${company.name}, while Company Facts labels the payload ${parsed.entityName}. FinScope retains the ticker-to-CIK registry identity.`] : []),
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
        `${company.name} reports in ${company.currency} while its shares are quoted in the currency of their listing. Statements are shown as filed and are never converted, and every figure that would combine a price with a filed amount — market capitalisation, enterprise value, all valuation multiples, the dividend yield and the price comparisons in both valuation models — is withheld rather than computed across two currencies. The statements themselves, and everything derived inside them, are unaffected.`,
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
  // The registry is CIK-ordered. Prioritise an exact symbol before applying the
  // display limit, otherwise a one-letter ticker can disappear behind twelve
  // unrelated company names that happen to contain the same letter.
  return entries.filter((entry) => entry.ticker.includes(needle) || entry.title.toUpperCase().includes(needle))
    .sort((left, right) => Number(right.ticker === needle) - Number(left.ticker === needle))
    .slice(0, 12).map((entry) => {
    const cik = String(entry.cik_str).padStart(10, "0");
    return { name: entry.title, ticker: entry.ticker, cik, regulatoryId: `CIK ${cik}`, exchange: "US listing", currency: "USD", yahooTicker: entry.ticker, sector: "Unclassified", description: "Dynamically resolved from the SEC company registry.", resolutionStatus: "partial" as const, resolutionNote: "The CIK is verified by the SEC. The exchange listing and the split history are not, so long per-share price series for this company are unadjusted.", businessType: verifiedBusinessType(cik) ?? "operating" };
  });
}

const SecBusinessMetadataSchema = z.object({
  sic: z.union([z.string(), z.number()]),
  sicDescription: z.string().optional(),
});

async function resolveSecBusinessMetadata(cik: string) {
  const response = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, {
    headers: { "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com", Accept: "application/json" },
    next: { revalidate: 86_400 },
  });
  if (!response.ok) throw new Error(`SEC company classification returned ${response.status}.`);
  const parsed = SecBusinessMetadataSchema.parse(await response.json());
  const sic = typeof parsed.sic === "string" ? Number.parseInt(parsed.sic, 10) : parsed.sic;
  if (!Number.isInteger(sic)) throw new Error("The SEC company classification did not contain a valid SIC code.");
  return { sic, sicDescription: parsed.sicDescription };
}

async function resolveSecCompany(ticker: string) {
  const results = await searchSecCompanies(ticker); const exact = results.find((entry) => entry.ticker === ticker.toUpperCase());
  if (!exact) throw new Error("Ticker could not be resolved uniquely in the SEC registry.");
  // Identity is not enough: defaulting a dynamic ticker to `operating` exposes
  // industrial ROIC and FCFF for a bank or insurer. Classification failure is
  // therefore a load failure, not permission to guess the economic model.
  const metadata = await resolveSecBusinessMetadata(exact.cik);
  const businessType = verifiedBusinessType(exact.cik) ?? businessTypeFromSic(metadata.sic) ?? "operating";
  return {
    ...exact, ...metadata, businessType,
    resolutionNote: `${exact.resolutionNote} Economic model classified from SEC SIC ${metadata.sic}${metadata.sicDescription ? ` (${metadata.sicDescription})` : ""}.`,
  };
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
