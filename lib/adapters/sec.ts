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
  totalDebt: { namespace: "us-gaap", tags: ["LongTermDebtAndFinanceLeaseObligationsCurrentAndNoncurrent", "LongTermDebtCurrent", "LongTermDebtNoncurrent"], unit: "currency" },
  currentAssets: { namespace: "us-gaap", tags: ["AssetsCurrent"], unit: "currency" },
  // Including noncontrolling interests as a fallback: Visa reports almost only
  // that form, and invested capital wants the whole financing base anyway.
  totalEquity: { namespace: "us-gaap", tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], unit: "currency" },
  currentLiabilities: { namespace: "us-gaap", tags: ["LiabilitiesCurrent"], unit: "currency" },
  incomeBeforeTax: { namespace: "us-gaap", tags: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"], unit: "currency" },
  incomeTaxExpense: { namespace: "us-gaap", tags: ["IncomeTaxExpenseBenefit"], unit: "currency" },
  depreciationAndAmortization: { namespace: "us-gaap", tags: ["DepreciationDepletionAndAmortization", "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment", "Depreciation"], unit: "currency" },
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

export function normalizeSecPayload(payload: unknown, ticker: string, retrievedAt = new Date().toISOString(), resolvedCompany?: CompanyDataset["company"]): CompanyDataset {
  const company = resolvedCompany ?? COMPANIES.find((item) => item.ticker === ticker.toUpperCase());
  if (!company) throw new Error("Ticker not supported by the SEC adapter registry.");
  if (!company.cik) throw new Error(company.resolutionNote || "No reliable regulatory identifier is available for this instrument.");
  const parsed = SecResponseSchema.parse(payload);
  const rawFacts = extractFacts(parsed.facts, company.cik, company.currency, retrievedAt);
  const annual = adjustPeriodsForSplits(recoverDilutedShares(normalizeAnnualPeriods(rawFacts, company.currency)), company.stockSplits);
  const quarterly = adjustPeriodsForSplits(recoverDilutedShares(normalizeQuarterlyPeriods(rawFacts, company.currency)), company.stockSplits);
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
