import { z } from "zod";
import { COMPANIES } from "../company-registry";
import { adjustPeriodsForSplits, buildTtmPeriods, normalizeAnnualPeriods, normalizeQuarterlyPeriods } from "../periods";
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
        if ((fact.form !== "10-Q" && fact.form !== "10-K") || fact.fy == null || !["Q1", "Q2", "Q3", "FY"].includes(fact.fp ?? "")) continue;
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

export function normalizeSecPayload(payload: unknown, ticker: string, retrievedAt = new Date().toISOString(), resolvedCompany?: CompanyDataset["company"]): CompanyDataset {
  const company = resolvedCompany ?? COMPANIES.find((item) => item.ticker === ticker.toUpperCase());
  if (!company) throw new Error("Ticker not supported by the SEC adapter registry.");
  if (!company.cik) throw new Error(company.resolutionNote || "No reliable regulatory identifier is available for this instrument.");
  const parsed = SecResponseSchema.parse(payload);
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
  return validateCompanyDataset({
    company: { ...company, name: parsed.entityName }, periods: [...annual, ...quarterly, ...ttm], retrievedAt,
    warnings: [
      "Quarterly cash-flow facts may be isolated from year-to-date disclosures; every derived quarter is marked calculated with its source accessions.",
      ttm.length ? `TTM is available through ${ttm.at(-1)!.periodEnd} from four consecutive fiscal quarters.` : "TTM unavailable: four consecutive reliable quarters were not found.",
      "Standardized concepts only: company extensions and non-GAAP values remain separate and are not imputed.",
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
  return entries.filter((entry) => entry.ticker.includes(needle) || entry.title.toUpperCase().includes(needle)).slice(0, 12).map((entry) => ({ name: entry.title, ticker: entry.ticker, cik: String(entry.cik_str).padStart(10,"0"), regulatoryId: `CIK ${String(entry.cik_str).padStart(10,"0")}`, exchange: "US exchange · verify in Yahoo", currency: "USD", yahooTicker: entry.ticker, sector: "Unclassified", description: "Dynamically resolved from the SEC company registry.", resolutionStatus: "partial" as const, resolutionNote: "CIK verified by SEC; exchange and instrument identity should be confirmed before relying on market data.", businessType: "operating" as const }));
}
async function resolveSecCompany(ticker: string) {
  const results = await searchSecCompanies(ticker); const exact = results.find((entry) => entry.ticker === ticker.toUpperCase());
  if (!exact) throw new Error("Ticker could not be resolved uniquely in the SEC registry.");
  return exact;
}
