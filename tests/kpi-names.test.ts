import { describe, expect, it } from "vitest";
import { kpiRows, tableCaption } from "../lib/adapters/kpi-tables";
import { describeKpi, type KpiParts } from "../lib/kpi-names";

const named = (parts: Partial<KpiParts> & { label: string }) =>
  describeKpi({ caption: null, section: null, measure: null, unit: "count", scale: null, ...parts });

describe("what a KPI card says it measures", () => {
  it("names the business a table is about, from the heading above it", () => {
    expect(named({ caption: "Walmart U.S. Segment", label: "Comp sales (ex. fuel)", unit: "percent" })?.name).toBe("Walmart U.S. comparable sales, ex. fuel · y/y");
    expect(named({ caption: "Sam's Club U.S. Segment", section: "Comparable sales", label: "With Fuel", unit: "percent" })?.name).toBe("Sam's Club U.S. comparable sales, incl. fuel · y/y");
    expect(named({ caption: "Walmart International Segment", label: "Unit counts at period end" })).toMatchObject({ name: "Walmart International unit counts · end of quarter", suffix: "units" });
  });

  it("leaves out a heading that only says the table holds figures", () => {
    expect(named({ caption: "Financial and Operational Highlights for Second Quarter 2026", label: "Trips" })?.name).toBe("Trips");
    expect(named({ caption: "Membership Fees", label: "Total paid members (000s)" })).toMatchObject({ name: "Total paid members", scale: "thousands", suffix: "members" });
    expect(named({ section: "Percentage of net sales", label: "Retail square feet at period end", unit: "currency", scale: "millions" })).toMatchObject({ name: "Retail square feet · end of quarter", unit: "count", suffix: "sq ft" });
  });

  it("takes the unit from what is measured, not from the table's dollars", () => {
    expect(named({ caption: "($ in millions)", label: "Average active accounts (in thousands)", unit: "currency", scale: "thousands" })).toMatchObject({ unit: "count", scale: "thousands", suffix: "accounts" });
    // "U.S. dollars in millions" is said of the dollars: 1,359 stores are not 1.4 billion.
    expect(named({ section: "Stores in operation at end of period", label: "TJ Maxx", unit: "currency", scale: "millions", dollarScale: true })).toMatchObject({ unit: "count", scale: null, suffix: "stores" });
    expect(named({ caption: "Unit", section: "U.S. Upstream", label: "Net Oil-Equivalent Production (MBOED)", unit: "currency" })).toMatchObject({ name: "U.S. Upstream net oil-equivalent production", unit: "count", suffix: "MBOE/d" });
    expect(named({ label: "Haynesville", measure: "$/Mcf" })).toMatchObject({ name: "Haynesville average price", unit: "currency", suffix: "/Mcf" });
    expect(named({ label: "Square footage per store" })).toMatchObject({ unit: "count", suffix: "sq ft" });
  });

  it("says the change of a figure in per cent, and on what basis", () => {
    expect(named({ caption: "Regional Breakdown", section: "EMEA", label: "Revenue, F/X Neutral Y/Y % Growth", unit: "percent" })?.name).toBe("EMEA revenue, constant currency · y/y");
    expect(named({ label: "Growth Rate (Square Footage)", unit: "percent" })?.name).toBe("Square footage · y/y");
  });

  it("shows no card for what is not an operating figure", () => {
    expect(named({ section: "Foreign currency", label: "Latest Maturity (1)" })).toBeNull();
    expect(named({ label: "Beginning balance", section: "Customers" })).toBeNull();
    expect(named({ label: "Revenue, y/Y % Growth", unit: "percent" })).toBeNull();
    expect(named({ caption: "NOTES TO CONDENSED CONSOLIDATED FINANCIAL STATEMENTS (continued)", label: "Encore Boston Harbor", unit: "currency" })).toBeNull();
  });

  it("keeps a table whose caption only mentions a reconciliation in passing", () => {
    expect(named({ caption: "Products Pipelines (including reconciliation of Segment EBDA to Adjusted Segment EBDA)", section: "Volumetric data", label: "Total delivery volumes (MBbl/d)", unit: "currency", scale: "millions" }))
      .toMatchObject({ name: "Products Pipelines total delivery volumes", unit: "count", suffix: "Mbbl/d" });
  });
});

describe("the heading above a table", () => {
  it("is the last short line before it, past the notes on units", () => {
    expect(tableCaption("<p>Net sales grew as described below.</p><p>Walmart U.S. Segment</p><p>(Dollar amounts in millions)</p>")).toBe("Walmart U.S. Segment");
    expect(tableCaption("<p>($ in millions)</p>")).toBeNull();
    expect(tableCaption("<p>The following table presents our results for the quarter, which we discuss at length below in the text.</p>")).toBeNull();
  });

  it("tells apart the same row printed for each segment", () => {
    const table = (segment: string, value: string) =>
      `<p>${segment}</p><table><tr><td></td><td>Three Months Ended July 31,</td></tr><tr><td></td><td>2026</td><td>2025</td></tr><tr><td>Transactions</td><td>${value}%</td><td>1.0%</td></tr></table>`;
    const rows = kpiRows(table("Walmart U.S. Segment", "1.5") + table("Sam's Club U.S. Segment", "7.0"));
    const transactions = rows.filter((row) => row.label === "Transactions");
    expect(transactions.map((row) => row.caption)).toEqual(["Walmart U.S. Segment", "Sam's Club U.S. Segment"]);
    expect(new Set(transactions.map((row) => row.key)).size).toBe(2);
  });
});
