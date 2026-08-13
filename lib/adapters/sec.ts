import { z } from "zod";
import { COMPANIES } from "../company-registry";
import { adjustPeriodsForSplits, buildTtmPeriods, normalizeAnnualPeriods, normalizeQuarterlyPeriods } from "../periods";
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
  revenue: { namespace: "us-gaap", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], unit: "currency" },
  grossProfit: { namespace: "us-gaap", tags: ["GrossProfit"], unit: "currency" },
  operatingIncome: { namespace: "us-gaap", tags: ["OperatingIncomeLoss"], unit: "currency" },
  netIncome: { namespace: "us-gaap", tags: ["NetIncomeLoss", "ProfitLoss"], unit: "currency" },
  operatingCashFlow: { namespace: "us-gaap", tags: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], unit: "currency" },
  capitalExpenditures: { namespace: "us-gaap", tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], unit: "currency" },
  dilutedShares: { namespace: "us-gaap", tags: ["WeightedAverageNumberOfDilutedSharesOutstanding"], unit: "shares" },
  basicShares: { namespace: "us-gaap", tags: ["WeightedAverageNumberOfSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"], unit: "shares" },
  sharesOutstanding: { namespace: "us-gaap", tags: ["CommonStockSharesOutstanding"], unit: "shares" },
  sharesIssued: { namespace: "us-gaap", tags: ["CommonStockSharesIssued"], unit: "shares" },
  treasuryShares: { namespace: "us-gaap", tags: ["TreasuryStockShares"], unit: "shares" },
  stockBasedCompensation: { namespace: "us-gaap", tags: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"], unit: "currency" },
  shareRepurchases: { namespace: "us-gaap", tags: ["PaymentsForRepurchaseOfCommonStock"], unit: "currency" },
  shareIssuance: { namespace: "us-gaap", tags: ["ProceedsFromStockOptionsExercised", "ProceedsFromIssuanceOfCommonStock", "ProceedsFromIssuanceOfSharesUnderIncentiveAndShareBasedCompensationPlansIncludingStockOptions"], unit: "currency" },
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

export function normalizeSecPayload(payload: unknown, ticker: string, retrievedAt = new Date().toISOString()): CompanyDataset {
  const company = COMPANIES.find((item) => item.ticker === ticker.toUpperCase());
  if (!company) throw new Error("Ticker not supported by the SEC adapter registry.");
  const parsed = SecResponseSchema.parse(payload);
  const rawFacts = extractFacts(parsed.facts, company.cik, company.currency, retrievedAt);
  const annual = adjustPeriodsForSplits(normalizeAnnualPeriods(rawFacts, company.currency), company.stockSplits);
  const quarterly = adjustPeriodsForSplits(normalizeQuarterlyPeriods(rawFacts, company.currency), company.stockSplits);
  const ttm = buildTtmPeriods(quarterly, company.currency);
  return {
    company: { ...company, name: parsed.entityName }, periods: [...annual, ...quarterly, ...ttm], retrievedAt,
    warnings: [
      "Quarterly cash-flow facts may be isolated from year-to-date disclosures; every derived quarter is marked calculated with its source accessions.",
      ttm.length ? `TTM is available through ${ttm.at(-1)!.periodEnd} from four consecutive fiscal quarters.` : "TTM unavailable: four consecutive reliable quarters were not found.",
      "Standardized concepts only: company extensions and non-GAAP values remain separate and are not imputed.",
    ],
  };
}

export async function fetchSecCompany(ticker: string): Promise<CompanyDataset> {
  const company = COMPANIES.find((item) => item.ticker === ticker.toUpperCase());
  if (!company) throw new Error("Ticker not supported by the SEC adapter registry.");
  const retrievedAt = new Date().toISOString();
  const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json`, {
    headers: { "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com", Accept: "application/json" },
    next: { revalidate: 21_600 },
  });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  return normalizeSecPayload(await response.json(), ticker, retrievedAt);
}
