import { describe, expect, it } from "vitest";
import { latestEarningsRelease, parsePreliminaryEarnings } from "../lib/adapters/earnings";

describe("SEC earnings-release detection", () => {
  it("takes item 2.02 rather than a newer unrelated 8-K", () => {
    const filing = latestEarningsRelease({
      form: ["8-K", "8-K", "10-Q"],
      filingDate: ["2026-09-10", "2026-09-10", "2026-05-29"],
      reportDate: ["2026-09-10", "2026-07-31", "2026-04-30"],
      accessionNumber: ["0001193125-26-388049", "0001193125-26-387902", "0001193125-26-000001"],
      items: ["1.01,9.01", "2.02,9.01", ""],
    }, "0000900075");

    expect(filing).toMatchObject({
      form: "8-K",
      filingDate: "2026-09-10",
      accession: "0001193125-26-387902",
    });
    expect(filing?.sourceUrl).toBe("https://www.sec.gov/Archives/edgar/data/900075/000119312526387902/");
  });

  it("returns no signal for ordinary current reports", () => {
    expect(latestEarningsRelease({
      form: ["8-K", "10-K"],
      filingDate: ["2026-09-10", "2026-09-01"],
      reportDate: ["2026-09-10", "2026-07-31"],
      accessionNumber: ["0001193125-26-388049", "0001193125-26-380000"],
      items: ["1.01,9.01", ""],
    }, "0000900075")).toBeNull();
  });

  it("recognises an amended item 2.02 filing", () => {
    expect(latestEarningsRelease({
      form: ["8-K/A"],
      filingDate: ["2026-09-11"],
      reportDate: [""],
      accessionNumber: ["0001193125-26-388100"],
      items: ["2.02, 9.01"],
    }, "0000900075")?.form).toBe("8-K/A");
  });

  it("reads Copart headline figures from the unaudited HTML exhibit", () => {
    const html = `
      <p>Copart reported financial results for the quarter and year ended July 31, 2026.</p>
      <p>(In thousands)</p>
      <table>
        <tr><th></th><th>Three Months Ended July 31</th><th>Year Ended July 31</th></tr>
        <tr><td>Total service revenues and vehicle sales</td><td>$</td><td>1,152,439</td><td>$</td><td>1,125,097</td><td>2.4</td><td>%</td><td>$</td><td>4,666,209</td><td>$</td><td>4,646,958</td><td>0.4</td><td>%</td></tr>
        <tr><td>Gross profit</td><td></td><td>481,449</td><td></td><td>509,718</td><td>(5.5</td><td>)%</td><td></td><td>2,083,858</td><td></td><td>2,099,643</td></tr>
        <tr><td>Operating income</td><td></td><td>368,904</td><td></td><td>412,591</td><td></td><td></td><td></td><td>1,652,590</td><td></td><td>1,696,714</td></tr>
        <tr><td>Net income attributable to Copart, Inc.</td><td>$</td><td>327,423</td><td>$</td><td>396,354</td><td></td><td></td><td>$</td><td>1,484,270</td><td>$</td><td>1,552,449</td></tr>
        <tr><td>Diluted net income per common share</td><td>$</td><td>0.35</td><td>$</td><td>0.41</td><td></td><td></td><td>$</td><td>1.55</td><td>$</td><td>1.59</td></tr>
        <tr><td>Diluted weighted average common shares outstanding</td><td></td><td>932,140</td><td></td><td>977,778</td><td></td><td></td><td></td><td>956,860</td><td></td><td>977,563</td></tr>
      </table>
      <table>
        <tr><td>Net cash provided by operating activities</td><td>1,604,492</td><td>1,799,750</td></tr>
        <tr><td>Purchases of property and equipment</td><td>(337,363</td><td>)</td><td>(568,990</td><td>)</td></tr>
      </table>`;

    const result = parsePreliminaryEarnings(html, "https://www.sec.gov/exhibit.htm");
    expect(result).toMatchObject({
      status: "preliminary-unaudited",
      sourceUrl: "https://www.sec.gov/exhibit.htm",
      quarter: { label: "Q4 FY2026", revenue: 1_152_439_000, netIncome: 327_423_000, dilutedEps: 0.35 },
      annual: { label: "FY2026", revenue: 4_666_209_000, netIncome: 1_484_270_000, dilutedEps: 1.55 },
    });
    expect(result?.annual?.freeCashFlow).toBe(1_267_129_000);
  });
});
