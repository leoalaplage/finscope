import { describe, expect, it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { valueOf } from "../lib/finance";
import type { CompanyProfile } from "../lib/types";

/*
 * Splits, read from the filings rather than from a list kept by hand.
 *
 * A share count is filed on the basis of the day it was filed, so a split
 * leaves every earlier count incomparable with every later one. The registry
 * carries verified splits for the twenty-one companies on the built-in
 * watchlist; every other company — which is every company a reader can reach by
 * typing a ticker — had none. Amazon showed 504 million shares for 2019 and
 * 10.2 billion for 2020, and its 2019 earnings per share read $22.99 against
 * 2020's $2.09.
 *
 * Filers declare the ratio themselves, but not once: Tesla tags it against
 * every quarter end since, and Alphabet against both the announcement and the
 * effective date. So a declared ratio is a candidate, and what makes it an
 * event is that the share count actually changes by it.
 */

const profile = (ticker: string, splits?: Array<{ date: string; ratio: number }>): CompanyProfile => ({
  name: ticker, ticker, cik: "0000000001", exchange: "NASDAQ", currency: "USD", sector: "Test",
  description: "Test profile", businessType: "operating", stockSplits: splits,
});

/** One filed year: revenue anchors the period, the share count is the subject. */
const year = (end: string, filed: string, shares: number) => ({
  revenue: { start: `${Number(end.slice(0, 4))}-01-01`, end, val: 1_000, accn: `a-${end}`, fy: Number(end.slice(0, 4)), fp: "FY", form: "10-K", filed },
  shares: { start: `${Number(end.slice(0, 4))}-01-01`, end, val: shares, accn: `a-${end}`, fy: Number(end.slice(0, 4)), fp: "FY", form: "10-K", filed },
});

function payload(years: Array<ReturnType<typeof year>>, ratios: Array<{ date: string; value: number }>) {
  return {
    entityName: "Test filer",
    facts: {
      "us-gaap": {
        Revenues: { units: { USD: years.map((item) => item.revenue) } },
        WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: years.map((item) => item.shares) } },
        ...(ratios.length ? { StockholdersEquityNoteStockSplitConversionRatio1: { units: { pure: ratios.map((item) => ({ end: item.date, val: item.value, accn: "split", fy: 2026, fp: "FY", form: "10-K", filed: "2026-02-01" })) } } } : {}),
      },
    },
  };
}

const sharesByYear = (ticker: string, years: Array<ReturnType<typeof year>>, ratios: Array<{ date: string; value: number }>, splits?: Array<{ date: string; ratio: number }>) => {
  const dataset = normalizeSecPayload(payload(years, ratios), ticker, "2026-09-01T00:00:00.000Z", profile(ticker, splits));
  return dataset.periods
    .filter((period) => period.periodicity === "annual")
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
    .map((period) => valueOf(period, "dilutedShares"));
};

/** Amazon's shape: counts filed before the split, then counts filed after it. */
const amazonYears = [
  year("2018-12-31", "2021-02-03", 500),
  year("2019-12-31", "2022-02-04", 504),
  year("2020-12-31", "2023-02-03", 10_198),
  year("2021-12-31", "2024-02-02", 10_296),
];

describe("splits declared by the filer", () => {
  it("restates the years filed before a split it can confirm", () => {
    const shares = sharesByYear("AMZN", amazonYears, [{ date: "2022-05-27", value: 20 }]);
    // 500 and 504 million become ten billion, and the series is continuous.
    expect(shares).toEqual([10_000, 10_080, 10_198, 10_296]);
  });

  it("confirms two splits whose product explains one filing-to-filing break", () => {
    const copartYears = [
      year("2019-12-31", "2022-09-27", 240),
      year("2020-12-31", "2023-09-28", 960),
      year("2021-12-31", "2024-09-30", 970),
    ];
    const shares = sharesByYear("CPRT", copartYears, [
      { date: "2022-10-03", value: 2 },
      { date: "2023-08-04", value: 2 },
    ]);
    expect(shares).toEqual([960, 960, 970]);
  });

  it("ignores a ratio repeated against every context that follows it", () => {
    // Tesla tags its ratio against each quarter end since the event. Only the
    // one with a break behind it is an event; the rest explain nothing.
    const repeats = [
      { date: "2022-05-27", value: 20 },
      { date: "2022-09-30", value: 20 },
      { date: "2022-12-31", value: 20 },
      { date: "2023-06-30", value: 20 },
    ];
    expect(sharesByYear("AMZN", amazonYears, repeats)).toEqual([10_000, 10_080, 10_198, 10_296]);
  });

  it("does not apply again what the verified registry already applied", () => {
    // The same event declared a fortnight from the verified date. After the
    // registry adjustment there is no break left, so nothing more is applied.
    const shares = sharesByYear("KNOWN", amazonYears, [{ date: "2022-05-27", value: 20 }], [{ date: "2022-06-06", ratio: 20 }]);
    expect(shares).toEqual([10_000, 10_080, 10_198, 10_296]);
  });

  it("leaves a declared ratio alone when the share count never moved by it", () => {
    // A ratio mentioned in a note, with a share count that grew 1% a year:
    // there is nothing for it to explain and nothing is restated.
    const steady = [
      year("2022-12-31", "2023-02-01", 1_000),
      year("2023-12-31", "2024-02-01", 1_010),
      year("2024-12-31", "2025-02-01", 1_020),
    ];
    expect(sharesByYear("STEADY", steady, [{ date: "2023-06-30", value: 4 }])).toEqual([1_000, 1_010, 1_020]);
  });

  it("reports the splits it applied on the company itself", () => {
    const dataset = normalizeSecPayload(payload(amazonYears, [{ date: "2022-05-27", value: 20 }]), "AMZN", "2026-09-01T00:00:00.000Z", profile("AMZN"));
    expect(dataset.company.stockSplits).toEqual([{ date: "2022-05-27", ratio: 20 }]);
    expect(dataset.quality?.stockSplits).toEqual([{ date: "2022-05-27", ratio: 20 }]);
  });
});

/**
 * Splits nobody declared, proved by the filer restating its own history.
 *
 * Booking tags no ratio anywhere in Company Facts, so the declared path had
 * nothing to confirm and its history sat on two bases at once: 33 million
 * diluted shares against a company that had 800 million, and free cash flow per
 * share falling from $278 to $21 across one point of the chart. What Booking
 * did publish is the same quarter twice — 33,093,000 diluted shares in its own
 * report, 827,000,000 in the report a year later. That is the split, in facts.
 */
describe("splits proved by a restatement", () => {
  /** One period, filed once and then filed again on a new basis. */
  const restated = (context: { start: string; end: string }, filings: Array<{ filed: string; val: number }>) =>
    filings.map((filing) => ({ ...context, val: filing.val, accn: `a-${filing.filed}`, fy: Number(context.end.slice(0, 4)), fp: "FY", form: "10-K", filed: filing.filed }));

  const facts = (shares: Array<Record<string, unknown>>, basic = shares) => ({
    entityName: "Test filer",
    facts: {
      "us-gaap": {
        Revenues: { units: { USD: [
          { start: "2024-01-01", end: "2024-12-31", val: 1_000, accn: "a-2025-02-01", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01" },
          { start: "2025-01-01", end: "2025-12-31", val: 1_100, accn: "a-2026-02-01", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-01" },
        ] } },
        WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares } },
        WeightedAverageNumberOfSharesOutstandingBasic: { units: { shares: basic } },
      },
    },
  });

  const sharesOf = (payload: unknown, splits?: Array<{ date: string; ratio: number }>) => {
    const dataset = normalizeSecPayload(payload, "TEST", "2026-09-01T00:00:00.000Z", profile("TEST", splits));
    return {
      splits: dataset.company.stockSplits,
      shares: dataset.periods
        .filter((period) => period.periodicity === "annual")
        .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
        .map((period) => valueOf(period, "dilutedShares")),
    };
  };

  const booking = facts([
    ...restated({ start: "2024-01-01", end: "2024-12-31" }, [{ filed: "2025-02-01", val: 34_064 }]),
    ...restated({ start: "2025-01-01", end: "2025-12-31" }, [{ filed: "2026-02-01", val: 32_639 }, { filed: "2026-04-28", val: 816_000 }]),
  ]);

  it("restates a history the filer never declared a ratio for", () => {
    const { splits, shares } = sharesOf(booking);
    expect(splits).toEqual([{ date: "2026-04-28", ratio: 25 }]);
    // 34,064 thousand becomes 851,600 thousand; the series is continuous.
    expect(shares).toEqual([851_600, 816_000]);
  });

  it("reads a ratio through the rounding of two filings", () => {
    // The restated figure is rounded to the million and the original to the
    // thousand, so the division reads 24.9902 and the split is 25.
    const rounded = facts([
      ...restated({ start: "2024-01-01", end: "2024-12-31" }, [{ filed: "2025-02-01", val: 34_064_000 }]),
      ...restated({ start: "2025-01-01", end: "2025-12-31" }, [{ filed: "2026-02-01", val: 33_093_000 }, { filed: "2026-04-28", val: 827_000_000 }]),
    ]);
    expect(sharesOf(rounded).splits).toEqual([{ date: "2026-04-28", ratio: 25 }]);
  });

  it("applies one event once, however many reports restate for it", () => {
    // The next report restates the periods *it* shows, which the first one did
    // not carry. Same split, proved twice; applying both would multiply the
    // history by six hundred and twenty-five.
    const twice = facts([
      ...restated({ start: "2024-01-01", end: "2024-12-31" }, [{ filed: "2025-02-01", val: 34_064 }, { filed: "2026-08-04", val: 851_600 }]),
      ...restated({ start: "2025-01-01", end: "2025-12-31" }, [{ filed: "2026-02-01", val: 32_639 }, { filed: "2026-04-28", val: 816_000 }]),
    ]);
    const { splits, shares } = sharesOf(twice);
    expect(splits).toEqual([{ date: "2026-04-28", ratio: 25 }]);
    expect(shares).toEqual([851_600, 816_000]);
  });

  it("does not apply again what the verified registry already applied", () => {
    const { splits, shares } = sharesOf(booking, [{ date: "2026-03-10", ratio: 25 }]);
    expect(splits).toEqual([{ date: "2026-03-10", ratio: 25 }]);
    expect(shares).toEqual([851_600, 816_000]);
  });

  it("needs more than one restated figure to agree", () => {
    // One corrected number is a correction. A split restates everything the
    // report shows — basic and diluted, the quarter and the year.
    const alone = facts(
      [
        ...restated({ start: "2024-01-01", end: "2024-12-31" }, [{ filed: "2025-02-01", val: 34_064 }]),
        ...restated({ start: "2025-01-01", end: "2025-12-31" }, [{ filed: "2026-02-01", val: 32_639 }, { filed: "2026-04-28", val: 816_000 }]),
      ],
      [
        ...restated({ start: "2024-01-01", end: "2024-12-31" }, [{ filed: "2025-02-01", val: 33_622 }]),
        ...restated({ start: "2025-01-01", end: "2025-12-31" }, [{ filed: "2026-02-01", val: 32_452 }]),
      ],
    );
    expect(sharesOf(alone).splits).toEqual([]);
  });

  it("leaves a restatement that is not a split alone", () => {
    // A share count corrected by four percent is a correction, not an event
    // any company could declare a ratio for.
    const corrected = facts([
      ...restated({ start: "2024-01-01", end: "2024-12-31" }, [{ filed: "2025-02-01", val: 34_064 }]),
      ...restated({ start: "2025-01-01", end: "2025-12-31" }, [{ filed: "2026-02-01", val: 32_639 }, { filed: "2026-04-28", val: 33_945 }]),
    ]);
    expect(sharesOf(corrected).splits).toEqual([]);
  });

  it("reads a reverse split, which a declared ratio cannot be trusted for", () => {
    const reverse = facts([
      ...restated({ start: "2024-01-01", end: "2024-12-31" }, [{ filed: "2025-02-01", val: 100_000 }]),
      ...restated({ start: "2025-01-01", end: "2025-12-31" }, [{ filed: "2026-02-01", val: 96_000 }, { filed: "2026-04-28", val: 9_600 }]),
    ]);
    const { splits, shares } = sharesOf(reverse);
    expect(splits).toEqual([{ date: "2026-04-28", ratio: 0.1 }]);
    expect(shares).toEqual([10_000, 9_600]);
  });
});
