import { describe, expect, it } from "vitest";
import {
  aligned, beta, commonReturns, contributions, correlation, maxDrawdown, monthlyReturns, rebalance, returnsOf,
  riskContributions, sharpe, underwater, valueAtRisk, volatility,
} from "@/lib/term/portfolio-risk";

const series = (values: number[], start = "2026-01-01") => values.map((value, index) => {
  const date = new Date(`${start}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + index);
  return { date: date.toISOString().slice(0, 10), value };
});

describe("portfolio risk", () => {
  it("reads returns, and lines two series up by date", () => {
    const returns = returnsOf(series([100, 110, 99]));
    expect(returns.map((point) => Number(point.value.toFixed(9)))).toEqual([0.1, -0.1]);
    const [a, b] = aligned(returns, returnsOf(series([50, 55, 60, 66])));
    expect(a.length).toBe(2);
    expect(b[0]).toBeCloseTo(0.1);
  });

  it("gives a holding that doubles the market's moves a beta of two and a correlation of one", () => {
    const market = [0.01, -0.02, 0.015, 0.005, -0.01, 0.02];
    const asset = market.map((value) => value * 2);
    expect(beta(asset, market)).toBeCloseTo(2, 6);
    expect(correlation(asset, market)).toBeCloseTo(1, 6);
    expect(volatility(asset, 252)!).toBeCloseTo(volatility(market, 252)! * 2, 6);
  });

  it("finds the deepest fall, when it bottomed and when it recovered", () => {
    const book = series([100, 120, 90, 100, 125, 110]);
    const fall = maxDrawdown(book);
    expect(fall.depth).toBeCloseTo(-0.25);
    expect(fall.trough).toBe(book[2].date);
    expect(fall.recovered).toBe(book[4].date);
    expect(underwater(book).map((point) => Number(point.value.toFixed(3)))).toEqual([0, 0, -0.25, -0.167, 0, -0.12]);
  });

  it("compounds calendar months from the last close of each", () => {
    const months = monthlyReturns([
      { date: "2026-01-30", value: 100 }, { date: "2026-02-27", value: 110 }, { date: "2026-03-31", value: 99 },
    ]);
    expect(months.map((month) => [month.month, Number(month.value.toFixed(3))])).toEqual([[2, 0.1], [3, -0.1]]);
  });

  it("splits the book's variance so that the shares add up to one", () => {
    const a = [0.01, -0.02, 0.03, -0.01, 0.02]; const b = [0.002, -0.001, 0.003, 0.0, 0.001];
    const shares = riskContributions([0.5, 0.5], [a, b])!;
    expect(shares[0] + shares[1]).toBeCloseTo(1, 9);
    expect(shares[0]).toBeGreaterThan(0.8);
  });

  it("adds each holding's contribution up to the book's change", () => {
    const histories = { A: series([10, 12]), B: series([20, 18]) };
    const parts = contributions([{ ticker: "A", shares: 10 }, { ticker: "B", shares: 5 }], histories, "2026-01-01");
    expect(parts.map((part) => part.money)).toEqual([20, -10]);
    expect(parts.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(10 / 200);
  });

  it("finds the trades that reach the target weights", () => {
    const trades = rebalance([{ ticker: "A", shares: 10, price: 30, target: 50 }, { ticker: "B", shares: 10, price: 10, target: 50 }]);
    expect(trades.map((trade) => trade.trade)).toEqual([-100, 100]);
    expect(trades[1].tradeShares).toBe(10);
  });

  it("reads the returns every holding shares, and a historical value at risk", () => {
    const common = commonReturns([series([1, 2, 4]), series([1, 1, 2, 2]).slice(1)]);
    expect(common.dates.length).toBe(1);
    const returns = Array.from({ length: 100 }, (_, index) => (index - 50) / 1000);
    expect(valueAtRisk(returns, 0.05)).toBeCloseTo(-0.046, 3);
    expect(sharpe([0.001, 0.002, -0.001, 0.0015], 252)).not.toBeNull();
  });
});
