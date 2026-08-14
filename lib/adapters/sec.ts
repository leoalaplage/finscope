import { z } from "zod";
import { COMPANIES } from "../company-registry";
import { adjustPeriodsForSplits, buildTtmPeriods, normalizeAnnualPeriods, normalizeQuarterlyPeriods } from "../periods";
import { validateCompanyDataset } from "../data-quality";
import type { CompanyDataset, MetricKey, RawFinancialFact } from "../types";

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
type ConceptSpec = { namespace: "us-gaap" | "dei"; tags: string[]; unit: "currency" | "shares" };

export const SEC_CONCEPTS: Record<Exclude<MetricKey, "freeCashFlow" | "netShareRepurchases">, ConceptSpec> = {
  revenue: { namespace: "us-gaap", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"], unit: "currency" },
  grossProfit: { namespace: "us-gaap", tags: ["GrossProfit"], unit: "currency" },
  costOfRevenue: { namespace: "us-gaap", tags: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"], unit: "currency" },
  operatingIncome: { namespace: "us-gaap", tags: ["OperatingIncomeLoss"], unit: "currency" },
  netIncome: { namespace: "us-gaap", tags: ["NetIncomeLoss", "ProfitLoss"], unit: "currency" },
  operatingCashFlow: { namespace: "us-gaap", tags: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], unit: "currency" },
  // Tags are alternatives in preference order, not addends. The last two cover
  // filers that report no property-and-equipment line at all: Cboe and
  // Interactive Brokers use the net productive-assets concept, and Veeva
  // stopped tagging property purchases after FY2020 and now reports only
  // capitalized software. Without them free cash flow simply stopped.
  capitalExpenditures: { namespace: "us-gaap", tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForProceedsFromProductiveAssets", "PaymentsForSoftware"], unit: "currency" },
  acquisitions: { namespace: "us-gaap", tags: ["PaymentsToAcquireBusinessesNetOfCashAcquired", "PaymentsToAcquireBusinessesGross"], unit: "currency" },
  dividendsPaid: { namespace: "us-gaap", tags: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsOfOrdinaryDividends"], unit: "currency" },
  dilutedShares: { namespace: "us-gaap", tags: ["WeightedAverageNumberOfDilutedSharesOutstanding"], unit: "shares" },
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
      const unitKey = spec.unit === "shares" ? "shares" : currency;
      const unitFacts: SecUnit[] = node.units[unitKey] ?? [];
      for (const fact of unitFacts) {
        if ((fact.form !== "10-Q" && fact.form !== "10-K") || fact.fy == null || !["Q1", "Q2", "Q3", "FY"].includes(fact.fp ?? "")) continue;
        output.push({
          metric, value: fact.val, currency, unit: spec.unit, start: fact.start, end: fact.end,
          filed: fact.filed, accession: fact.accn, fiscalYear: fact.fy,
          fiscalPeriod: fact.fp as RawFinancialFact["fiscalPeriod"], form: fact.form as RawFinancialFact["form"],
          concept: `${spec.namespace}:${tag}`, sourceUrl: sourceUrl(cik, fact.accn), retrievedAt,
        });
      }
    }
  }
  return output;
}

export function normalizeSecPayload(payload: unknown, ticker: string, retrievedAt = new Date().toISOString(), resolvedCompany?: CompanyDataset["company"]): CompanyDataset {
  const company = resolvedCompany ?? COMPANIES.find((item) => item.ticker === ticker.toUpperCase());
  if (!company) throw new Error("Ticker not supported by the SEC adapter registry.");
  if (!company.cik) throw new Error(company.resolutionNote || "No reliable regulatory identifier is available for this instrument.");
  const parsed = SecResponseSchema.parse(payload);
  const rawFacts = extractFacts(parsed.facts, company.cik, company.currency, retrievedAt);
  const annual = adjustPeriodsForSplits(normalizeAnnualPeriods(rawFacts, company.currency), company.stockSplits);
  const quarterly = adjustPeriodsForSplits(normalizeQuarterlyPeriods(rawFacts, company.currency), company.stockSplits);
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
