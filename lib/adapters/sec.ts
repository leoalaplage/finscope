import { z } from "zod";
import { COMPANIES } from "../company-registry";
import type { CompanyDataset, FinancialPeriod, MetricKey, NormalizedFact } from "../types";

const SecUnitSchema = z.object({
  start: z.string().optional(),
  end: z.string(),
  val: z.number(),
  accn: z.string(),
  fy: z.number().nullable().optional(),
  fp: z.string().nullable().optional(),
  form: z.string(),
  filed: z.string(),
  frame: z.string().optional(),
});

const SecResponseSchema = z.object({
  entityName: z.string(),
  facts: z.record(z.string(), z.record(z.string(), z.object({
    units: z.record(z.string(), z.array(SecUnitSchema)),
  }))),
});

type SecUnit = z.infer<typeof SecUnitSchema>;

const CONCEPTS: Record<MetricKey, string[]> = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capitalExpenditures: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  freeCashFlow: [],
  dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  basicShares: ["WeightedAverageNumberOfSharesOutstanding"],
  sharesOutstanding: ["EntityCommonStockSharesOutstanding"],
  shareRepurchases: ["PaymentsForRepurchaseOfCommonStock"],
  shareIssuance: ["ProceedsFromStockOptionsExercised", "ProceedsFromIssuanceOfCommonStock"],
};

function durationDays(fact: SecUnit) {
  if (!fact.start) return 0;
  return (Date.parse(fact.end) - Date.parse(fact.start)) / 86_400_000;
}

function sourceUrl(cik: string, accession: string) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/`;
}

function chooseAnnual(
  namespaces: Record<string, { units: Record<string, SecUnit[]> }>,
  metric: MetricKey,
  fiscalYear: number,
) {
  for (const concept of CONCEPTS[metric]) {
    const node = namespaces[concept];
    if (!node) continue;
    const unitName = metric.includes("Shares") || metric === "basicShares" || metric === "sharesOutstanding" ? "shares" : "USD";
    const candidates = (node.units[unitName] ?? [])
      .filter((fact) => fact.form === "10-K" && fact.fy === fiscalYear && fact.fp === "FY")
      .filter((fact) => metric === "sharesOutstanding" || (durationDays(fact) >= 300 && durationDays(fact) <= 400))
      .sort((a, b) => a.filed.localeCompare(b.filed));
    const chosen = candidates.at(-1);
    if (chosen) return { chosen, concept, unitName };
  }
  return null;
}

export async function fetchSecCompany(ticker: string): Promise<CompanyDataset> {
  const company = COMPANIES.find((item) => item.ticker === ticker.toUpperCase());
  if (!company) throw new Error("Ticker not supported by the SEC adapter demo registry.");

  const retrievedAt = new Date().toISOString();
  const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json`, {
    headers: {
      "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com",
      Accept: "application/json",
    },
    next: { revalidate: 21_600 },
  });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  const parsed = SecResponseSchema.parse(await response.json());
  const namespaces = parsed.facts["us-gaap"] ?? parsed.facts["ifrs-full"];
  if (!namespaces) throw new Error("No supported GAAP namespace found.");

  const years = new Set<number>();
  for (const concept of CONCEPTS.revenue) {
    for (const units of Object.values(namespaces[concept]?.units ?? {})) {
      for (const fact of units) if (fact.fy && fact.form === "10-K") years.add(fact.fy);
    }
  }

  const periods: FinancialPeriod[] = [...years].sort((a, b) => a - b).map((fiscalYear) => {
    const facts: Partial<Record<MetricKey, NormalizedFact>> = {};
    let anchor: SecUnit | null = null;
    let accession = "";
    let filingDate = "";
    for (const metric of Object.keys(CONCEPTS) as MetricKey[]) {
      if (metric === "freeCashFlow") continue;
      const selection = chooseAnnual(namespaces, metric, fiscalYear);
      if (!selection) continue;
      const { chosen, concept, unitName } = selection;
      anchor ??= chosen;
      accession ||= chosen.accn;
      filingDate ||= chosen.filed;
      facts[metric] = {
        metric,
        value: chosen.val,
        currency: company.currency,
        unit: unitName === "shares" ? "shares" : "currency",
        periodStart: chosen.start,
        periodEnd: chosen.end,
        periodicity: "annual",
        fiscalYear,
        provenance: {
          provider: "SEC",
          sourceUrl: sourceUrl(company.cik, chosen.accn),
          accession: chosen.accn,
          filingDate: chosen.filed,
          retrievedAt,
          concept,
          status: "reported",
          note: "Latest annual XBRL fact filed for this fiscal year and concept.",
        },
      };
    }
    return {
      label: `FY ${fiscalYear}`,
      fiscalYear,
      periodStart: anchor?.start,
      periodEnd: anchor?.end ?? `${fiscalYear}-12-31`,
      periodicity: "annual" as const,
      filingDate,
      accession,
      currency: company.currency,
      facts,
    };
  }).filter((period) => period.facts.revenue);

  return {
    company: { ...company, name: parsed.entityName },
    periods,
    retrievedAt,
    warnings: [
      "SEC XBRL history generally starts in 2009; older filings require a separate filing-document adapter.",
      "Company-specific extensions and changes in XBRL concepts can produce gaps; gaps are never imputed.",
      "Yahoo Finance pricing is isolated from SEC fundamentals and may be unavailable because its interface is unofficial.",
    ],
  };
}
