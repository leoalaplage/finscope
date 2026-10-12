import { describe, expect, it } from "vitest";
import { screenerFeed } from "@/lib/screener-feed";
import { consensusRow, mergeConsensus, type ConsensusRow } from "@/lib/screener-consensus";
import { parseEstimates } from "@/lib/adapters/nasdaq-estimates";
import type { UniverseTable } from "@/lib/universe-build";
import type { TechTable } from "@/lib/term/tech-universe";

const now = new Date("2026-10-12T12:00:00Z");
const asOf = "2026-10-12T08:00:00Z";
const forecast: ConsensusRow = { ticker: "AAPL", asOf, eps: 10, epsBasis: "Fiscal year · Sep 2027", growth: .2, revision: .05, target: 240, buyShare: .8, analysts: 20 };
const universe: UniverseTable = {
  name: "S&P 500", asOf: "2026-09-12", builtAt: asOf, members: 503, pending: [],
  rows: [{ ticker: "AAPL", name: "Apple", read: "test", retrievedAt: asOf, periodLabel: "TTM Q3 FY2026",
    qs: { Sector: "Technology", "Revenue 5Y CAGR": 12, "Long-term Debt to Assets": .25, "FCF / Net Income": 120 },
    qsPrice: { shares: 10e9, sharesBasis: "outstanding", currency: "USD", netDebt: -10e9, operatingIncome: 100e9, freeCashFlow: 80e9 },
  }], prices: { AAPL: { price: 200, currency: "USD", asOf, changePercent: 1 } },
};
const technical: TechTable = { builtAt: asOf, members: 503, rows: [{ ticker: "AAPL", name: "Apple", builtAt: asOf, asOf: Date.parse("2026-10-09T20:00:00Z") / 1000,
  values: { close: [200, 190], sma200: [195, 194], rsi14: [55, 53], chg60: [10, 9], chg126: [15, 14], chg252: [20, 19] },
}] };
const apple = (feed: ReturnType<typeof screenerFeed>) => feed.rows.find((row) => row.ticker === "AAPL")!;

describe("the screener's source join", () => {
  it("joins the same listing, scales ratio fractions once and preserves independent source dates", () => {
    const feed = screenerFeed(universe, technical, { builtAt: asOf, rows: [forecast] }, now);
    const row = apple(feed);
    expect(row.values["Market Cap"]).toBe(2000);
    expect(row.values["Long-term Debt to Assets"]).toBe(25);
    expect(row.values["Revenue 5Y CAGR"]).toBe(12);
    expect(row.values["FCF / Net Income"]).toBe(120);
    expect(row.values.forwardPe).toBe(20);
    expect(row.values.peg).toBe(1);
    expect(row.values.epsGrowth).toBe(20);
    expect(row.values.targetUpside).toBeCloseTo(20);
    expect(row.values["tech:close"]).toBe(200);
    expect(row.previous["tech:close"]).toBe(190);
    expect(row.values["tech:rsRating"]).toBe(1);
    expect(row.period).toBe("TTM Q3 FY2026");
    expect(row.dates.technical).toBe("2026-10-09T20:00:00.000Z");
    expect(feed.coverage).toEqual({ fundamental: 1, price: 1, consensus: 1, technical: 1 });
  });
  it("withholds currency-mismatched filed multiples and non-USD consensus price ratios", () => {
    const different = { ...universe, prices: { AAPL: { ...universe.prices.AAPL, currency: "EUR" } } };
    const row = apple(screenerFeed(different, null, { builtAt: asOf, rows: [forecast] }, now));
    expect(row.values["Market Cap"]).toBeNull();
    expect(row.values["EV/EBIT"]).toBeNull();
    expect(row.values.forwardPe).toBeNull();
    expect(row.values.targetUpside).toBeNull();
    expect(row.values.epsGrowth).toBe(20);
    expect(row.reasons.valuation).toMatch(/currency/);
  });
  it("does not publish forward multiples on expected losses or a PEG on declining EPS", () => {
    const loss = apple(screenerFeed(universe, null, { builtAt: asOf, rows: [{ ...forecast, eps: -2, growth: -.1 }] }, now));
    expect(loss.values.forwardPe).toBeNull();
    expect(loss.values.peg).toBeNull();
    expect(loss.values.epsGrowth).toBe(-10);
  });
  it("expires stale consensus and daily snapshots without erasing the listing", () => {
    const feed = screenerFeed(universe, { ...technical, rows: technical.rows.map((row) => ({ ...row, builtAt: "2026-10-01T08:00:00Z" })) }, { builtAt: asOf, rows: [{ ...forecast, asOf: "2026-10-01T08:00:00Z" }] }, now);
    expect(apple(feed).values.forwardPe).toBeNull();
    expect(apple(feed).values["tech:rsi14"]).toBeNull();
    expect(apple(feed).reasons.consensus).toMatch(/three days/);
    expect(feed.coverage.consensus).toBe(0);
    expect(feed.rows).toHaveLength(503);
  });
  it("does not turn unbuilt financial records into zeroes", () => {
    const feed = screenerFeed(null, null, null, now);
    expect(feed.building).toBe(true);
    expect(apple(feed).values["Net Debt / EBITDA"]).toBeNull();
    expect(apple(feed).values["Revenue 5Y CAGR"]).toBeNull();
    expect(feed.coverage.fundamental).toBe(0);
  });
});

describe("the scheduled consensus table", () => {
  it("identifies annual EPS fallback explicitly and preserves a zero revision", () => {
    const estimates = parseEstimates("AAPL", { yearlyForecast: { rows: [{ fiscalEnd: "Sep 2027", consensusEPSForecast: 10 }, { fiscalEnd: "Sep 2028", consensusEPSForecast: 12 }] } }, { changeInConsensus: { monthData: { yrMean: 10 }, currentData: { yrMean: 10 }, fiscalYearEndText: "Fiscal Year End Sep 2027" } }, null, null, asOf);
    const row = consensusRow(estimates);
    expect(row.eps).toBe(10);
    expect(row.epsBasis).toBe("Fiscal year · Sep 2027");
    expect(row.revision).toBe(0);
  });
  it("keeps untouched companies and a prior dated reading after an empty provider response", () => {
    const previous = { builtAt: asOf, rows: [forecast, { ...forecast, ticker: "MSFT" }] };
    const empty = { ...forecast, eps: null, growth: null, revision: null, target: null, buyShare: null, analysts: null };
    const result = mergeConsensus(previous, [empty], ["AAPL", "MSFT"], asOf);
    expect(result.rows).toEqual(previous.rows);
  });
});
