import { describe, expect, it } from "vitest";
import { auditMetric, buildCoverage } from "../lib/coverage";
import type { CompanyDataset, FinancialPeriod, NormalizedFact } from "../lib/types";

const fact = (value: number, end: string): NormalizedFact => ({
  metric: "revenue", value, currency: "USD", unit: "currency", periodEnd: end,
  periodicity: "annual", fiscalYear: Number(end.slice(0, 4)),
  provenance: { provider: "SEC", sourceUrl: "sec", retrievedAt: "now", concept: "us-gaap:Revenues", status: "reported" },
});

const period = (year: number, value: number | null): FinancialPeriod => ({
  label: `FY ${year}`, fiscalYear: year, periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`,
  periodicity: "annual", filingDate: `${year + 1}-02-01`, accession: String(year), currency: "USD",
  facts: value == null ? {} : { revenue: fact(value, `${year}-12-31`) },
});

const dataset = (values: Array<number | null>, businessType: CompanyDataset["company"]["businessType"] = "operating"): CompanyDataset => ({
  company: { name: "Coverage Corp", ticker: "COV", cik: "1", exchange: "NYSE", currency: "USD", sector: "", description: "", businessType },
  periods: values.map((value, index) => period(2020 + index, value)), retrievedAt: "now", warnings: [],
});

describe("metric coverage describes the shape of missing data", () => {
  it("distinguishes internal, leading and trailing gaps", () => {
    const audit = auditMetric(dataset([null, 100, null, 120, null]), "revenue", "annual");
    expect(audit).toMatchObject({ status: "Partially available", available: 2, total: 5, leadingMissing: 1, internalGaps: 1, trailingMissing: 1 });
    expect(audit.reason).toContain("1 internal gaps");
    expect(buildCoverage(dataset([null, 100, null, 120, null])).revenue.status).toBe("Partially available");
  });

  it("labels industrial cash metrics as inapplicable for a financial institution", () => {
    const audit = auditMetric(dataset([100, 110], "bank"), "freeCashFlow", "annual");
    expect(audit.status).toBe("Not economically applicable");
    expect(audit.reason).toContain("financial institutions");
  });
});
