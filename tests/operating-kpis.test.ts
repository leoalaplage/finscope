import { describe, expect, it } from "vitest";
import { anchorDocuments, isOperating, kpiRows } from "../lib/adapters/kpi-tables";
import { assembleKpis, kpiDocuments, nextQuarterEnd, yearApart, yearToDate, type KpiDocument, type KpiPoint } from "../lib/operating-kpis";

const table = (title: string, rows: string[][], header = ["", "2026", "2025", "% Change"]) =>
  `<table><tr><td>${title}</td></tr><tr>${header.map((cell) => `<td>${cell}</td>`).join("")}</tr>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</table>`;
const quarter = (rows: string[][], header?: string[]) => table("Three Months Ended September 30,", rows, header);

describe("an operating row proven a year apart", () => {
  it("reads the quarter where last year's document printed its own", () => {
    const newer = kpiRows(quarter([["Available seat miles (millions)", "79,288", "79,054", "0.3 %"], ["Passenger load factor", "86.0 %", "86.0 %", "— pts"]]));
    const older = kpiRows(quarter([["Available seat miles (millions)", "79,054", "76,162", "3.8 %"]]));
    const [asm] = anchorDocuments(newer, older);
    expect(asm).toMatchObject({ label: "Available seat miles (millions)", unit: "count", scale: "millions", current: { value: 79288 }, yearAgo: { value: 79054 } });
  });

  it("reads a release that prints last year first", () => {
    const newer = kpiRows(quarter([["Paid members (000s)", "79,600", "82,900"]], ["", "2025", "2026"]));
    const older = kpiRows(quarter([["Paid members (000s)", "74,500", "79,600"]], ["", "2024", "2025"]));
    expect(anchorDocuments(newer, older)[0]).toMatchObject({ current: { value: 82900 }, yearAgo: { value: 79600 } });
  });

  it("reads five quarters side by side, newest first, from both ends", () => {
    const newer = kpiRows(quarter([["Comparable restaurant sales increase/(decrease)", "2.2 %", "0.5 %", "(2.5) %", "0.3 %", "(4.0) %"]], ["", "Q2 26", "Q1 26", "Q4 25", "Q3 25", "Q2 25"]));
    const older = kpiRows(quarter([["Comparable restaurant sales increase", "(4.0) %", "(0.4) %", "5.4 %", "6.0 %", "11.1 %"]], ["", "Q2 25", "Q1 25", "Q4 24", "Q3 24", "Q2 24"]));
    expect(anchorDocuments(newer, older)[0]).toMatchObject({ unit: "percent", current: { value: 2.2 }, yearAgo: { value: -4 } });
  });

  it("proves nothing on a figure too coarse to be a coincidence-free match", () => {
    const newer = kpiRows(quarter([["Restaurants opened", "27", "12"]]));
    const older = kpiRows(quarter([["Restaurants opened", "12", "40"]]));
    expect(anchorDocuments(newer, older)).toEqual([]);
  });

  it("does not read a table whose first columns are a period and whose next ones are a measure", () => {
    const html = (one: string, two: string) => `<table><tr><td>Net stores opened/(closed) during the period</td></tr><tr><td>Quarter Ended</td><td>Stores open as of</td></tr><tr><td>Company-operated stores</td><td>${one}</td><td>${two}</td><td>11,078</td><td>11,242</td></tr></table>`;
    expect(anchorDocuments(kpiRows(html("160", "181")), kpiRows(html("181", "113")))).toEqual([]);
  });

  it("does not read past the first two figures, where another measure sits", () => {
    const newer = kpiRows(quarter([["Licensed stores", "(14)", "30", "7,222", "7,281"]], ["", "Q3 26", "Q3 25", "Jun 2026", "Jun 2025"]));
    const older = kpiRows(quarter([["Licensed stores", "30", "52", "7,281", "7,100"]], ["", "Q3 25", "Q3 24", "Jun 2025", "Jun 2024"]));
    expect(anchorDocuments(newer, older)).toEqual([]);
  });
});

describe("what is not an operating figure", () => {
  it("leaves the statements, the adjustments, the year to date and a cost called occupancy out", () => {
    const statement = kpiRows(quarter([["Total revenues", "$ 1,000", "900"], ["Operating income", "200", "150"], ["Marketing", "50", "40"], ["Revenue per available room", "$ 194", "192"]]));
    expect(statement.filter(isOperating).map((row) => row.label)).toEqual(["Revenue per available room"]);
    const reconciliation = kpiRows(quarter([["CASM-ex (cents)", "13.12", "12.36"], ["TRASM, adjusted", "22.18", "19.22"], ["CASM (cents)", "18.99", "16.49"]]));
    expect(reconciliation.filter(isOperating)).toEqual([]);
    const sixMonths = kpiRows(table("Six Months Ended June 30, compared with the second quarter", [["Shipments (cans in millions)", "165.8", "185.6"]]));
    expect(sixMonths).toEqual([]);
    const cost = kpiRows(quarter([["Occupancy", "174,210", "154,250"]]));
    expect(cost.filter(isOperating)).toEqual([]);
  });

  it("names the heading a row sits under, and drops it below a heading that is itself a measure", () => {
    const rows = kpiRows(quarter([["Gross Bookings"], ["Mobility", "$ 28,988", "$ 23,762"], ["Delivery", "27,463", "21,734"], ["Passenger load factor:"], ["Consolidated", "83.4 %", "83.1 %"], ["PRASM (cents)", "18.45", "16.40"]]));
    expect(rows.map((row) => [row.section, row.label])).toEqual([["Gross Bookings", "Mobility"], ["Gross Bookings", "Delivery"], ["Passenger load factor", "Consolidated"], [null, "PRASM (cents)"]]);
    // The "$" on the first row of a block is the block's.
    expect(rows.slice(0, 2).map((row) => row.unit)).toEqual(["currency", "currency"]);
  });
});

const document = (form: "release" | "10-Q", end: string): KpiDocument => ({ accession: `${form}-${end}`, form, filed: end, end, filings: [] });
const point = (end: string, value: number): KpiPoint => ({ end, value, decimals: 0, source: "release", url: "", filed: end, early: false });

describe("quarters as series", () => {
  const reading = (label: string, current: number, yearAgo: number) => ({ key: `|${label}`, label, section: null, unit: "count" as const, scale: null, measure: null, current: { value: current, decimals: 0 }, yearAgo: { value: yearAgo, decimals: 0 } });
  const pair = (end: string, before: string, readings: ReturnType<typeof reading>[]) => ({ newer: document("release", end), older: document("release", before), readings, url: () => "" });

  it("keeps a series two years prove, drops a quarter two readings disagree on, and marks the release before its 10-Q", () => {
    const kpis = assembleKpis([
      pair("2026-06-30", "2025-06-30", [reading("Paid members", 830, 800)]),
      pair("2026-03-31", "2025-03-31", [reading("Paid members", 820, 790)]),
      pair("2025-06-30", "2024-06-30", [reading("Paid members", 801, 760)]),
      pair("2026-03-31", "2025-03-31", [reading("Restaurants", 120, 110)]),
    ], new Set(["2026-03-31", "2025-06-30", "2025-03-31", "2024-06-30"]));
    expect(kpis).toHaveLength(1);
    const members = kpis[0];
    expect(members.points.map((entry) => entry.end)).toEqual(["2024-06-30", "2025-03-31", "2026-03-31", "2026-06-30"]);
    expect(members.points.at(-1)!.early).toBe(true);
    expect(members.points[0].early).toBe(false);
  });

  it("tells a year to date read as quarters", () => {
    expect(yearToDate(new Map([["2025-03-31", point("2025-03-31", 100)], ["2025-06-30", point("2025-06-30", 205)], ["2025-09-30", point("2025-09-30", 310)]]))).toBe(true);
    expect(yearToDate(new Map([["2025-03-31", point("2025-03-31", 100)], ["2025-06-30", point("2025-06-30", 104)], ["2025-09-30", point("2025-09-30", 109)]]))).toBe(false);
  });
});

describe("the documents a company's index lists", () => {
  it("files each release under the quarter it reports, Delta's nine days after, and pairs a year apart", () => {
    const recent = {
      form: ["8-K", "10-Q", "10-Q", "8-K", "8-K", "10-Q", "8-K", "10-K"],
      items: ["2.02", "", "", "2.02,9.01", "7.01", "", "2.02", ""],
      filingDate: ["2026-10-09", "2026-10-09", "2026-07-10", "2026-07-10", "2026-06-01", "2025-10-09", "2025-10-09", "2026-02-11"],
      reportDate: ["2026-10-09", "2026-09-30", "2026-06-30", "2026-07-10", "2026-06-01", "2025-09-30", "2025-10-09", "2025-12-31"],
      accessionNumber: ["a1", "q1", "q3", "a2", "x", "q2", "a3", "k1"],
      primaryDocument: ["a.htm", "q.htm", "q3.htm", "b.htm", "x.htm", "q2.htm", "c.htm", "k.htm"],
    };
    const documents = kpiDocuments(recent, "27904");
    expect(documents.filter((entry) => entry.form === "release").map((entry) => entry.end)).toEqual(["2026-09-30", "2026-06-30", "2025-09-30"]);
    expect(yearApart(documents).map(([newer, older]) => `${newer.form} ${newer.end}/${older.end}`)).toEqual(["release 2026-09-30/2025-09-30", "10-Q 2026-09-30/2025-09-30"]);
    expect(nextQuarterEnd("2026-09-30")).toBe("2026-12-31");
    expect(nextQuarterEnd("2026-08-30")).toBe("2026-11-29");
  });
});
