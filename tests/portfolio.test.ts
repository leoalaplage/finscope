import { describe, expect, it } from "vitest";
import { concentration, portfolioSeries, rebasePair, valuePortfolio, weightBy, weightedMetric } from "../lib/portfolio";
import type { WatchlistSummary } from "../lib/watchlist-summary";

const summary = (ticker: string, over: Partial<WatchlistSummary> = {}): WatchlistSummary => ({
  ticker, name: `${ticker} Inc.`, currency: "USD", periodEnd: "2026-06-30", periodLabel: "TTM",
  shares: 100, revenue: 1_000, revenueGrowth: .1, freeCashFlow: 200, freeCashFlowMargin: .2,
  cashReturnOnCapital: .3, netDebt: 50, qs: {}, qsPrice: { shares: 100, netDebt: 50, operatingIncome: 300, freeCashFlow: 200 },
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
