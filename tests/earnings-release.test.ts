import { describe, expect, it } from "vitest";
import { earningsReleaseDates, expectedNextRelease, latestEarningsRelease } from "../lib/adapters/earnings";

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
});

describe("the earnings calendar", () => {
  const recent = {
    form: ["8-K", "10-Q", "8-K", "8-K", "8-K", "8-K", "4"],
    filingDate: ["2026-07-30", "2026-08-01", "2026-05-01", "2026-04-30", "2026-01-29", "2025-10-30", "2025-10-01"],
    reportDate: ["", "", "", "", "", "", ""],
    accessionNumber: ["a", "b", "c", "d", "e", "f", "g"],
    items: ["2.02,9.01", "", "5.02", "2.02,9.01", "2.02", "2.02,9.01", ""],
  };

  it("lists only the releases, newest first", () => {
    expect(earningsReleaseDates(recent)).toEqual(["2026-07-30", "2026-04-30", "2026-01-29", "2025-10-30"]);
  });

  it("expects the next one a median gap after the last, with a week either side", () => {
    const next = expectedNextRelease(["2026-07-30", "2026-04-30", "2026-01-29", "2025-10-30"]);
    expect(next).toEqual({ date: "2026-10-29", from: "2026-10-22", to: "2026-11-05", gapDays: 91 });
  });

  it("says nothing for a filer that does not report quarterly, or has too little history", () => {
    expect(expectedNextRelease(["2026-03-01", "2025-03-01", "2024-03-01"])).toBeNull();
    expect(expectedNextRelease(["2026-07-30", "2026-04-30"])).toBeNull();
  });
});
