import { describe, expect, it } from "vitest";
import { flowPeriods, withSources, withoutPassThrough } from "../components/term/MoneyFlow";
import { incomeStatementDiagram } from "../lib/statement-flows";
import type { IoPeriod } from "../lib/io/view";

const period = (label: string, end: string, fiscalQuarter: string | null, revenue: number | null): IoPeriod => ({
  label, end, start: null, fiscalYear: 2026, fiscalQuarter, filingDate: end, publishedAt: end, accession: label, currency: "USD", values: { revenue }, valuationBasis: null,
});

describe("the filings the money flow draws", () => {
  it("takes the latest 10-Q quarter, not a fourth quarter worked out of the 10-K, and the latest year", () => {
    const { quarter, year } = flowPeriods({
      quarterly: [period("Q3 FY2026", "2026-06-27", "Q3", 94), period("Q4 FY2026", "2026-09-26", "Q4", 102)],
      annual: [period("FY 2025", "2025-09-27", null, 416), period("FY 2026", "2026-09-26", null, 430)],
    });
    expect(quarter?.label).toBe("Q3 FY2026");
    expect(year?.label).toBe("FY 2026");
  });

  it("passes over a period with no revenue filed", () => {
    expect(flowPeriods({ quarterly: [period("Q1 FY2027", "2026-12-26", "Q1", null)], annual: [] })).toEqual({ quarter: null, year: null });
  });
});

describe("a node that only passes its source's flow on", () => {
  it("is left out, its outflows leaving from the source", () => {
    const diagram = withoutPassThrough({
      nodes: [{ id: "revenue", label: "Revenue", tone: "revenue" }, { id: "grossProfit", label: "Revenue less cost", tone: "profit" }, { id: "opex", label: "Other operating", tone: "cost" }, { id: "operatingIncome", label: "Operating income", tone: "profit" }],
      flows: [{ source: "revenue", target: "grossProfit", value: 100 }, { source: "grossProfit", target: "opex", value: 80 }, { source: "grossProfit", target: "operatingIncome", value: 20 }],
      values: {}, notes: [], currency: "USD", periodLabel: "Q2", periodEnd: "2026-06-30",
    });
    expect(diagram.nodes.map((node) => node.id)).toEqual(["revenue", "opex", "operatingIncome"]);
    expect(diagram.flows).toEqual([{ source: "revenue", target: "opex", value: 80 }, { source: "revenue", target: "operatingIncome", value: 20 }]);
  });
});

describe("where the revenue came from", () => {
  const diagram = withoutPassThrough(incomeStatementDiagram({
    value: (metric) => ({ revenue: 100, costOfRevenue: 60, grossProfit: 40, operatingIncome: 15, incomeTaxExpense: 3, netIncome: 12 } as Record<string, number>)[metric] ?? null,
    freeCashFlow: () => null, currency: "USD", periodLabel: "Q2", periodEnd: "2026-06-30",
  })!);

  it("flows from each line of a cut that adds up to the revenue, into the revenue", () => {
    const drawn = withSources(diagram, { id: "business|", title: "By segment", total: 100, lines: [{ id: "a", label: "Walmart U.S.", value: 67 }, { id: "b", label: "Sam's Club U.S.", value: 33 }] });
    expect(drawn.flows.filter((flow) => flow.target === "revenue")).toEqual([{ source: "source:a", target: "revenue", value: 67 }, { source: "source:b", target: "revenue", value: 33 }]);
    expect(drawn.nodes[0]).toMatchObject({ label: "Walmart U.S.", tone: "revenue" });
  });

  it("sums the smallest lines past seven, and leaves out a cut that does not add up to the revenue", () => {
    const lines = Array.from({ length: 10 }, (_, index) => ({ id: `l${index}`, label: `Line ${index}`, value: 10 }));
    const drawn = withSources(diagram, { id: "geography|", title: "By region", total: 100, lines });
    expect(drawn.nodes.filter((node) => node.id.startsWith("source:")).map((node) => node.label)).toEqual(["Line 0", "Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Other"]);
    expect(drawn.values["source:other"]).toBe(40);
    expect(withSources(diagram, { id: "x", title: "By segment", total: 120, lines: [{ id: "a", label: "A", value: 60 }, { id: "b", label: "B", value: 60 }] })).toBe(diagram);
  });
});
