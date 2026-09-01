import { describe, expect, it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { preferTotalRevenue } from "../lib/periods";
import type { CompanyDataset, RawFinancialFact } from "../lib/types";

/*
 * Revenue means every revenue the company earned.
 *
 * Berkshire Hathaway's 2025 annual report states 371.4bn of total revenues.
 * FinScope showed 247.2bn under the label "Revenue" — the ASC 606 contract
 * revenue alone, with insurance premiums earned and investment income left
 * out — because the concept preference order put the contract tag first and
 * nothing ever compared the two. The headline, every margin computed on it and
 * every multiple inherited the gap.
 *
 * Driven through the SEC adapter rather than through hand-built facts, so the
 * preference order between the two concepts is the real one and a fixture
 * cannot accidentally prove the opposite of what the pipeline does.
 */

const CONTRACT = "RevenueFromContractWithCustomerExcludingAssessedTax";
const TOTAL = "Revenues";

type Unit = { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string };
const unit = (val: number, start: string, end: string, fp: string, form = fp === "FY" ? "10-K" : "10-Q"): Unit =>
  ({ start, end, val, accn: `0001067983-26-${end}`, fy: 2025, fp, form, filed: "2026-02-27" });

function payload(concepts: Record<string, Unit[]>) {
  return { entityName: "Berkshire Hathaway Inc", facts: { "us-gaap": Object.fromEntries(Object.entries(concepts).map(([tag, units]) => [tag, { units: { USD: units } }])) } };
}

const company: CompanyDataset["company"] = { name: "Berkshire Hathaway Inc", ticker: "BRK-B", cik: "0001067983", exchange: "NYSE", currency: "USD", sector: "Financials", description: "A fixture." };
const normalize = (concepts: Record<string, Unit[]>) => normalizeSecPayload(payload(concepts), "BRK-B", "2026-08-31", company);
const annualOf = (dataset: CompanyDataset) => dataset.periods.find((period) => period.periodicity === "annual")!;

const berkshireYear = {
  [CONTRACT]: [unit(247_244e6, "2025-01-01", "2025-12-31", "FY")],
  [TOTAL]: [unit(371_444e6, "2025-01-01", "2025-12-31", "FY")],
};

describe("revenue is the total, not a component of it", () => {
  it("reports the filer's total revenues over its contract revenue", () => {
    const year = annualOf(normalize(berkshireYear));
    expect(year.facts.revenue?.value).toBe(371_444e6);
    expect(year.facts.revenue?.provenance.concept).toBe(`us-gaap:${TOTAL}`);
  });

  it("states the reconciliation rather than swapping one figure for the other", () => {
    const note = annualOf(normalize(berkshireYear)).facts.revenue?.provenance.note ?? "";
    expect(note).toContain("247.2B");
    expect(note).toContain("371.4B");
    // The difference is named as what it is, not left for the reader to subtract.
    expect(note).toContain("124.2B");
    expect(note).toContain("outside contracts with customers");
  });

  it("leaves a filer whose two tags agree exactly as it was", () => {
    // Costco tags 275.2bn under both concepts. There is nothing to reconcile,
    // and the preferred concept stays the one the rest of the pipeline uses.
    const year = annualOf(normalize({
      [CONTRACT]: [unit(275_235e6, "2024-09-02", "2025-08-31", "FY")],
      [TOTAL]: [unit(275_235e6, "2024-09-02", "2025-08-31", "FY")],
    }));
    expect(year.facts.revenue?.value).toBe(275_235e6);
    expect(year.facts.revenue?.provenance.concept).toBe(`us-gaap:${CONTRACT}`);
    expect(year.facts.revenue?.provenance.note).not.toContain("Reconciled");
  });

  it("never promotes a Revenues tag smaller than the concept already in use", () => {
    // A total cannot be less than a component of itself. Where it is, the tag
    // describes something narrower under that name — a net revenue against a
    // gross one — and the chosen concept is left alone.
    const raw = (value: number, concept: string): RawFinancialFact => ({
      metric: "revenue", value, currency: "USD", unit: "currency", start: "2021-01-01", end: "2021-12-31",
      filed: "2022-02-01", accession: "a", fiscalYear: 2021, fiscalPeriod: "FY", form: "10-K",
      concept, sourceUrl: "sec", retrievedAt: "now",
    });
    const facts = [raw(18_884e6, "us-gaap:Revenues"), raw(29_800e6, `us-gaap:${CONTRACT}`)];
    expect(preferTotalRevenue(facts, facts[1])?.value).toBe(29_800e6);
    expect(preferTotalRevenue(facts, facts[1])?.normalizationNote).toBeUndefined();
  });

  it("does not let a later smaller Revenues segment become the annual top line", () => {
    const year = annualOf(normalize({
      SalesRevenueNet: [unit(82_006e6, "2024-01-01", "2024-12-31", "FY")],
      [TOTAL]: [unit(28_400e6, "2024-01-01", "2024-12-31", "FY")],
    }));
    expect(year.facts.revenue?.value).toBe(82_006e6);
    expect(year.facts.revenue?.provenance.concept).toBe("us-gaap:SalesRevenueNet");
  });

  it("derives the quarters of a reconciled year from the same total", () => {
    const dataset = normalize({
      [CONTRACT]: [
        unit(247_244e6, "2025-01-01", "2025-12-31", "FY"),
        unit(59_310e6, "2025-01-01", "2025-03-31", "Q1"),
        unit(120_540e6, "2025-01-01", "2025-06-30", "Q2"),
      ],
      [TOTAL]: [
        unit(371_444e6, "2025-01-01", "2025-12-31", "FY"),
        unit(89_868e6, "2025-01-01", "2025-03-31", "Q1"),
        unit(182_197e6, "2025-01-01", "2025-06-30", "Q2"),
      ],
    });
    const quarters = dataset.periods.filter((period) => period.periodicity === "quarterly");
    expect(quarters[0].facts.revenue?.value).toBe(89_868e6);
    expect(quarters[0].facts.revenue?.provenance.concept).toBe(`us-gaap:${TOTAL}`);
    // Q2 is the cumulative half less the first quarter, both on the total line:
    // a year stated as a total is never divided into quarters of a component.
    expect(quarters[1].facts.revenue?.value).toBe(92_329e6);
    expect(quarters[1].facts.revenue?.provenance.concept).toBe(`us-gaap:${TOTAL}`);
  });
});
