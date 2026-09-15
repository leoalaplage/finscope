import { z } from "zod";
import { COMPANIES } from "../company-registry";
import { adjustPeriodsForSplits, buildTtmPeriods, isAnnualForm, normalizeAnnualPeriods, normalizeQuarterlyPeriods } from "../periods";
import { validateCompanyDataset } from "../data-quality";
import { businessTypeFromSic, cashFlowIsTheBalanceSheet, classifyBusiness, isFinancialBusiness, verifiedBusinessType } from "../business-type";
import { companySector } from "../sector";
import type { BusinessType, CompanyDataset, FinancialPeriod, MetricKey, NormalizedFact, RawFinancialFact } from "../types";
import { KNOWN_SUCCESSORS } from "../universe";
import { companyCapexLine, filingIsAhead, instanceDocument, investingLines, mergeFactTrees, parseXbrlInstance, type FactTree, type FilingFact } from "./xbrl-instance";

type FilingFactLike = FilingFact;

/** The tag a company's own capital-expenditure line is read under, in the "company" taxonomy. */
const COMPANY_CAPEX_TAG = "CapitalExpenditures";
const SEC_HEADERS = () => ({ "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com" });

const STANDARD_CAPEX_TAGS = [
  "PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForProceedsFromProductiveAssets",
  "PaymentsForSoftware", "PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsForCapitalImprovements", "PaymentsToDevelopRealEstateAssets",
  "PaymentsToAcquireRealEstate", "PaymentsToAcquireOilAndGasProperty", "PaymentsToAcquireMachineryAndEquipment", "PaymentsToAcquireOtherProductiveAssets",
  "PaymentsForConstructionInProcess", "PaymentsToExploreAndDevelopOilAndGasProperties", "PaymentsForFlightEquipment",
];

const isYear = (fact: { start?: string; end: string }) => Boolean(fact.start) && (Date.parse(fact.end) - Date.parse(fact.start!)) / 86_400_000 >= 300;

/**
 * Whether a company's own line is plausibly its whole capital expenditure.
 *
 * Compared with the largest standard annual capital expenditure it filed in
 * the three years before the line's latest year: under half of that, the line
 * is a part of the total under another name. With no such standard figure
 * there is nothing to compare, and the line stands.
 */
export function plausibleCompanyCapex(tree: FactTree, units: Record<string, Array<{ start?: string; end: string; val: number }>>): boolean {
  const ownYears = Object.values(units).flat().filter(isYear).sort((left, right) => left.end.localeCompare(right.end));
  const latest = ownYears.at(-1);
  if (!latest) return true;
  const since = new Date(Date.parse(latest.end) - 3 * 366 * 86_400_000).toISOString().slice(0, 10);
  let standard = 0;
  for (const tag of STANDARD_CAPEX_TAGS) {
    for (const facts of Object.values(tree["us-gaap"]?.[tag]?.units ?? {})) {
      for (const fact of facts) if (isYear(fact) && fact.end >= since && fact.end < latest.end) standard = Math.max(standard, Math.abs(fact.val));
    }
  }
  return standard === 0 || Math.abs(latest.val) >= 0.5 * standard;
}

/**
 * Whether the feed's newest annual capital expenditure is older than its newest annual operating cash flow.
 *
 * Ralph Lauren's and CMS Energy's latest annual reports are in Company Facts
 * with their operating cash flow and without their capital expenditure, while
 * every quarter has both — so the newest of each agrees and only the year is
 * missing, which is the figure every trailing window after it is built from.
 */
export function annualCapexBehindCashFlow(tree: FactTree): boolean {
  const newestYear = (tags: string[]) => {
    let end = "";
    for (const tag of tags) for (const facts of Object.values(tree["us-gaap"]?.[tag]?.units ?? {})) for (const fact of facts) if (isYear(fact) && fact.end > end) end = fact.end;
    return end;
  };
  const cash = newestYear(["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]);
  const capex = newestYear(STANDARD_CAPEX_TAGS);
  return cash !== "" && capex !== "" && capex < cash;
}

/** Whether the feed's newest capital expenditure is older than its newest operating cash flow. */
export function capexBehindCashFlow(tree: FactTree): boolean {
  const newest = (tags: string[]) => {
    let end = "";
    for (const tag of tags) for (const facts of Object.values(tree["us-gaap"]?.[tag]?.units ?? {})) for (const fact of facts) if (fact.start && fact.end > end) end = fact.end;
    return end;
  };
  const cash = newest(["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]);
  const capex = newest([
    "PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForProceedsFromProductiveAssets",
    "PaymentsForSoftware", "PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsForCapitalImprovements", "PaymentsToDevelopRealEstateAssets",
    "PaymentsToAcquireRealEstate", "PaymentsToAcquireOilAndGasProperty", "PaymentsToAcquireMachineryAndEquipment", "PaymentsToAcquireOtherProductiveAssets",
    "PaymentsForConstructionInProcess", "PaymentsToExploreAndDevelopOilAndGasProperties", "PaymentsForFlightEquipment",
  ]);
  return cash !== "" && capex < cash;
}

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
/** "company" holds a filer's own line read from its filing's XBRL (see `companyCapexLine`). */
type Taxonomy = "us-gaap" | "dei" | "ifrs-full" | "company";
type ConceptSpec = {
  namespace: Taxonomy; tags: string[]; unit: "currency" | "shares" | "perShare";
  /** Further taxonomies to try, in preference order after `tags`. */
  also?: Array<{ namespace: Taxonomy; tags: string[] }>;
};

const US_GAAP_CONCEPTS: Record<Exclude<MetricKey, "freeCashFlow" | "netShareRepurchases">, ConceptSpec> = {
  // Financial institutions commonly state the top line net of interest expense
  // rather than under generic Revenues. It is a fallback only: an industrial
  // filer's contract/total revenue concepts retain their existing preference.
  revenue: { namespace: "us-gaap", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenuesNetOfInterestExpense"], unit: "currency" },
  grossProfit: { namespace: "us-gaap", tags: ["GrossProfit"], unit: "currency" },
  costOfRevenue: { namespace: "us-gaap", tags: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"], unit: "currency" },
  // Some service businesses split their direct cost base across two lines.
  // They are kept separate here and combined only after the sum reconciles to
  // the filer's own total costs and operating income; see deriveCostOfRevenue.
  directOperatingCosts: { namespace: "us-gaap", tags: ["DirectOperatingCosts"], unit: "currency" },
  directMaterialCosts: { namespace: "us-gaap", tags: ["CostDirectMaterial"], unit: "currency" },
  costsAndExpenses: { namespace: "us-gaap", tags: ["CostsAndExpenses", "OperatingCostsAndExpenses"], unit: "currency" },
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
   *
   * A property company's plant is its property, so buying and developing real
   * estate is its capital expenditure, and an oil company's is the ground it
   * drills. Eleven companies had no capital expenditure at all for want of
   * those two names — Alexandria, Prologis, Public Storage, Digital Realty,
   * Essex, Federal Realty, Regency, Vornado, Texas Pacific Land, Diamondback
   * and Ralph Lauren — and therefore no free cash flow, no cash conversion and
   * no growth in either. It is a conservative reading and it is deliberate: a
   * REIT that buys a building has spent the cash, exactly as a manufacturer
   * that builds a plant has, and a grower will show it as negative free cash
   * flow because that is what it is.
   *
   * Two neighbouring names are not read: real estate "held for investment" and
   * real estate "and real estate joint ventures" are an insurer's portfolio
   * rather than its plant, and reading them as capital expenditure would
   * subtract an investment from operating cash flow.
   *
   * Nor can a missing year be rebuilt from the quarterlies, which looks
   * obvious and is not. CMS reports capital expenditure in every 10-Q and in
   * no 10-K, so the figures are there — as year-to-date cumulatives that stop
   * at nine months, because the fourth quarter appears only in the annual
   * report, which is the filing that does not tag it. Checked across all
   * forty-nine companies in the index with no annual figure: not one fiscal
   * year is reconstructible, and the same holds for the interest expense Apple
   * stopped tagging and the operating income a REIT never tags. Where a
   * concept is missing from the year it is missing from the quarters too.
   */
  capitalExpenditures: { namespace: "us-gaap", tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForProceedsFromProductiveAssets", "PaymentsForSoftware", "PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsForCapitalImprovements", "PaymentsToDevelopRealEstateAssets", "PaymentsToAcquireRealEstate", "PaymentsToAcquireOilAndGasProperty", "PaymentsToAcquireMachineryAndEquipment"], unit: "currency" },
  acquisitions: { namespace: "us-gaap", tags: ["PaymentsToAcquireBusinessesNetOfCashAcquired", "PaymentsToAcquireBusinessesGross"], unit: "currency" },
  dividendsPaid: { namespace: "us-gaap", tags: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsOfOrdinaryDividends"], unit: "currency" },
  dilutedShares: { namespace: "us-gaap", tags: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"], unit: "shares" },
  // Only used to recover a share count when the filer publishes none directly.
  dilutedEpsReported: { namespace: "us-gaap", tags: ["EarningsPerShareDiluted"], unit: "perShare" },
  basicShares: { namespace: "us-gaap", tags: ["WeightedAverageNumberOfSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"], unit: "shares" },
  /*
   * The count of shares in issue on the day the balance sheet closes.
   *
   * Two concepts carry it and only the cover-page one was read. That one is
   * dated the day the report is filed — Apple's is 17 October against a
   * 27 September year end — and the annual normalizer anchors point facts to
   * the period end, so it was thrown away again at the next step. Six of the
   * seven companies in the data audit had no share count at all, and market
   * capitalisation silently fell back to the diluted weighted average: 1.6%
   * away from Apple's real count, 3.2% from JPMorgan's, 4.4% from Rivian's.
   *
   * `us-gaap:CommonStockSharesOutstanding` is the balance-sheet parenthetical,
   * instant-dated at the period end, and it is exactly the 14,773,260,000
   * shares Apple states. It leads; the cover-page count stays as the fallback
   * for filers that publish no parenthetical. Filers with several share
   * classes tag both per class, so they reach this endpoint through neither —
   * which is why the diluted fallback survives, now labelled rather than silent.
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
  longTermDebtCurrent: { namespace: "us-gaap", tags: ["LongTermDebtCurrent", "DebtCurrent", "ConvertibleDebtCurrent"], unit: "currency" },
  // `LongTermDebtAndCapitalLeaseObligations` is the same balance with finance
  // leases folded in, and for many filers it is the only non-current figure in
  // the quarterly statements — Home Depot and AbbVie tag nothing else at their
  // latest balance-sheet date.
  /*
   * A convertible note is borrowing, and for a whole generation of filers it is
   * the only borrowing there is.
   *
   * Cloudflare, Snowflake and Shopify fund themselves with converts and tag
   * them under their own concepts — `ConvertibleDebtCurrent` and
   * `ConvertibleDebtNoncurrent` — which this adapter did not read. So three
   * companies carrying billions of notes came out with no debt balance at all,
   * and with it no net debt, no enterprise value and no EV/EBITDA: Cloudflare
   * has $3.27bn of them against $1.66bn of cash and the page said nothing.
   * Every future company financed the same way arrived the same way.
   *
   * Last in each list, so a filer that publishes a conventional balance-sheet
   * total keeps it: the conventional line is the whole of the debt where it
   * exists, and the convertible concepts are read where nothing else is filed.
   * Their current and non-current halves are separate balance-sheet lines and
   * do not overlap, so the existing pair rule sums them exactly as it sums any
   * other filer's two portions.
   */
  longTermDebtNoncurrent: { namespace: "us-gaap", tags: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "ConvertibleDebtNoncurrent"], unit: "currency" },
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
  /*
   * `DepreciationAndAmortization` is the one most filers actually use.
   *
   * Reading only the depletion-bearing spellings — which are the extractive
   * industries' — left Visa and Mastercard with no depreciation at all, and
   * both tag this concept two hundred times over. Without it there is no
   * EBITDA, without EBITDA there is no net-debt-to-EBITDA, and the Health
   * pillar of two of the largest companies in the world rested on three of its
   * five measures. The accretion-bearing variant is Mastercard's own second
   * spelling and comes last: it carries a little more than depreciation and
   * amortisation, so it stands in only where nothing narrower is filed.
   */
  depreciationAndAmortization: { namespace: "us-gaap", tags: ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment", "Depreciation", "DepreciationAmortizationAndAccretionNet"], unit: "currency" },
  totalAssets: { namespace: "us-gaap", tags: ["Assets"], unit: "currency" },
  // Goodwill and acquired intangibles are subtracted from assets for the
  // tangible-return measure: they are the price paid for past acquisitions,
  // not capital the business currently operates.
  goodwill: { namespace: "us-gaap", tags: ["Goodwill"], unit: "currency" },
  intangibleAssets: { namespace: "us-gaap", tags: ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"], unit: "currency" },
  // Deliberately not InterestIncomeExpenseNet: a net figure nets interest
  // earned against interest paid, and coverage asks what the debt costs.
  interestExpense: { namespace: "us-gaap", tags: ["InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating"], unit: "currency" },
  // Kept distinct from accrued interest expense. It is nevertheless an exact
  // fallback for the Quality Score's burden ratio when a debt-free filer puts
  // only the cash payment in its statement of cash flows.
  interestPaid: { namespace: "us-gaap", tags: ["InterestPaidNet", "InterestPaid"], unit: "currency" },
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

/**
 * The same measures, as an IFRS filer tags them.
 *
 * A foreign private issuer files its annual report on Form 20-F, and if it
 * reports under IFRS not one concept in the table above exists in it. Every
 * such filer normalized to nothing: SAP, Shell, AstraZeneca, Novo Nordisk,
 * HSBC and UBS are listed in New York and the application said, correctly but
 * uselessly, that it could not read them. That was ten per cent of the coverage
 * sweep.
 *
 * These names are not guessed from the IFRS taxonomy. They are the concepts
 * those five filers actually tag, taken from their own company-facts documents,
 * which is why several of them are not the obvious ones: the diluted weighted
 * average share count is `AdjustedWeightedAverageShares` and the basic one is
 * `WeightedAverageShares`, neither of which contains the word "diluted" or
 * "ordinary" that the standard's own labels would suggest.
 *
 * Where a filer tags several candidates the order is preference, exactly as it
 * is above: `ProfitLossAttributableToOwnersOfParent` is the figure a per-share
 * measure needs, so it precedes the group total.
 *
 * This is a translation of names and nothing else. No IFRS figure is adjusted,
 * reconciled to US GAAP or made comparable to one — an operating profit struck
 * under one standard is not the same measurement as under the other, and this
 * application does not pretend otherwise. It reads what the filer published.
 */
const IFRS_CONCEPTS: Partial<Record<keyof typeof US_GAAP_CONCEPTS, string[]>> = {
  revenue: ["Revenue", "RevenueFromContractsWithCustomers", "RevenueFromSaleOfGoods"],
  grossProfit: ["GrossProfit"],
  costOfRevenue: ["CostOfSales"],
  operatingIncome: ["ProfitLossFromOperatingActivities"],
  netIncome: ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"],
  incomeBeforeTax: ["ProfitLossBeforeTax"],
  incomeTaxExpense: ["IncomeTaxExpenseContinuingOperations"],
  operatingCashFlow: ["CashFlowsFromUsedInOperatingActivities"],
  /*
   * The second name is Shell's capital expenditure, awkwardly labelled.
   *
   * The taxonomy calls it "other long-term assets", but it is the cash outflow
   * on the investing line of Shell's own statement — $18.9bn in 2025 against a
   * reported capital expenditure of about nineteen. AstraZeneca tags both and
   * takes the first, so the order is preference and not a merge.
   *
   * SAP is deliberately absent. It tags no cash capital expenditure at all,
   * only additions to property, plant and equipment — an accrual disclosure of
   * what the balance grew by, not what was paid. Reading one as the other would
   * be the silent substitution this application refuses everywhere else, so SAP
   * carries no free cash flow and the page says so.
   */
  capitalExpenditures: [
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    "PurchaseOfOtherLongtermAssetsClassifiedAsInvestingActivities",
    "PaymentsToAcquirePropertyPlantAndEquipment",
  ],
  acquisitions: ["CashFlowsFromUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities"],
  cashAndEquivalents: ["CashAndCashEquivalents"],
  totalAssets: ["Assets"],
  totalLiabilities: ["Liabilities"],
  totalEquity: ["EquityAttributableToOwnersOfParent", "Equity"],
  currentAssets: ["CurrentAssets"],
  currentLiabilities: ["CurrentLiabilities"],
  // Not "diluted" and not "ordinary": these are the names the filings use.
  dilutedShares: ["AdjustedWeightedAverageShares"],
  basicShares: ["WeightedAverageShares"],
  dilutedEpsReported: ["DilutedEarningsLossPerShare"],
  sharesOutstanding: ["NumberOfSharesOutstanding"],
  sharesIssued: ["NumberOfSharesIssued"],
  // Owners of the parent first: it excludes the minority's share, which is what
  // a per-share or a yield figure needs.
  dividendsPaid: [
    "DividendsPaidToEquityHoldersOfParentClassifiedAsFinancingActivities",
    "DividendsPaidClassifiedAsFinancingActivities",
    "DividendsPaidOrdinaryShares",
    "DividendsPaid",
  ],
  dividendsPerShare: ["DividendsPaidOrdinarySharesPerShare", "DividendsRecognisedAsDistributionsToOwnersPerShare"],
  stockBasedCompensation: ["ExpenseFromSharebasedPaymentTransactionsWithEmployees"],
  shareRepurchases: ["PaymentsToAcquireOrRedeemEntitysShares", "PurchaseOfTreasuryShares"],
  shareIssuance: ["ProceedsFromIssueOfOrdinaryShares", "ProceedsFromIssuingShares", "SaleOrIssueOfTreasuryShares"],
  // IFRS states finance costs where US GAAP states interest expense. They are
  // not the same boundary — finance costs carry more than the coupon — so the
  // interest-cover reading of an IFRS filer is the filer's own definition.
  interestExpense: ["FinanceCosts", "InterestExpense"],
  interestPaid: ["InterestPaidClassifiedAsOperatingActivities", "InterestPaid"],
  depreciationAndAmortization: [
    "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss",
    "DepreciationAndAmortisationExpense",
  ],
  inventory: ["Inventories"],
  accountsReceivable: ["TradeAndOtherCurrentReceivables"],
  accountsPayable: ["TradeAndOtherCurrentPayables"],
  goodwill: ["Goodwill"],
  intangibleAssets: ["IntangibleAssetsOtherThanGoodwill"],
  propertyPlantAndEquipment: ["PropertyPlantAndEquipment"],
  retainedEarnings: ["RetainedEarnings"],
  researchAndDevelopment: ["ResearchAndDevelopmentExpense"],
  shortTermBorrowings: ["CurrentBorrowings", "ShorttermBorrowings"],
  longTermDebtNoncurrent: ["NoncurrentPortionOfNoncurrentBorrowings", "NoncurrentBorrowings"],
  totalDebt: ["Borrowings"],
};

/**
 * One table, two standards, one preference order.
 *
 * The IFRS names are appended as further taxonomies rather than held in a
 * parallel map, so every rule downstream — the flat preference order, the
 * fallback-first insertion, the unit key, the period normalizer — applies to
 * them unchanged and cannot drift from the US GAAP path.
 */
export const SEC_CONCEPTS: Record<Exclude<MetricKey, "freeCashFlow" | "netShareRepurchases">, ConceptSpec> =
  Object.fromEntries(
    (Object.entries(US_GAAP_CONCEPTS) as Array<[keyof typeof US_GAAP_CONCEPTS, ConceptSpec]>).map(([metric, spec]) => {
      const ifrs = IFRS_CONCEPTS[metric];
      const withIfrs = ifrs ? { ...spec, also: [...(spec.also ?? []), { namespace: "ifrs-full" as const, tags: ifrs }] } : spec;
      // A company's own capital-expenditure line, last of all: read only where no standard one is filed.
      return [metric, metric === "capitalExpenditures"
        ? { ...withIfrs, also: [...(withIfrs.also ?? []), { namespace: "company" as const, tags: [COMPANY_CAPEX_TAG] }] }
        : withIfrs];
    }),
  ) as Record<Exclude<MetricKey, "freeCashFlow" | "netShareRepurchases">, ConceptSpec>;

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
      output.push(...factsUnder(namespaces, space, tag, metric, spec.unit, cik, currency, retrievedAt));
    }
  }
  const capex = SEC_CONCEPTS.capitalExpenditures;
  const read = (tag: string) => factsUnder(namespaces, "us-gaap", tag, "capitalExpenditures", capex.unit, cik, currency, retrievedAt);
  const isCapex = (fact: RawFinancialFact) => fact.metric === "capitalExpenditures";
  const aliases = capexUnderEitherName(output.filter(isCapex));
  output.push(...aliases);
  output.push(...capexFromComponents([...CAPEX_TOTALS.flatMap(read), ...aliases], CAPEX_COMPONENTS.flatMap(read)));
  /*
   * Lines that are a company's whole capital expenditure only where they are its
   * only one: Verizon's other productive assets, Consolidated Edison's
   * construction in process, APA's exploration and development of oil and gas
   * properties. Each is read on the same rule (see `capexFromOtherProductiveAssets`).
   */
  for (const tag of SOLE_CAPEX_LINES) output.push(...capexFromOtherProductiveAssets(output.filter(isCapex), read(tag)));
  const cashFlow = (tag: string) => factsUnder(namespaces, "us-gaap", tag, "operatingCashFlow", SEC_CONCEPTS.operatingCashFlow.unit, cik, currency, retrievedAt);
  output.push(...operatingCashFlowTotals(
    cashFlow("NetCashProvidedByUsedInOperatingActivities"),
    cashFlow("NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"),
    cashFlow("CashProvidedByUsedInOperatingActivitiesDiscontinuedOperations"),
  ));
  return anchorCoverPageShares(output);
}

const TOTAL_OPERATING_CASH_FLOW = "us-gaap:NetCashProvidedByUsedInOperatingActivities";

/**
 * The whole operating cash flow, where a filing states only its continuing part.
 *
 * Air Products' and Becton Dickinson's annual reports tag operating cash flow
 * from continuing operations, and their quarterly reports tag the total. A
 * year's quarters are built from the year's concept, so none of them was, and
 * every trailing window after the last annual report lost its operating cash
 * flow — and with it its free cash flow.
 *
 * The total is the continuing part plus the discontinued part, where the same
 * context tags both; and the continuing part alone, where the filing tags no
 * discontinued operations for any period at all, because then there is
 * nothing to add. A filing that splits out discontinued operations elsewhere
 * but not for this context is left alone: the missing part is not a zero.
 */
export function operatingCashFlowTotals(totals: RawFinancialFact[], continuing: RawFinancialFact[], discontinued: RawFinancialFact[]): RawFinancialFact[] {
  const context = (fact: RawFinancialFact) => `${fact.start ?? ""}|${fact.end}|${fact.accession}`;
  /*
   * Only a period no filing states a total for.
   *
   * Measured over the index, reconstructing a total wherever one filing lacked
   * it moved 2,307 figures at 98 companies: a later report that restates old
   * years under the continuing-operations name would outrank the total the
   * annual report itself filed — Apple's fiscal 2016 operating cash flow moved
   * from the 65,824 million of its 10-K. A total filed for the period, in any
   * report, stands.
   */
  const period = (fact: RawFinancialFact) => `${fact.start ?? ""}|${fact.end}`;
  const filedPeriods = new Set(totals.map(period));
  const stated = { has: (key: string) => filedPeriods.has(key.split("|").slice(0, 2).join("|")) };
  const parts = new Map(discontinued.map((fact) => [context(fact), fact]));
  const splitFilings = new Set(discontinued.map((fact) => fact.accession));
  const seen = new Set<string>();
  const output: RawFinancialFact[] = [];
  for (const fact of continuing) {
    const key = context(fact);
    if (!fact.start || stated.has(key) || seen.has(key)) continue;
    seen.add(key);
    const part = parts.get(key);
    if (part) {
      output.push({
        ...fact, value: fact.value + part.value, concept: TOTAL_OPERATING_CASH_FLOW, summedFrom: [fact.concept, part.concept],
        normalizationNote: "Operating cash flow from continuing operations plus that of discontinued operations, as the filing states both and no total.",
      });
    } else if (!splitFilings.has(fact.accession)) {
      output.push({
        ...fact, concept: TOTAL_OPERATING_CASH_FLOW, summedFrom: [fact.concept],
        normalizationNote: "The filing states operating cash flow from continuing operations and reports no discontinued operations, so it is the whole operating cash flow.",
      });
    }
  }
  return output;
}

const PPE_PAYMENTS = "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment";
const PRODUCTIVE_ASSET_PAYMENTS = "us-gaap:PaymentsToAcquireProductiveAssets";
const span = (fact: RawFinancialFact) => `${fact.start ?? ""}|${fact.end}`;

/**
 * One capital expenditure filed under two names, read under both.
 *
 * Arista tags its quarters as payments for property, plant and equipment and
 * its 2025 annual report as payments for productive assets. A year's quarters
 * are built from the year's own concept, so none of them was, and the latest
 * trailing period had no free cash flow. Rockwell and McCormick do the same.
 *
 * The two names are treated as one measure only on the filer's own evidence:
 * it must have tagged both for at least one period, and wherever it did, the
 * two must agree — Arista's 2018 and 2019 reports carry both at the same
 * figure. A filer whose "productive assets" is a wider total than its
 * property, plant and equipment shows it by disagreeing, and nothing is copied.
 *
 * And only into a year that needs it: one whose annual figure is filed under
 * one name alone and whose quarters are filed only under the other. Copying
 * every period across was measured to do harm. Fortive and Republic Services
 * tag complete years under one name and older, differently restated quarters
 * under the other, and the copies mixed the two: Fortive's trailing capital
 * expenditure at the end of 2024 read 99.8 million against 86 million filed.
 */
export function capexUnderEitherName(facts: RawFinancialFact[]): RawFinancialFact[] {
  const named = facts.filter((fact) => fact.start && (fact.concept === PPE_PAYMENTS || fact.concept === PRODUCTIVE_ASSET_PAYMENTS));
  const byName = (concept: string) => new Map(named.filter((fact) => fact.concept === concept).map((fact) => [span(fact), fact]));
  const ppe = byName(PPE_PAYMENTS), productive = byName(PRODUCTIVE_ASSET_PAYMENTS);
  const shared = [...ppe.keys()].filter((key) => productive.has(key));
  if (!shared.length) return [];
  const agree = shared.every((key) => {
    const left = Math.abs(ppe.get(key)!.value), right = Math.abs(productive.get(key)!.value);
    return Math.abs(left - right) <= Math.max(1, 0.005 * right);
  });
  if (!agree) return [];
  const copy = (fact: RawFinancialFact, concept: string): RawFinancialFact => ({
    ...fact,
    concept,
    summedFrom: [fact.concept],
    normalizationNote: `Tagged as ${fact.concept.replace("us-gaap:", "")} for this period and read under ${concept.replace("us-gaap:", "")}, the name of its fiscal year's own figure: the filer tags both names at the same figure wherever it tags both.`,
  });
  const days = (fact: RawFinancialFact) => (Date.parse(fact.end) - Date.parse(fact.start!)) / 86_400_000;
  const output: RawFinancialFact[] = [];
  for (const [concept, own, other] of [[PRODUCTIVE_ASSET_PAYMENTS, productive, ppe], [PPE_PAYMENTS, ppe, productive]] as const) {
    for (const year of own.values()) {
      if (days(year) < 300 || other.has(span(year))) continue;
      const inside = (fact: RawFinancialFact) => fact.start! >= year.start! && fact.end < year.end;
      if ([...own.values()].some(inside)) continue;
      output.push(...named.filter((fact) => fact.concept !== concept && inside(fact)).map((fact) => copy(fact, concept)));
    }
  }
  /*
   * And the year in progress, which has no annual figure to be named after.
   *
   * Cboe tagged its March 2026 quarter as property, plant and equipment and
   * its six months to June as productive assets; CRH the same way. With no
   * 2026 annual figure yet, neither name had a whole year of quarters, and the
   * latest trailing window had no capital expenditure. After the latest year
   * either name files, each period under one name only is read under both.
   */
  const lastYearEnd = named.filter((fact) => days(fact) >= 300).map((fact) => fact.end).sort().at(-1) ?? "";
  for (const fact of named.filter((each) => days(each) < 300 && each.end > lastYearEnd)) {
    if (fact.concept === PPE_PAYMENTS && !productive.has(span(fact))) output.push(copy(fact, PRODUCTIVE_ASSET_PAYMENTS));
    if (fact.concept === PRODUCTIVE_ASSET_PAYMENTS && !ppe.has(span(fact))) output.push(copy(fact, PPE_PAYMENTS));
  }
  return output;
}

/**
 * Capital expenditure a filer tags only as "other productive assets".
 *
 * Verizon's capital expenditure — seventeen billion dollars in 2025 — is filed
 * under that name and no other, so Verizon had no free cash flow anywhere on
 * this site. Roper, Incyte and Robinhood file the same way.
 *
 * Read only where it has become the filer's sole capital-expenditure line:
 * after the last period it shares with another one, and only once a whole
 * fiscal year stands on it alone. Verizon filed it as a part of a wider total
 * in 2009 and 2010 and as the whole of its capital expenditure ever since.
 * Delta still files it beside its productive-assets total — 978 million
 * against 4,499 million — and a half-year whose total is missing is not read
 * off the part: that would understate the period fivefold.
 */
export function capexFromOtherProductiveAssets(capex: RawFinancialFact[], other: RawFinancialFact[]): RawFinancialFact[] {
  if (!other.length) return [];
  const taken = new Set(capex.filter((fact) => fact.start).map(span));
  const lastShared = other.filter((fact) => taken.has(span(fact))).map((fact) => fact.end).sort().at(-1) ?? "";
  const alone = other.filter((fact) => fact.start && fact.end > lastShared && !taken.has(span(fact)));
  const aYear = alone.some((fact) => (Date.parse(fact.end) - Date.parse(fact.start!)) / 86_400_000 >= 300);
  return aYear ? alone : [];
}

/** Every usable fact filed under one concept, in the shape the normalizer reads. */
function factsUnder(
  namespaces: z.infer<typeof SecResponseSchema>["facts"],
  space: string,
  tag: string,
  metric: RawFinancialFact["metric"],
  unit: ConceptSpec["unit"],
  cik: string,
  currency: string,
  retrievedAt: string,
): RawFinancialFact[] {
  const node = (namespaces[space] ?? {})[tag];
  if (!node) return [];
  const unitKey = unit === "shares" ? "shares" : unit === "perShare" ? `${currency}/shares` : currency;
  const unitFacts: SecUnit[] = node.units[unitKey] ?? [];
  const output: RawFinancialFact[] = [];
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
      metric, value: fact.val, currency, unit: unit === "perShare" ? "currency" : unit, start: fact.start, end: fact.end,
      filed: fact.filed, accession: fact.accn, fiscalYear: fact.fy,
      fiscalPeriod: fiscalPeriod as RawFinancialFact["fiscalPeriod"], form: fact.form as RawFinancialFact["form"],
      concept: `${space}:${tag}`, sourceUrl: sourceUrl(cik, fact.accn), retrievedAt,
    });
  }
  return output;
}

/** The capital-expenditure totals a filer may tag, and the lines that can add up to one. */
export const CAPEX_TOTALS = ["PaymentsToAcquireProductiveAssets", "PaymentsToAcquirePropertyPlantAndEquipment"];
export const CAPEX_COMPONENTS = [
  "PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsForSoftware", "PaymentsToDevelopSoftware",
  "PaymentsToAcquireOtherProductiveAssets", "PaymentsToAcquireOtherPropertyPlantAndEquipment",
  "PaymentsForCapitalImprovements", "PaymentsToAcquireMachineryAndEquipment",
  // Delta's aircraft: with its other productive assets, the total it files as productive assets.
  "PaymentsForFlightEquipment",
];

/** Standard lines read as the whole capital expenditure only where the company files no other. */
export const SOLE_CAPEX_LINES = ["PaymentsToAcquireOtherProductiveAssets", "PaymentsForConstructionInProcess", "PaymentsToExploreAndDevelopOilAndGasProperties"];

/**
 * Capital expenditure where a filer tags only its parts, summed on the filer's own proof.
 *
 * Hims & Hers tagged its 2022 and 2023 quarters as two lines — software and
 * other productive assets — and its annual reports as one total. The quarters
 * are built from the year's concept, so every quarter had no capital
 * expenditure, and with it no free cash flow and no trailing window: eleven of
 * twenty-three trailing periods were blank for a company that published every
 * figure.
 *
 * The parts are added only in the way the filer itself adds them. A recipe is
 * learned from a filing that tags the total and its parts together and where
 * the parts sum to the total — Hims's 2022 report: 4.5m of software and 2.7m of
 * other assets against 7.2m of productive assets, and 9.3m and 17.2m against
 * 26.5m the year after — and is applied only to a period that tags every one of
 * those parts and no total. A filer that never reconciles its lines gets
 * nothing summed; an absent part is never read as zero.
 */
export function capexFromComponents(totals: RawFinancialFact[], components: RawFinancialFact[]): RawFinancialFact[] {
  const name = (fact: RawFinancialFact) => fact.concept.replace(/^us-gaap:/, "");
  const context = (fact: RawFinancialFact) => `${fact.start ?? ""}|${fact.end}|${fact.accession}`;
  const byContext = new Map<string, RawFinancialFact[]>();
  for (const fact of [...totals, ...components]) {
    if (!fact.start) continue;
    byContext.set(context(fact), [...(byContext.get(context(fact)) ?? []), fact]);
  }
  const partsIn = (facts: RawFinancialFact[], exclude: string) => {
    const seen = new Map<string, RawFinancialFact>();
    for (const fact of facts) if (CAPEX_COMPONENTS.includes(name(fact)) && name(fact) !== exclude && !seen.has(name(fact))) seen.set(name(fact), fact);
    return [...seen.values()];
  };
  const sum = (facts: RawFinancialFact[]) => facts.reduce((total, fact) => total + Math.abs(fact.value), 0);

  const recipes = new Map<string, { total: string; parts: string[]; proof: string }>();
  for (const facts of byContext.values()) {
    for (const total of facts.filter((fact) => CAPEX_TOTALS.includes(name(fact)))) {
      const parts = partsIn(facts, name(total));
      if (parts.length < 2 || Math.abs(total.value) === 0) continue;
      if (Math.abs(sum(parts) - Math.abs(total.value)) > Math.max(0.005 * Math.abs(total.value), 1)) continue;
      const names = parts.map(name).sort();
      const key = `${name(total)}=${names.join("+")}`;
      if (!recipes.has(key)) recipes.set(key, { total: name(total), parts: names, proof: total.accession });
    }
  }
  if (!recipes.size) return [];

  const output: RawFinancialFact[] = [];
  for (const facts of byContext.values()) {
    for (const recipe of [...recipes.values()].sort((left, right) => right.parts.length - left.parts.length)) {
      if (facts.some((fact) => name(fact) === recipe.total)) continue;
      if (output.some((fact) => context(fact) === context(facts[0]) && name(fact) === recipe.total)) continue;
      const parts = recipe.parts.map((part) => facts.find((fact) => name(fact) === part));
      if (parts.some((part) => !part)) continue;
      const found = parts as RawFinancialFact[];
      const present = partsIn(facts, recipe.total).map(name);
      // A period tagging a part the recipe does not add would be understated by it.
      if (present.some((part) => !recipe.parts.includes(part))) continue;
      output.push({
        ...found[0],
        metric: "capitalExpenditures",
        value: sum(found),
        concept: `us-gaap:${recipe.total}`,
        summedFrom: found.map((fact) => fact.concept),
        normalizationNote: `No ${recipe.total} is tagged for this period; its parts ${recipe.parts.join(" + ")} are summed, as the filer's own report ${recipe.proof} sums them to that total.`,
      });
    }
  }
  return output;
}

/** The cover-page count, which is dated the day the report was filed. */
const COVER_PAGE_SHARES = "dei:EntityCommonStockSharesOutstanding";

/**
 * The count on a report's cover, read into the period that report is about.
 *
 * A filer states its shares outstanding twice: once in the balance-sheet
 * parenthetical, dated the day the books closed, and once on the cover of the
 * report, dated the day it was signed — Booking's 10-Q for the June quarter
 * says 751,380,500 shares as of 27 July. The normalizer joins point-in-time
 * facts to a period by exact date, so the cover-page count matched no period at
 * all and was extracted and then dropped.
 *
 * That is the count for eighteen per cent of American filers, because a company
 * with several share classes tags the parenthetical per class and nothing
 * undimensioned reaches this endpoint. All of them fell through to the diluted
 * weighted average — an average over the whole year, of a count that a buyback
 * moves every quarter. Booking's is six per cent above the shares it actually
 * has, and every multiple struck on it was six per cent wrong.
 *
 * So it is anchored to the end of the period its own filing reports on, which
 * is what the cover of that filing is a cover of. The date it is *stated* at is
 * kept in the note, and the concept travels with the fact, so the market basis
 * can say "outstanding at the filing cover date" rather than passing it off as
 * a period-end count. It never displaces the parenthetical, which is filed
 * under a different concept and preferred wherever a filer publishes one.
 */
function anchorCoverPageShares(facts: RawFinancialFact[]): RawFinancialFact[] {
  const reportingEnd = new Map<string, string>();
  for (const fact of facts) {
    if (!fact.start) continue;
    const known = reportingEnd.get(fact.accession);
    if (!known || fact.end > known) reportingEnd.set(fact.accession, fact.end);
  }
  return facts.map((fact) => {
    if (fact.concept !== COVER_PAGE_SHARES || fact.start) return fact;
    const end = reportingEnd.get(fact.accession);
    // A cover is signed after the books close, never before. Anything else is
    // not the shape this rule is about and is left exactly as filed.
    if (!end || end >= fact.end) return fact;
    return {
      ...fact, end,
      normalizationNote: `Cover-page share count stated as of ${fact.end}, the date the report was signed; read into the ${end} period that report covers.`,
    };
  });
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

/**
 * Earnings before interest and taxes, where the filer publishes no subtotal.
 *
 * Exxon and Johnson & Johnson tag no operating income at all. Six measures rest
 * on it — the operating margin, EBITDA, return on invested capital and its
 * five-year average, net debt to EBITDA, and interest cover — so both came out
 * of the screener unrated with barely half the data, while the two figures the
 * subtotal is made of sat in the same filing.
 *
 * EBIT *is* pre-tax income plus interest expense: that is the definition, not
 * an approximation, and it is addition on two published facts in one period.
 * The result is marked calculated, carries the formula, and is never written
 * where the filer published a subtotal of its own — a company that reports
 * operating income keeps the one it reported, including when the two disagree,
 * because the difference between them is other income and that is the filer's
 * to state.
 *
 * A financial business gets none of this. A bank's interest expense is its cost
 * of goods, so adding it back is not a measure of anything.
 */
function deriveOperatingIncome(periods: FinancialPeriod[], businessType: BusinessType | undefined): FinancialPeriod[] {
  if (isFinancialBusiness(businessType)) return periods;
  return periods.map((period) => {
    if (period.facts.operatingIncome?.value != null) return period;
    const pretax = period.facts.incomeBeforeTax;
    const interest = period.facts.interestExpense;
    if (pretax?.value == null || interest?.value == null) return period;
    // Both halves have to describe the same window in the same money, or the
    // sum is two different periods added together.
    if (pretax.currency !== interest.currency || pretax.periodEnd !== interest.periodEnd) return period;
    return {
      ...period,
      facts: {
        ...period.facts,
        operatingIncome: {
          ...pretax,
          metric: "operatingIncome",
          value: pretax.value + Math.abs(interest.value),
          provenance: {
            ...pretax.provenance,
            provider: "Calculated",
            status: "calculated",
            concept: `${pretax.provenance.concept} + ${interest.provenance.concept}`,
            formula: "Income before tax + interest expense",
            sourceAccessions: [...new Set([pretax.provenance.accession, interest.provenance.accession].filter((item): item is string => Boolean(item)))],
            note: "The filer publishes no operating income subtotal for this period. Earnings before interest and taxes are struck from the two figures it does publish; nothing is estimated, and any other income the filer reports is inside this figure rather than outside it.",
          },
        },
      },
    };
  });
}

/**
 * Rebuilds a cost-of-revenue subtotal from separately filed direct costs.
 *
 * Copart stopped tagging one generic cost-of-revenue line in 2020. It still
 * publishes both constituents — facility operations and vehicle costs — plus
 * total costs, G&A and operating income. The two direct lines are summed only
 * when both independent income-statement identities reconcile within filing
 * rounding. This prevents similarly named concepts from being combined for a
 * filer whose presentation gives them a different scope.
 */
function deriveCostOfRevenue(periods: FinancialPeriod[]): FinancialPeriod[] {
  const agrees = (left: number, right: number) => Math.abs(left - right) <= Math.max(Math.abs(right) * .005, 1);
  return periods.map((period) => {
    if (period.facts.costOfRevenue?.value != null) return period;
    const direct = period.facts.directOperatingCosts;
    const materials = period.facts.directMaterialCosts;
    const total = period.facts.costsAndExpenses;
    const sga = period.facts.sellingGeneralAndAdministrative;
    const revenue = period.facts.revenue;
    const operating = period.facts.operatingIncome;
    const facts = [direct, materials, total, sga, revenue, operating];
    if (facts.some((fact) => fact?.value == null)) return period;
    if (facts.some((fact) => fact!.currency !== period.currency || fact!.periodEnd !== period.periodEnd)) return period;

    const value = Math.abs(direct!.value!) + Math.abs(materials!.value!);
    const totalValue = Math.abs(total!.value!);
    if (!agrees(value + Math.abs(sga!.value!), totalValue) || !agrees(revenue!.value! - operating!.value!, totalValue)) return period;

    return {
      ...period,
      facts: {
        ...period.facts,
        costOfRevenue: {
          ...direct!, metric: "costOfRevenue", value,
          provenance: {
            ...direct!.provenance,
            provider: "Calculated", status: "calculated",
            concept: `${direct!.provenance.concept} + ${materials!.provenance.concept}`,
            formula: "Direct operating costs + Direct material costs",
            sourceAccessions: [...new Set(facts.flatMap((fact) => fact!.provenance.sourceAccessions ?? [fact!.provenance.accession ?? ""]).filter(Boolean))],
            note: "The filer publishes its cost base in two direct-cost lines. Their sum is used only because it reconciles both to total costs less G&A and to revenue less operating income.",
          },
        },
      },
    };
  });
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
    /*
     * A balance sheet that says nothing is owed.
     *
     * Shopify repaid its convertible notes and its next annual report files the
     * line at nought — which is a statement, not an absence. Without reading it
     * the company had no debt balance at all from that day on, and the rule that
     * carries the last filed borrowing forward then reached past the repayment
     * to the year before it and reported nine hundred million of notes that no
     * longer exist. Silently reverting a repayment is a far worse failure than
     * withholding a figure.
     *
     * Narrow on purpose, and it has to be. This fires only where every
     * borrowing concept the filer tags at this date is filed as zero: one
     * non-zero balance anywhere sends the reading to a branch above, and a
     * filer that tags no borrowing line at all still gets nothing, because an
     * absent balance is not a zero one. That is the whole distinction this
     * application is built on, and reading a filed nought is the other half of
     * it rather than an exception to it.
     */
    if (!parts.length) {
      const filed = [current, noncurrent, longTermCombined, otherLongTerm, shortTerm, financeLease]
        .filter((fact): fact is NormalizedFact => fact?.value != null);
      if (filed.length && filed.every((fact) => fact.value === 0)) {
        parts = [filed[0]];
        formula = "Every borrowing balance this filer tags at this date is filed as nought";
      }
    }
    if (!parts.length && financeLease?.value != null) {
      // A finance lease is borrowing. Copart's latest annual balance sheet has
      // no conventional debt line and files this exact liability on its own;
      // refusing the only borrowing it reports made every debt-based measure
      // disappear even though the balance itself was present.
      parts = [financeLease];
      formula = "Finance lease liability as filed";
      excludes = "The filer tags no conventional borrowing balance at this date.";
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
  /*
   * Both standards, because the accounts are kept in one currency whichever one
   * they are kept under. Reading only `us-gaap` left every IFRS filer on the
   * currency its registry entry happened to declare — dollars — while SAP keeps
   * its books in euros, Novo Nordisk in kroner and UBS in francs. That is not a
   * cosmetic label: it is the test that decides whether a dollar quote may be
   * multiplied by a filed share count at all, so getting it wrong would not
   * mislabel a multiple, it would invent one.
   */
  for (const taxonomy of ["us-gaap", "ifrs-full"] as const) {
    for (const node of Object.values(namespaces[taxonomy] ?? {})) {
      for (const [unit, facts] of Object.entries(node.units)) {
        if (!/^[A-Z]{3}$/.test(unit)) continue;
        counts.set(unit, (counts.get(unit) ?? 0) + facts.length);
      }
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
  // More than one split can occur between two annual filings. Copart had two
  // 2-for-1 events before its next comparable share count, so neither event
  // individually explained the observed fourfold step. Confirm the cluster
  // when the product of the filed ratios explains one adjacent break.
  for (let index = 1; index < series.length; index++) {
    const before = series[index - 1]; const after = series[index];
    if (before.filed === after.filed) continue;
    const between = candidates.filter((candidate) => candidate.date > before.filed && candidate.date <= after.filed);
    if (between.length < 2) continue;
    const filedRatio = between.reduce((product, event) => product * event.ratio, 1);
    if (Math.abs((after.shares / before.shares) / filedRatio - 1) <= .08) {
      for (const event of between) if (!confirmed.some((item) => item.date === event.date)) confirmed.push(event);
    }
  }
  for (const candidate of [...candidates].sort((left, right) => left.date.localeCompare(right.date))) {
    if (confirmed.some((event) => event.date === candidate.date)) continue;
    const before = series.filter((item) => item.filed < candidate.date).at(-1);
    const after = series.find((item) => item.filed >= candidate.date);
    if (!before || !after) continue;
    const observed = after.shares / before.shares;
    // Everything already confirmed has been applied to the earlier side, so a
    // second candidate for the same event no longer has a break to explain.
    const outstanding = confirmed
      .filter((event) => event.date > before.filed && event.date <= after.filed)
      .reduce((product, event) => product * event.ratio, 1);
    if (Math.abs(observed / (candidate.ratio * outstanding) - 1) > .08) continue;
    confirmed.push(candidate);
  }
  return confirmed.sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * The share counts a split restates, in the only unit they are filed in.
 *
 * Weighted averages and issued counts, basic and diluted, under every spelling
 * this endpoint carries. Treasury shares move by a split too, but a filer's
 * treasury line is repurchased between filings as well, so it is not evidence
 * of anything on its own and is left out of the detection.
 */
const RESTATED_SHARE_CONCEPTS = [
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "WeightedAverageNumberOfSharesOutstanding",
  "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
  "CommonStockSharesIssued",
  "CommonStockSharesOutstanding",
];

/**
 * The split ratio an observed restatement is, or nothing at all.
 *
 * A split ratio is a small rational number — twenty-five for one, three for
 * two, one for ten — and a division of two filed counts is not: Booking's
 * restatement reads 24.9902 because the new figure is rounded to the million
 * and the old one to the thousand. Snapping to the nearest half within two
 * percent turns that back into the twenty-five it is, and refuses anything that
 * is not close to a ratio a company would ever declare.
 *
 * Both directions are read here, which the declared-ratio path deliberately
 * does not do. A declared ratio is ambiguous — some filers tag a reverse split
 * as the ratio and some as its reciprocal, and applying one upside down is far
 * worse than leaving it alone — but a restatement is not: the filer has
 * published the same period twice and the direction is the direction the number
 * moved.
 */
export function restatementRatio(observed: number): number | null {
  if (!Number.isFinite(observed) || observed <= 0) return null;
  const forward = observed >= 1;
  const magnitude = forward ? observed : 1 / observed;
  if (magnitude > 100) return null;
  const snapped = Math.round(magnitude * 2) / 2;
  if (snapped < 1.5) return null;
  if (Math.abs(magnitude / snapped - 1) > .02) return null;
  return forward ? snapped : 1 / snapped;
}

/**
 * The splits a filer proved by restating its own history.
 *
 * A filer that splits its stock republishes every earlier share count on the
 * new basis in its next report — the same period, the same concept, a different
 * number. Booking's first quarter of 2025 is filed twice: 33,093,000 diluted
 * shares in the report for that quarter, and 827,000,000 in the report a year
 * later. That is a twenty-five-for-one split stated by the company, in facts,
 * and it is far stronger evidence than any ratio tagged in a note.
 *
 * It has to be, because Booking tags no ratio at all. It declares
 * `StockholdersEquityNoteStockSplitConversionRatio1` nowhere in Company Facts,
 * so the declared-ratio path — which is what covers every company outside the
 * hand-verified registry — found nothing to confirm and the history stayed on
 * two bases at once: free cash flow per share read $278 for 2025 and $21 for
 * the trailing year that followed it, a thirteen-fold cliff in the middle of a
 * chart, with a diluted count of 33 million against a company that has 800.
 *
 * Three things keep this from firing on anything that is not a split:
 *
 *  - the ratio must snap to a ratio a company would declare, in either
 *    direction (see `restatementRatio`);
 *  - at least two restated contexts must agree on it, which a split always
 *    produces — basic and diluted, the quarter and the year to date — and a
 *    one-off correction to a single figure does not;
 *  - and it must still be unexplained. Everything already applied — the
 *    verified registry, then whatever the filer declared — is divided out
 *    first, so a split reaching this from both directions is applied once.
 *
 * The date is the filing that first states the new basis. The effective date
 * lies between that filing and the last one filed on the old basis, and the
 * filings do not say where; what this date has to be right about is which facts
 * are on which basis, and being the boundary itself it is exactly right about
 * that. It is stated as a filed date and never as an announcement.
 */
export function restatedStockSplits(
  namespaces: z.infer<typeof SecResponseSchema>["facts"],
  known: Array<{ date: string; ratio: number }> = [],
): Array<{ date: string; ratio: number }> {
  /** By the filing that restated, the ratios it restated by and from when. */
  const boundaries = new Map<string, Array<{ ratio: number; since: string }>>();
  for (const tag of RESTATED_SHARE_CONCEPTS) {
    const contexts = new Map<string, SecUnit[]>();
    for (const fact of namespaces["us-gaap"]?.[tag]?.units?.shares ?? []) {
      if (!(fact.val > 0) || !fact.filed) continue;
      const context = `${fact.start ?? ""}|${fact.end}`;
      const filings = contexts.get(context);
      if (filings) filings.push(fact); else contexts.set(context, [fact]);
    }
    for (const filings of contexts.values()) {
      const ordered = [...filings].sort((left, right) => left.filed.localeCompare(right.filed));
      for (let index = 1; index < ordered.length; index++) {
        const before = ordered[index - 1]; const after = ordered[index];
        if (before.filed === after.filed) continue;
        const ratio = restatementRatio(after.val / before.val);
        if (ratio == null) continue;
        const seen = boundaries.get(after.filed) ?? [];
        seen.push({ ratio, since: before.filed });
        boundaries.set(after.filed, seen);
      }
    }
  }

  /*
   * One event, not one per report.
   *
   * The report after a split restates the periods it shows, and the report
   * after that restates the ones *it* shows — periods the first one did not
   * carry, still on the old basis. Booking therefore proves the same
   * twenty-five twice, three months apart, and applying both would multiply its
   * history by six hundred and twenty-five. So each candidate is measured
   * against what is already applied over the window it could have happened in:
   * after the last filing that still showed the old basis, up to the filing
   * that showed the new one. A candidate a known split already explains has no
   * ratio left and is dropped.
   */
  const applied = [...known];
  const found: Array<{ date: string; ratio: number }> = [];
  for (const date of [...boundaries.keys()].sort()) {
    const seen = boundaries.get(date)!;
    const agreement = new Map<number, number>();
    for (const entry of seen) agreement.set(entry.ratio, (agreement.get(entry.ratio) ?? 0) + 1);
    const [ratio, agreeing] = [...agreement].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0];
    if (agreeing < 2) continue;
    const since = seen.filter((entry) => entry.ratio === ratio).map((entry) => entry.since).sort().at(-1)!;
    const explained = applied
      .filter((split) => split.date > since && split.date <= date)
      .reduce((product, split) => product * split.ratio, 1);
    const residual = restatementRatio(ratio / explained);
    if (residual == null) continue;
    found.push({ date, ratio: residual });
    applied.push({ date, ratio: residual });
  }
  return found;
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
    deriveCostOfRevenue(deriveOperatingIncome(combineDebtComponents(recoverDilutedShares(normalizeAnnualPeriods(rawFacts, company.currency)), company.businessType), company.businessType)),
    deriveCostOfRevenue(deriveOperatingIncome(combineDebtComponents(recoverDilutedShares(normalizeQuarterlyPeriods(rawFacts, company.currency)), company.businessType), company.businessType)),
  );
  // The hand-verified splits first; then any the filer declared that still
  // explain a break in what is left, which is what covers a company nobody
  // curated a list for.
  const verifiedAnnual = adjustPeriodsForSplits(recoverSharesFromDividends(reconciled.annual, reconciled.ratesSeen), company.stockSplits);
  const verifiedQuarterly = adjustPeriodsForSplits(recoverSharesFromDividends(reconciled.quarterly, reconciled.ratesSeen), company.stockSplits);
  const detected = confirmedStockSplits(filedStockSplits(parsed.facts), verifiedAnnual);
  // Then the splits nobody declared, proved by the filer restating its own
  // history — which is the only evidence a company like Booking leaves.
  const restated = restatedStockSplits(parsed.facts, [...(company.stockSplits ?? []), ...detected]);
  const unverified = [...detected, ...restated].sort((left, right) => left.date.localeCompare(right.date));
  const stockSplits = [...(company.stockSplits ?? []), ...unverified].sort((left, right) => left.date.localeCompare(right.date));
  const annual = adjustPeriodsForSplits(verifiedAnnual, unverified);
  const quarterly = adjustPeriodsForSplits(verifiedQuarterly, unverified);
  const ttm = buildTtmPeriods(quarterly, company.currency, annual);
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
    /*
     * IFRS is read now, so a filer reaching here under it is not refused for
     * being IFRS: it is a filer whose particular concepts this map does not
     * carry, which is a different sentence and points at a different fix.
     */
    throw new Error(spaces.includes("ifrs-full") && !spaces.includes("us-gaap")
      ? `${parsed.entityName} reports under IFRS, and none of the IFRS concepts FinScope reads appear in its filings. Its statements cannot be normalized yet.`
      : `No standardized facts were found for ${parsed.entityName} on Forms 10-K, 10-Q, 20-F or 40-F.`);
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
  const payload = await response.json() as { entityName: string; facts: FactTree };
  const notes: string[] = [];

  /*
   * A company that files under two identifiers, read under both.
   *
   * ExxonMobil's history is under Exxon Mobil Corporation and its reports since
   * the reorganisation are under ExxonMobil Holdings Corp, so reading only the
   * first left its June 2026 quarter off the page. Both are read and merged;
   * the normalizer's own de-duplication keeps a figure filed twice once.
   */
  const successor = KNOWN_SUCCESSORS[company.ticker.toUpperCase()];
  let facts = payload.facts;
  if (successor && successor.reads === company.cik) {
    try {
      const listed = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${successor.listed}.json`, {
        headers: { "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com", Accept: "application/json" },
      });
      if (listed.ok) facts = mergeFactTrees(facts, ((await listed.json()) as { facts: FactTree }).facts);
    } catch { /* The history alone is still the company. */ }
  }

  /*
   * A report Company Facts has not carried yet, read from the filing itself.
   *
   * See lib/adapters/xbrl-instance.ts. One request tells whether the company
   * has filed for a later period than the feed holds; only then is the filing's
   * own XBRL fetched. Anything failing here leaves the feed's figures as they
   * were: this can add a quarter, never take one away.
   */
  try {
    const filing = await fetchLatestFiling(successor?.listed ?? company.cik);
    if (filing?.accession && filingIsAhead(facts, filing)) {
      const filer = Number(successor?.listed ?? company.cik);
      const folder = `https://www.sec.gov/Archives/edgar/data/${filer}/${filing.accession.replaceAll("-", "")}`;
      const listing = await fetch(`${folder}/index.json`, { headers: { "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com" } });
      const names = listing.ok ? ((await listing.json()) as { directory: { item: Array<{ name: string }> } }).directory.item.map((item) => item.name) : [];
      const instance = instanceDocument(names);
      if (instance) {
        const document = await fetch(`${folder}/${instance}`, { headers: { "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com" } });
        if (document.ok) {
          const extra = parseXbrlInstance(await document.text(), { accession: filing.accession, form: filing.form, filed: filing.filingDate });
          if (Object.keys(extra).length) {
            facts = mergeFactTrees(facts, extra);
            notes.push(`The ${filing.form} for the period ended ${filing.reportDate}, filed ${filing.filingDate}, is read from the filing itself: SEC Company Facts had not yet carried it.`);
          }
        }
      }
    }
  } catch { /* The feed's figures stand. */ }

  /*
   * A capital expenditure the SEC's standard feed does not carry, read from the
   * company's own line (see `companyCapexLine`).
   *
   * Only where the feed's latest capital expenditure is older than its latest
   * operating cash flow — the company kept reporting, under a name of its own —
   * and only from the latest annual report onwards, which is what the latest
   * year and trailing window need. One linkbase and one instance per filing;
   * anything failing leaves the figures as they were.
   */
  try {
    if (!cashFlowIsTheBalanceSheet(company.businessType) && (capexBehindCashFlow(facts) || annualCapexBehindCashFlow(facts))) {
      const filer = successor?.listed ?? company.cik;
      const filings = await fetchPeriodicFilings(filer, 8);
      const annual = filings.findIndex((filing) => filing.form === "10-K" || filing.form === "20-F" || filing.form === "40-F");
      const recent = annual < 0 ? filings.slice(0, 4) : filings.slice(0, annual + 1).slice(0, 4);
      const read: string[] = [];
      const standardRead: string[] = [];
      // The company's own line, gathered across the filings and judged once, as a whole, before it is used.
      let ownLine: { prefix: string; name: string } | null = null;
      const ownUnits: Record<string, FilingFactLike[]> = {};
      // Gently: a burst of index, linkbase and instance requests is what the SEC refuses.
      const paced = async (url: string) => { await new Promise((resolve) => setTimeout(resolve, 150)); return fetch(url, { headers: SEC_HEADERS() }); };
      for (const filing of recent) {
        if (!filing.accession) continue;
        const folder = `https://www.sec.gov/Archives/edgar/data/${Number(filer)}/${filing.accession.replaceAll("-", "")}`;
        const listing = await paced(`${folder}/index.json`);
        if (!listing.ok) continue;
        const names = ((await listing.json()) as { directory: { item: Array<{ name: string }> } }).directory.item.map((item) => item.name);
        const calculation = names.find((name) => name.endsWith("_cal.xml"));
        const instance = instanceDocument(names);
        if (!calculation || !instance) continue;
        const linkbase = await paced(`${folder}/${calculation}`);
        if (!linkbase.ok) continue;
        const lines = investingLines(await linkbase.text());
        /*
         * Standard lines first. Valero's and Freeport's 2026 reports add US GAAP
         * capital-expenditure lines into investing activities that Company Facts
         * has not carried — the same lag the latest-filing read answers for a
         * whole report, here for one line. Those are read under their own
         * names, and every rule above applies to them as to any other fact.
         * A company's own line is the fallback where the filing has none.
         */
        const standard = lines.filter((each) => each.prefix === "us-gaap" && each.weight < 0 && STANDARD_CAPEX_TAGS.includes(each.name));
        const line = standard.length ? null : companyCapexLine(lines);
        if (!standard.length && !line) continue;
        const document = await paced(`${folder}/${instance}`);
        if (!document.ok) continue;
        const xml = await document.text();
        const filed = { accession: filing.accession, form: filing.form, filed: filing.filingDate };
        if (standard.length) {
          const parsed = parseXbrlInstance(xml, filed, "us-gaap");
          const picked: FactTree = { "us-gaap": {} };
          for (const each of standard) { const node = parsed["us-gaap"]?.[each.name]; if (node) picked["us-gaap"][each.name] = node; }
          if (Object.keys(picked["us-gaap"]).length) {
            facts = mergeFactTrees(facts, picked);
            standardRead.push(`${filing.form} ${filing.reportDate}`);
          }
          continue;
        }
        const own = parseXbrlInstance(xml, filed, line!.prefix.replace(/[^\w-]/g, ""));
        const units = own[line!.prefix]?.[line!.name]?.units;
        if (!units) continue;
        if (ownLine && (ownLine.prefix !== line!.prefix || ownLine.name !== line!.name)) continue;
        ownLine = { prefix: line!.prefix, name: line!.name };
        for (const [unit, list] of Object.entries(units)) (ownUnits[unit] ??= []).push(...list);
        read.push(`${filing.form} ${filing.reportDate}`);
      }
      /*
       * Not a narrower line than the company's own last standard figure.
       *
       * United Rentals' single own line is its non-rental property and software
       * — 0.36 billion over a year in which it bought billions of rental
       * equipment under another name — and reading it as the capital expenditure
       * made its free cash flow 5.4 billion. Judged once, on everything gathered:
       * judged filing by filing, its quarterly reports, which carry no annual
       * figure to compare, slipped through while the annual one was refused.
       */
      if (ownLine && read.length && plausibleCompanyCapex(facts, ownUnits)) {
        facts = mergeFactTrees(facts, { company: { [COMPANY_CAPEX_TAG]: { units: ownUnits as Record<string, FilingFact[]> } } });
        notes.push(`Capital expenditure is read from the company's own line ${ownLine.prefix}:${ownLine.name}, which its filings add into cash used in investing activities; the SEC's standard feed does not carry it. Read from ${read.join(", ")}.`);
      }
      if (standardRead.length) {
        notes.push(`Capital expenditure for ${standardRead.join(", ")} is read from the filings themselves: SEC Company Facts had not yet carried it.`);
      }
    }
  } catch { /* The feed's figures stand. */ }

  const dataset = normalizeSecPayload({ ...payload, facts }, ticker, retrievedAt, company);
  if (notes.length) dataset.warnings = [...notes, ...dataset.warnings];
  return dataset;
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
  /** Where the shares actually trade, as the filer states it on its cover. */
  exchanges: z.array(z.string()).optional(),
});

/**
 * Which listing to name when the filer names several.
 *
 * A cover page may state two — a common listing and a warrant's — and the first
 * is the one the ticker being opened trades on. An empty array is an unlisted
 * filer, which keeps the honest generic rather than borrowing a venue.
 */
function exchangeFromSubmissions(exchanges: string[] | undefined): string | null {
  const stated = (exchanges ?? []).map((entry) => entry.trim()).filter(Boolean);
  return stated[0] ?? null;
}

async function resolveSecBusinessMetadata(cik: string) {
  const response = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, {
    headers: { "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com", Accept: "application/json" },
    next: { revalidate: 86_400 },
  });
  if (!response.ok) throw new Error(`SEC company classification returned ${response.status}.`);
  const parsed = SecBusinessMetadataSchema.parse(await response.json());
  const sic = typeof parsed.sic === "string" ? Number.parseInt(parsed.sic, 10) : parsed.sic;
  if (!Number.isInteger(sic)) throw new Error("The SEC company classification did not contain a valid SIC code.");
  return { sic, sicDescription: parsed.sicDescription, exchanges: parsed.exchanges };
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
    // The same document that classifies the economics also says what the
    // company does and where it trades, so a dynamically resolved filer is
    // named as precisely as a hand-listed one instead of reading
    // "US listing · Unclassified" on its own page for ever.
    sector: companySector(metadata) ?? exact.sector,
    exchange: exchangeFromSubmissions(metadata.exchanges) ?? exact.exchange,
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
/** A company's recent periodic reports, newest first. */
export async function fetchPeriodicFilings(cik: string, limit = 8): Promise<LatestFiling[]> {
  const response = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, {
    headers: { ...SEC_HEADERS(), Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  const recent = SubmissionsSchema.parse(await response.json()).filings.recent;
  const filings: LatestFiling[] = [];
  for (let index = 0; index < recent.form.length; index++) {
    if (!PERIODIC.has(recent.form[index])) continue;
    filings.push({ form: recent.form[index], filingDate: recent.filingDate[index], reportDate: recent.reportDate[index], accession: recent.accessionNumber?.[index] });
  }
  return filings.sort((left, right) => right.reportDate.localeCompare(left.reportDate) || right.filingDate.localeCompare(left.filingDate)).slice(0, limit);
}

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
