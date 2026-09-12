import { describe, expect, it } from "vitest";
import { datasetAsOf, hasHistoryOn, publishedOn } from "../lib/qs/as-of";
import type { CompanyDataset, FinancialPeriod } from "../lib/types";

/**
 * The company as it was known on a past morning.
 *
 * The score the site shows is struck on everything filed to date, which is the
 * right answer to "what is this business" and the wrong one to "would this
 * score have told me anything" — a 2019 score built from a 2021 annual report
 * is a score with tomorrow's newspaper in it.
 */
const period = (label: string, end: string, filingDate: string, publishedAt?: string): FinancialPeriod => ({
  label, periodEnd: end, filingDate, publishedAt, periodicity: "annual", metrics: {},
} as unknown as FinancialPeriod);

const dataset = (periods: FinancialPeriod[]): CompanyDataset => ({
  company: { ticker: "TEST" }, periods, retrievedAt: "2026-09-12T00:00:00.000Z", warnings: [],
} as unknown as CompanyDataset);

describe("reading a company as of a past date", () => {
  it("keeps what had been published and drops what had not", () => {
    const held = dataset([
      period("FY2018", "2018-12-31", "2019-02-20"),
      period("FY2019", "2019-12-31", "2020-02-19"),
      period("FY2020", "2020-12-31", "2021-02-17"),
    ]);
    expect(datasetAsOf(held, "2020-06-30").periods.map((each) => each.label)).toEqual(["FY2018", "FY2019"]);
    // The boundary belongs to the past: a report filed that morning was public.
    expect(datasetAsOf(held, "2020-02-19").periods.map((each) => each.label)).toEqual(["FY2018", "FY2019"]);
    expect(datasetAsOf(held, "2020-02-18").periods.map((each) => each.label)).toEqual(["FY2018"]);
  });

  it("reads the day the figures were news, not the day they were filed again", () => {
    /*
     * A year's figures are first reported in an earnings release and repeated
     * in the annual report months later. Dating them by the later filing would
     * hide from the measurement a year the market had already traded on.
     */
    const repeated = period("FY2019", "2019-12-31", "2020-11-02", "2020-01-28");
    expect(publishedOn(repeated)).toBe("2020-01-28");
    expect(datasetAsOf(dataset([repeated]), "2020-03-01").periods).toHaveLength(1);
  });

  it("drops a period it cannot date rather than keeping what it cannot vouch for", () => {
    // An undated figure cannot be shown to have been public, and a measurement
    // that keeps what it cannot date is one that quietly keeps the future.
    const undated = { label: "FY2019", periodEnd: "2019-12-31", periodicity: "annual" } as unknown as FinancialPeriod;
    expect(datasetAsOf(dataset([undated]), "2026-01-01").periods).toHaveLength(0);
  });

  it("says the dataset was read that morning, whatever today's copy says", () => {
    // The score reads `retrievedAt`; leaving today's date on a 2019 reading
    // would date the answer to now.
    expect(datasetAsOf(dataset([]), "2019-12-31").retrievedAt).toBe("2019-12-31T00:00:00.000Z");
  });

  it("refuses to score a company that had no history to score", () => {
    const young = dataset([period("FY2019", "2019-12-31", "2020-02-01"), period("FY2020", "2020-12-31", "2021-02-01")]);
    expect(hasHistoryOn(young, "2021-12-31")).toBe(false);
    const old = dataset(Array.from({ length: 8 }, (_, index) =>
      period(`FY${2012 + index}`, `${2012 + index}-12-31`, `${2013 + index}-02-01`)));
    expect(hasHistoryOn(old, "2021-12-31")).toBe(true);
    expect(hasHistoryOn(old, "2016-12-31")).toBe(false);
  });
});
