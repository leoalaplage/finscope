import { describe, expect, it } from "vitest";
import { namesQuarterEnd, readReleaseFigures, releaseDocuments, type MetricAnchor } from "../lib/adapters/earnings-release";

const anchor = (yearAgo: number, known: number[] = [], extra: Partial<MetricAnchor> = {}): MetricAnchor => ({ yearAgo: [yearAgo], known, yearToDate: null, totals: [], ...extra });
const table = (rows: string[][], header?: string[]) =>
  `<table>${header ? `<tr>${header.map((cell) => `<td>${cell}</td>`).join("")}</tr>` : ""}${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</table>`;
const doc = (html: string) => [{ name: "ex99.htm", html }];

describe("a quarter read from its press release", () => {
  it("takes the column before the filed year-ago figure, in the units that figure proves", () => {
    const html = table([["Total net sales", "$", "109,417", "$", "94,036", "$", "364,357", "$", "313,695"], ["Diluted", "$", "2.02", "$", "1.57"]]);
    const figures = readReleaseFigures(doc(html), { revenue: anchor(94_036e6), dilutedEps: anchor(1.57) });
    expect(figures.revenue).toMatchObject({ value: 109_417e6, yearAgo: 94_036e6, row: "Total net sales" });
    expect(figures.dilutedEps?.value).toBe(2.02);
  });

  it("steps over the nine months printed first, and refuses a year to date", () => {
    const html = table([["Net sales", "$", "7,051.9", "6,173.1", "$", "2,463.3", "2,133.3"]]);
    const figures = readReleaseFigures(doc(html), { revenue: anchor(2_133.3e6, [], { yearToDate: 4_588.6e6 }) });
    expect(figures.revenue?.value).toBeCloseTo(2_463.3e6);
  });

  it("steps over the quarters already filed that a bank prints between", () => {
    const html = table([["Total revenue", "21,870", "21,100", "20,500", "20,300", "20,100"]]);
    const figures = readReleaseFigures(doc(html), { revenue: anchor(20_100e6, [21_100e6, 20_500e6, 20_300e6]) });
    expect(figures.revenue?.value).toBe(21_870e6);
  });

  it("reads a trend table that runs oldest first", () => {
    const html = table([["Total revenue", "3,284", "3,448", "3,545", "3,667", "3,796", "4,048", "4,004", "12.9", "%"]]);
    const figures = readReleaseFigures(doc(html), { revenue: anchor(3_545e6, [3_667e6, 3_796e6, 4_048e6]) });
    expect(figures.revenue?.value).toBe(4_004e6);
  });

  it("never takes a column headed as adjusted or as an adjustment", () => {
    const html = table(
      [["Diluted Earnings per Share", "$4.81", "$(0.07)", "$4.74", "$3.65", "$0.21", "$3.86", "32%", "32%"]],
      ["($ in millions)", "As Reported (GAAP)", "Impact", "As Adjusted (non-GAAP)", "As Reported (GAAP)", "Impact", "As Adjusted (non-GAAP)", "GAAP", "Constant Currency"],
    );
    expect(readReleaseFigures(doc(html), { dilutedEps: anchor(3.65) }).dilutedEps?.value).toBe(4.81);
  });

  it("never reads a change column, and keeps a quarter that fell", () => {
    const html = table([["Net earnings per share (Diluted)", "0.09", "2.12", "(95.8)"]], ["", "2026", "2025", "Percent change"]);
    expect(readReleaseFigures(doc(html), { dilutedEps: anchor(2.12) }).dilutedEps?.value).toBe(0.09);
  });

  it("gives nothing from a breakdown by division that ends in the total", () => {
    const html = table([["Reported Operating Profit", "1,536", "729", "436", "720", "424", "151", "(427)", "3,569"]]);
    expect(readReleaseFigures(doc(html), { operatingIncome: anchor(3_569e6) }).operatingIncome).toBeUndefined();
  });

  it("never reads an adjusted row, and leaves blank what no row proves", () => {
    const html = table([["Total revenue, excluding notable items", "3,469", "3,545"], ["Revenue", "5.2", "4.9"]]);
    expect(readReleaseFigures(doc(html), { revenue: anchor(3_545e6) }).revenue).toBeUndefined();
    // "4.9" billion is too coarse to prove a filed 4,912 million.
    expect(readReleaseFigures(doc(html), { revenue: anchor(4_912e6) }).revenue).toBeUndefined();
  });

  it("refuses a figure that is a sum of filed quarters, and drops earnings that disagree with the shares", () => {
    const html = table([["GAAP Net Income", "2,927", "6,135", "3,721", "4,304", "17,087"]]);
    expect(readReleaseFigures(doc(html), { netIncome: anchor(2_927e6, [6_135e6, 3_721e6, 4_304e6], { totals: [17_087e6] }) }).netIncome).toBeUndefined();
    const both = table([["Net income", "4,000", "3,000"], ["Diluted", "9.00", "1.00"]]);
    const figures = readReleaseFigures(doc(both), { netIncome: anchor(3_000e6), dilutedEps: anchor(1.00) }, { dilutedShares: 3_000e6 });
    expect(figures.netIncome).toBeUndefined();
    expect(figures.dilutedEps).toBeUndefined();
  });

  it("prefers what is left for the company's shareholders when two rows prove themselves", () => {
    const html = table([["NET INCOME", "4,760", "2,927"], ["NET INCOME AVAILABLE TO COMMON SHAREHOLDERS", "4,679", "2,927"]]);
    expect(readReleaseFigures(doc(html), { netIncome: anchor(2_927e6) }).netIncome?.value).toBe(4_679e6);
  });

  it("checks that the release speaks of the quarter expected", () => {
    expect(namesQuarterEnd("<p>for the three months ended September 30, 2026</p>", "2026-09-30")).toBe(true);
    expect(namesQuarterEnd("<p>for the quarter ended June 27, 2026</p>", "2026-06-30")).toBe(true);
    expect(namesQuarterEnd("<p>Third-Quarter 2026 results</p>", "2026-09-27", { number: 3, fiscalYear: 2026 })).toBe(true);
    expect(namesQuarterEnd("<p>Q2 FY27 revenue</p>", "2026-07-26", { number: 2, fiscalYear: 2027 })).toBe(true);
    expect(namesQuarterEnd("<p>for the three months ended June 30, 2026</p>", "2026-09-30")).toBe(false);
  });

  it("reads the release first, a supplement next, never the 8-K's cover or the index", () => {
    expect(releaseDocuments([
      { name: "ms-20261014.htm", size: 100 }, { name: "a3q26msfinancialsupplement.htm", size: 900 },
      { name: "a3q26msearningsrelease.htm", size: 500 }, { name: "0000895421-26-000288-index.html" }, { name: "R1.htm" },
    ], "ms-20261014.htm")).toEqual(["a3q26msearningsrelease.htm", "a3q26msfinancialsupplement.htm"]);
  });
});

describe("what a release is checked against", () => {
  it("is the quarter after the latest filed, proven against the same quarter a year before", async () => {
    const { releaseQuarter } = await import("../lib/io/release-anchors");
    const period = (label: string, end: string, fiscalYear: number, fiscalQuarter: string, revenue: number, reportedEps: number) => ({
      label, end, start: null, fiscalYear, fiscalQuarter, filingDate: end, publishedAt: end, accession: "a", currency: "USD",
      values: { revenue, netIncome: revenue / 10, dilutedShares: 100 }, reportedEps, valuationBasis: null,
    });
    const quarterly = [
      period("Q3 FY2025", "2025-09-30", 2025, "Q3", 300, 0.31), period("Q4 FY2025", "2025-12-31", 2025, "Q4", 320, 0.33),
      period("Q1 FY2026", "2026-03-31", 2026, "Q1", 330, 0.34), period("Q2 FY2026", "2026-06-30", 2026, "Q2", 340, 0.35),
    ];
    const quarter = releaseQuarter(quarterly as never)!;
    expect(quarter).toMatchObject({ label: "Q3 FY2026", end: "2026-09-30", quarter: { number: 3, fiscalYear: 2026 }, yearAgo: { label: "Q3 FY2025" } });
    expect(quarter.anchors.revenue).toMatchObject({ yearAgo: [300], known: [320, 330, 340], yearToDate: 670 });
    // Earnings per share as filed, not net income over the shares.
    expect(quarter.anchors.dilutedEps?.yearAgo).toEqual([0.31]);
    expect(quarter.anchors.revenue?.totals).toContain(990);
  });
});

describe("the consensus around a release", () => {
  it("keeps every reported quarter, the newest reading winning, newest first", async () => {
    const { mergeSurprises } = await import("../lib/estimates");
    const merged = mergeSurprises(
      [{ fiscalEnd: "Mar 2026", reported: "2026-04-14", eps: 5.94, consensus: 5.49, surprise: 8.2 }, { fiscalEnd: "Dec 2025", reported: null, eps: 5.2, consensus: 4.8, surprise: 8 }],
      [{ fiscalEnd: "Sep 2026", reported: "2026-10-13", eps: 5.75, consensus: 5.94, surprise: -3.2 }, { fiscalEnd: "Dec 2025", reported: "2026-01-13", eps: 5.23, consensus: 4.87, surprise: 7.39 }],
    );
    expect(merged.map((entry) => entry.fiscalEnd)).toEqual(["Sep 2026", "Mar 2026", "Dec 2025"]);
    expect(merged[2].eps).toBe(5.23);
  });

  it("is asked again within the half hour once the nearest quarter has ended", async () => {
    const { awaitingReport } = await import("../lib/estimates-store");
    const quarterly = [{ fiscalEnd: "Sep 2026", consensus: 1, high: null, low: null, analysts: null, up: null, down: null }];
    expect(awaitingReport({ quarterly }, new Date("2026-10-14T12:00:00Z"))).toBe(true);
    expect(awaitingReport({ quarterly }, new Date("2026-09-15T12:00:00Z"))).toBe(false);
  });
});
