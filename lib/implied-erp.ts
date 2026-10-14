import type { ScreenerFeed } from "./screener-feed";

/**
 * The equity risk premium the market is paying today, read from the S&P 500.
 *
 * A discounted cash flow on a fixed premium judged most of the index
 * overvalued: on 14 October 2026, 74% of 265 members, the median one at 59% of
 * its price. A fixed 5% on top of a 5.2% Treasury asks more of equities than
 * the market itself does. Damodaran's answer is to read the premium off the
 * index rather than choose it: the rate at which the index's cash, growing as
 * the analysts expect, is worth what the index costs — less the Treasury.
 *
 * Here: the index's free-cash-flow yield, weighted by market value; growing at
 * the consensus growth in earnings per share for five years, fading to the
 * terminal rate over the next five, then at that rate for ever — the same
 * shape the company model uses (lib/io/dcf-model.ts), so a company like the
 * index comes out at about its price and the model's verdict is relative to
 * the market, not to a premium chosen once.
 *
 * Pure.
 */

export interface MarketPremium {
  /** The premium over the Treasury: required return less the risk-free rate. */
  premium: number;
  requiredReturn: number;
  riskFree: number;
  /** The index's free cash flow over its market value. */
  cashYield: number;
  /** The consensus growth in earnings per share the first five years carry. */
  growth: number;
  terminalGrowth: number;
  /** Members whose figures went into it. */
  members: number;
  /** When the premium is the fallback because the index could not be read. */
  fallback: boolean;
}

/** The premium used when the index cannot be read: the long-run historical one. */
export const FALLBACK_PREMIUM = 0.05;
const PREMIUM_FLOOR = 0.03;
const PREMIUM_CEILING = 0.07;

/**
 * Growth for ever, from the Treasury: the long rate less two points (roughly
 * the real rate and the term premium over nominal growth), held between 2.5%
 * and 3.5%. A perpetuity cannot outgrow the economy, and a fixed 2.5% under a
 * 5% Treasury priced every company as if it would.
 */
export function terminalGrowthFor(riskFree: number | null): number {
  if (riskFree == null || !Number.isFinite(riskFree)) return 0.03;
  return Math.min(0.035, Math.max(0.025, riskFree - 0.02));
}

/** The value of one unit of price: the yield growing at `growth` five years, fading to `terminal` over five more, then for ever. */
export function valueOfIndex(rate: number, cashYield: number, growth: number, terminal: number): number {
  let cash = cashYield;
  let value = 0;
  for (let year = 1; year <= 10; year++) {
    const g = year <= 5 ? growth : growth + (terminal - growth) * ((year - 5) / 5);
    cash *= 1 + g;
    value += cash / (1 + rate) ** year;
  }
  return value + (cash * (1 + terminal)) / (rate - terminal) / (1 + rate) ** 10;
}

/** The rate at which that value is the price, or null where none between the terminal rate and 30% gets there. */
export function requiredReturn(cashYield: number, growth: number, terminal: number): number | null {
  if (!(cashYield > 0)) return null;
  let low = terminal + 0.0005;
  let high = 0.3;
  if (valueOfIndex(low, cashYield, growth, terminal) < 1 || valueOfIndex(high, cashYield, growth, terminal) > 1) return null;
  for (let step = 0; step < 80; step++) {
    const middle = (low + high) / 2;
    if (valueOfIndex(middle, cashYield, growth, terminal) > 1) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * The premium from the screener's rows of the index: market value, free-cash-
 * flow yield and consensus growth, each in per cent as the screener carries
 * them. A lender's free cash flow is not stated and leaves it out of the yield;
 * a growth outside −50% to +100% is a base near zero, not an expectation.
 */
export function marketPremium(feed: Pick<ScreenerFeed, "rows">, riskFree: number | null): MarketPremium {
  const terminalGrowth = terminalGrowthFor(riskFree);
  let value = 0; let cash = 0; let weighted = 0; let weight = 0; let members = 0;
  for (const row of feed.rows) {
    const cap = row.values["Market Cap"];
    const yieldPct = row.values["FCF Yield"];
    const growthPct = row.values.epsGrowth;
    if (!finite(cap) || cap <= 0) continue;
    if (finite(yieldPct) && Math.abs(yieldPct) < 50) { value += cap; cash += cap * yieldPct / 100; members++; }
    if (finite(growthPct) && growthPct > -50 && growthPct < 100) { weighted += cap * growthPct / 100; weight += cap; }
  }
  const cashYield = value > 0 ? cash / value : NaN;
  const growth = weight > 0 ? weighted / weight : NaN;
  const rf = finite(riskFree) ? riskFree : null;
  const rate = rf != null && members >= 250 && finite(cashYield) && finite(growth) ? requiredReturn(cashYield, Math.min(0.25, Math.max(-0.05, growth)), terminalGrowth) : null;
  if (rate == null || rf == null) {
    return { premium: FALLBACK_PREMIUM, requiredReturn: (rf ?? 0.045) + FALLBACK_PREMIUM, riskFree: rf ?? NaN, cashYield, growth, terminalGrowth, members, fallback: true };
  }
  const premium = Math.min(PREMIUM_CEILING, Math.max(PREMIUM_FLOOR, rate - rf));
  return { premium, requiredReturn: rf + premium, riskFree: rf, cashYield, growth, terminalGrowth, members, fallback: false };
}
