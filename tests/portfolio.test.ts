import { describe, expect, it } from "vitest";
import { concentration, overWindow, portfolioExposure, portfolioQuality, portfolioSeries, rebasePair, seriesStats, valuePortfolio, weightBy, weightedMetric, withinWindow } from "../lib/portfolio";
import type { WatchlistSummary } from "../lib/watchlist-summary";

const summary = (ticker: string, over: Partial<WatchlistSummary> = {}): WatchlistSummary => ({
  ticker, name: `${ticker} Inc.`, currency: "USD", retrievedAt: "2026-06-30T00:00:00.000Z", cik: "0000000000", businessType: "operating",
  periodEnd: "2026-06-30", periodLabel: "TTM",
  shares: 100, revenue: 1_000, revenueGrowth: .1, freeCashFlow: 200, freeCashFlowMargin: .2,
  cashReturnOnCapital: .3, netDebt: 50,
  freeCashFlowAfterSbcMargin5Y: .18, cashReturnOnCapital5Y: .28, freeCashFlowPerShareCagr5Y: .12,
  qs: {}, qsPrice: { shares: 100, sharesBasis: "outstanding" as const, currency: "USD", netDebt: 50, operatingIncome: 300, freeCashFlow: 200 },
  ...over,
});

const book = () => valuePortfolio(
  [{ ticker: "A", shares: 10 }, { ticker: "B", shares: 30 }],
  { A: summary("A", { freeCashFlowMargin: .4 }), B: summary("B", { freeCashFlowMargin: .1 }) },
  { A: 30, B: 10 },
  { A: { name: "A Inc.", sector: "Software" }, B: { name: "B Inc.", sector: "Payments" } },
);

describe("valuing a book", () => {
  it("weights each holding by what it is worth, not by how many names there are", () => {
    const valued = book();
    // 10 × 30 = 300 and 30 × 10 = 300: equal money, unequal share counts.
    expect(valued.value).toBe(600);
    expect(valued.positions.map((position) => position.weight)).toEqual([.5, .5]);
  });

  it("leaves an unpriced holding out of every weight instead of calling it zero", () => {
    const valued = valuePortfolio([{ ticker: "A", shares: 10 }, { ticker: "B", shares: 5 }], {}, { A: 20, B: null });
    expect(valued.value).toBe(200);
    expect(valued.unpriced).toEqual(["B"]);
    expect(valued.positions[1].weight).toBeNull();
  });

  it("ignores a holding of no shares rather than drawing an empty slice", () => {
    const valued = valuePortfolio([{ ticker: "A", shares: 10 }, { ticker: "B", shares: 0 }], {}, { A: 20, B: 5 });
    expect(valued.positions).toHaveLength(1);
  });
});

describe("a portfolio-level figure", () => {
  it("is each holding's number weighted by its money", () => {
    const metric = weightedMetric(book().positions, (position) => position.summary?.freeCashFlowMargin);
    expect(metric.value).toBeCloseTo(.25, 10);
    expect(metric.coverage).toBe(1);
  });

  it("renormalises over what is known rather than counting a gap as zero", () => {
    // Counting the missing holding as zero would report 20% instead of 40%,
    // and the reader would have no way of telling which they were looking at.
    const valued = valuePortfolio(
      [{ ticker: "A", shares: 10 }, { ticker: "B", shares: 10 }],
      { A: summary("A", { freeCashFlowMargin: .4 }), B: summary("B", { freeCashFlowMargin: null }) },
      { A: 10, B: 10 },
    );
    const metric = weightedMetric(valued.positions, (position) => position.summary?.freeCashFlowMargin);
    expect(metric.value).toBeCloseTo(.4, 10);
    expect(metric.coverage).toBeCloseTo(.5, 10);
    expect(metric.missing).toEqual(["B"]);
  });

  it("says nothing rather than guessing when no holding reports it", () => {
    const metric = weightedMetric(book().positions, () => null);
    expect(metric.value).toBeNull();
    expect(metric.coverage).toBe(0);
  });
});

describe("portfolio Quality Score", () => {
  it("renormalises covered weights and exposes contributions that add to the score", () => {
    const valued = valuePortfolio(
      [{ ticker: "A", shares: 1 }, { ticker: "B", shares: 1 }, { ticker: "C", shares: 1 }],
      {}, { A: 50, B: 30, C: 20 },
    );
    const scores: Record<string, number | null> = { A: 80, B: 40, C: null };
    const result = portfolioQuality(valued.positions, (position) => scores[position.ticker]);
    expect(result.coverage).toBeCloseTo(.8, 10);
    expect(result.value).toBeCloseTo(65, 10);
    expect(result.contributions.reduce((sum, entry) => sum + entry.contribution, 0)).toBeCloseTo(65, 10);
    expect(result.missing).toEqual(["C"]);
  });

  it("measures an exposure as portfolio value rather than number of names", () => {
    const valued = valuePortfolio(
      [{ ticker: "A", shares: 1 }, { ticker: "B", shares: 1 }],
      {}, { A: 90, B: 10 },
    );
    expect(portfolioExposure(valued.positions, (position) => position.ticker === "B")).toBeCloseTo(.1, 10);
  });
});

describe("how the money is spread", () => {
  it("groups weight by any property of the holding, largest first", () => {
    const groups = weightBy(book().positions, (position) => position.sector);
    expect(groups.map((group) => group.label).sort()).toEqual(["Payments", "Software"]);
    expect(groups.reduce((sum, group) => sum + group.weight, 0)).toBeCloseTo(1, 10);
  });

  it("counts holdings by their weight, not by their number", () => {
    // Twenty names where one is half the money is not a portfolio of twenty.
    const heavy = valuePortfolio(
      [{ ticker: "A", shares: 1 }, { ticker: "B", shares: 1 }, { ticker: "C", shares: 1 }],
      {}, { A: 50, B: 25, C: 25 },
    );
    const spread = concentration(heavy.positions);
    expect(spread.largest).toBeCloseTo(.5, 10);
    expect(spread.effectiveHoldings).toBeCloseTo(1 / (.25 + .0625 + .0625), 6);
    expect(spread.effectiveHoldings!).toBeLessThan(3);
  });

  it("has nothing to say about an empty book", () => {
    expect(concentration([]).effectiveHoldings).toBeNull();
    expect(weightBy([], () => "x")).toEqual([]);
  });
});

describe("the portfolio through time", () => {
  const a = [{ date: "2026-01-01", value: 10 }, { date: "2026-01-02", value: 12 }, { date: "2026-01-03", value: 11 }];
  const b = [{ date: "2026-01-01", value: 100 }, { date: "2026-01-03", value: 90 }];

  it("adds the holdings only on dates every one of them traded", () => {
    // Carrying a stale price across a missing session would draw a portfolio
    // moving while part of it had not.
    const series = portfolioSeries([{ ticker: "A", shares: 2 }, { ticker: "B", shares: 1 }], { A: a, B: b });
    expect(series.map((point) => point.date)).toEqual(["2026-01-01", "2026-01-03"]);
    expect(series[0].value).toBe(2 * 10 + 100);
    expect(series[1].value).toBe(2 * 11 + 90);
  });

  it("draws nothing rather than a partial book", () => {
    expect(portfolioSeries([{ ticker: "A", shares: 1 }], {})).toEqual([]);
  });

  it("rebases both sides to their first shared date, so shapes are compared and not sizes", () => {
    const rebased = rebasePair(
      [{ date: "2026-01-01", value: 5_000 }, { date: "2026-01-02", value: 5_500 }],
      [{ date: "2026-01-01", value: 4_800 }, { date: "2026-01-02", value: 4_896 }],
    );
    expect(rebased[0]).toEqual({ date: "2026-01-01", portfolio: 100, benchmark: 100 });
    expect(rebased[1].portfolio).toBeCloseTo(110, 8);
    expect(rebased[1].benchmark).toBeCloseTo(102, 8);
  });

  it("refuses to rebase off a zero", () => {
    expect(rebasePair([{ date: "2026-01-01", value: 0 }], [{ date: "2026-01-01", value: 10 }])).toEqual([]);
  });
});

describe("what a position cost", () => {
  it("reports profit against the cost entered, per position and in total", () => {
    const valued = valuePortfolio(
      [{ ticker: "A", shares: 10, cost: 20 }, { ticker: "B", shares: 5, cost: 40 }],
      {}, { A: 30, B: 30 },
    );
    // A: paid 200, worth 300. B: paid 200, worth 150.
    expect(valued.positions[0].profit).toBe(100);
    expect(valued.positions[0].profitPercent).toBeCloseTo(.5, 10);
    expect(valued.positions[1].profit).toBe(-50);
    expect(valued.cost).toBe(400);
    expect(valued.profit).toBe(50);
    expect(valued.profitPercent).toBeCloseTo(.125, 10);
  });

  it("counts a position with no cost as unknown, not as pure gain", () => {
    // Treating a missing cost as zero would report the position as 100% profit
    // and inflate the whole book's return with it.
    const valued = valuePortfolio(
      [{ ticker: "A", shares: 10, cost: 20 }, { ticker: "B", shares: 10 }],
      {}, { A: 30, B: 30 },
    );
    expect(valued.positions[1].profit).toBeNull();
    expect(valued.profit).toBe(100);
    expect(valued.cost).toBe(200);
    expect(valued.costCoverage).toBeCloseTo(.5, 10);
  });

  it("has no profit to report before any cost is entered", () => {
    const valued = valuePortfolio([{ ticker: "A", shares: 10 }], {}, { A: 30 });
    expect(valued.profit).toBeNull();
    expect(valued.costCoverage).toBe(0);
  });
});

describe("reading a window of the portfolio's own history", () => {
  const daily = Array.from({ length: 40 }, (_, index) => ({
    date: `2026-0${Math.floor(index / 20) + 1}-${String((index % 20) + 1).padStart(2, "0")}`,
    value: 100 + index,
  }));

  it("cuts the window by date, not by how many points happen to be in it", () => {
    const long = [{ date: "2016-01-01", value: 50 }, { date: "2025-01-01", value: 80 }, { date: "2026-01-01", value: 100 }];
    expect(withinWindow(long, 5).map((point) => point.date)).toEqual(["2025-01-01", "2026-01-01"]);
    expect(withinWindow(long, Infinity)).toHaveLength(3);
  });

  it("reads a month and a year to date from the last close, not from today", () => {
    const days = [
      { date: "2025-12-30", value: 90 }, { date: "2026-01-02", value: 100 },
      { date: "2026-08-14", value: 120 }, { date: "2026-09-02", value: 130 },
    ];
    // The year to date is the first of January of the year the series ends in.
    expect(overWindow(days, "YTD").map((point) => point.date)).toEqual(["2026-01-02", "2026-08-14", "2026-09-02"]);
    // A month back from 2 September is 2 August.
    expect(overWindow(days, "1M").map((point) => point.date)).toEqual(["2026-08-14", "2026-09-02"]);
    expect(overWindow(days, "1Y")).toHaveLength(4);
    expect(overWindow(days, "Max")).toHaveLength(4);
    expect(overWindow([], "1M")).toEqual([]);
  });

  it("measures the fall from the running peak, not from where the window began", () => {
    // Doubling and then halving has lost nothing against the start and half of
    // everything against the top, and the second is what holding it felt like.
    const stats = seriesStats([
      { date: "2026-01-01", value: 100 },
      { date: "2026-02-01", value: 200 },
      { date: "2026-03-01", value: 100 },
      { date: "2026-04-01", value: 150 },
    ]);
    expect(stats.change).toBeCloseTo(.5, 10);
    expect(stats.drawdown).toBeCloseTo(-.5, 10);
    expect(stats.drawdownDate).toBe("2026-03-01");
  });

  it("compounds on the same function every other growth figure uses", () => {
    const stats = seriesStats([{ date: "2021-01-01", value: 100 }, { date: "2026-01-01", value: 200 }]);
    expect(stats.cagr).toBeCloseTo(Math.pow(2, 1 / stats.years!) - 1, 10);
    expect(stats.years).toBeCloseTo(5, 1);
  });

  it("reports the best and worst single steps", () => {
    const stats = seriesStats(daily.slice(0, 3));
    expect(stats.bestStep).not.toBeNull();
    expect(stats.worstStep).not.toBeNull();
    expect(stats.worstStep!).toBeLessThanOrEqual(stats.bestStep!);
  });

  it("says nothing about a series with one point or none", () => {
    expect(seriesStats([]).change).toBeNull();
    expect(seriesStats([{ date: "2026-01-01", value: 10 }]).cagr).toBeNull();
  });
});
