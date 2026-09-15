import type { IoCompanyView, IoPeriod } from "./view";

/**
 * What a company's price asks for its growth, as one rate.
 *
 * The free-cash-flow yield plus five years of revenue-per-share growth: the
 * return a buyer earns at today's price if the business goes on as it has. A
 * PEG divides a multiple by a growth rate, and a division fails on most of an
 * index — growth at or below nought has no meaningful quotient, and growth of
 * one per cent sends it to the hundreds. An addition has no such edge: a shrinking
 * company simply reads lower.
 *
 * Measured before it was shown, over 465 companies at each year end from 2016
 * to 2022 on the figures known that morning (tests/growth-yield-backtest.test.ts).
 * Revenue per share was the growth that ranked the returns that followed; free
 * cash flow per share, and the classic PEG on it, barely did. The yield on its
 * own ranked nothing, and the rate as a whole ranked about as well as its growth
 * half — so this reads what a price is paying for, not a forecast of the price.
 */

/** Growth counted at no more than this a year: five years of 60% is not a yield anybody is paid. */
export const GROWTH_YIELD_CEILING = 0.25;
export const GROWTH_YIELD_YEARS = 5;

export interface GrowthYield {
  /** The rate, as a fraction; null unless both halves are known. */
  value: number | null;
  fcfYield: number | null;
  /** Revenue-per-share growth as filed, before the ceiling. */
  growth: number | null;
  capped: boolean;
}

/** The one definition, used by the company page and the screener alike. Fractions in, a fraction out. */
export function growthYield(fcfYield: number | null | undefined, growth: number | null | undefined): GrowthYield {
  const yieldKnown = fcfYield != null && Number.isFinite(fcfYield) ? fcfYield : null;
  const growthKnown = growth != null && Number.isFinite(growth) ? growth : null;
  const capped = growthKnown != null && growthKnown > GROWTH_YIELD_CEILING;
  const counted = growthKnown == null ? null : Math.min(growthKnown, GROWTH_YIELD_CEILING);
  return {
    value: yieldKnown == null || counted == null ? null : yieldKnown + counted,
    fcfYield: yieldKnown,
    growth: growthKnown,
    capped,
  };
}

/**
 * The rate as a mark out of 100, to be read at a glance.
 *
 * A fixed scale, as the Quality Score's is, not a rank: a company's mark moves
 * when its price or its filings do, never because the rest of the index did.
 * The anchors sit on the S&P 500 as it read in September 2026 — a growth yield
 * of nought scores 0, the index's median of about 14% scores 50, and 28%, where
 * its top twentieth begins, scores 100 — so a quarter of the index reads under
 * 35 and a quarter over 67. Between two anchors the mark is interpolated.
 */
export const GROWTH_YIELD_ANCHORS: readonly [number, number, number] = [0, 0.14, 0.28];

export function growthYieldScore(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  const [low, middle, high] = GROWTH_YIELD_ANCHORS;
  if (rate <= low) return 0;
  if (rate >= high) return 100;
  return Math.round(rate <= middle ? (50 * (rate - low)) / (middle - low) : 50 + (50 * (rate - middle)) / (high - middle));
}

/** Three words for the mark, on the Quality Score's own band edges. */
export function growthYieldVerdict(score: number | null): string | null {
  if (score == null) return null;
  return score >= 67 ? "Cheap for its growth" : score >= 40 ? "Fairly priced" : "Dear for its growth";
}

export interface DatedRate { value: number | null; startDate: string | null; endDate: string | null; reason: string | null }

const YEAR_MS = 365.2425 * 86_400_000;

/**
 * A compound rate between the newest annual period and the one nearest the
 * target distance before it, within half a year — the rule `cagrForPeriods`
 * applies to the filed dataset, so the page and the screener's digest agree.
 */
export function annualRate(periods: IoPeriod[], key: string, years: number): DatedRate {
  const history = periods
    .flatMap((period) => {
      const value = period.values[key];
      return value != null && Number.isFinite(value) ? [{ date: period.end, value }] : [];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
  const end = history.at(-1);
  if (!end) return { value: null, startDate: null, endDate: null, reason: "No annual history" };
  const start = history
    .slice(0, -1)
    .map((point) => ({ point, distance: Math.abs((Date.parse(end.date) - Date.parse(point.date)) / YEAR_MS - years) }))
    .filter((candidate) => candidate.distance <= 0.5)
    .sort((left, right) => left.distance - right.distance)[0]?.point;
  if (!start) return { value: null, startDate: history[0].date, endDate: end.date, reason: `No annual period about ${years} years before the latest` };
  if (start.value <= 0 || end.value <= 0) return { value: null, startDate: start.date, endDate: end.date, reason: "Not meaningful with a zero or negative endpoint" };
  const elapsed = (Date.parse(end.date) - Date.parse(start.date)) / YEAR_MS;
  return { value: (end.value / start.value) ** (1 / elapsed) - 1, startDate: start.date, endDate: end.date, reason: null };
}

/** The growth yield of a company page: its price, its latest free cash flow and its revenue per share. */
export interface ViewGrowthYield {
  reading: GrowthYield;
  score: number | null;
  verdict: string | null;
  rate: DatedRate;
  marketCap: number | null;
  /** The newest period that reports a free cash flow, which the yield is struck on. */
  cash: IoPeriod | null;
}

/**
 * The same arithmetic the company page and the comparison both show.
 *
 * The market capitalisation is struck as the statistics strike it — the
 * engine's share count, a price in the statements' currency or nothing — and
 * the free cash flow is the newest period that reports one.
 */
export function growthYieldOfView(view: IoCompanyView, quote: { price: number | null; currency?: string | null } | null): ViewGrowthYield {
  const basis = view.basis;
  const price = quote?.price ?? null;
  const sameCurrency = !quote?.currency || !basis || quote.currency === basis.currency;
  const marketCap = basis && sameCurrency && price != null && Number.isFinite(price) && price > 0 ? price * basis.shares : null;
  const series = [...view.annual, ...view.trailing].sort((left, right) => left.end.localeCompare(right.end));
  const cash = [...series].reverse().find((period) => period.values.freeCashFlow != null && Number.isFinite(period.values.freeCashFlow)) ?? null;
  const fcfYield = marketCap && cash ? cash.values.freeCashFlow! / marketCap : null;
  const rate = annualRate(view.annual, "revenuePerShare", GROWTH_YIELD_YEARS);
  const reading = growthYield(fcfYield, rate.value);
  const score = growthYieldScore(reading.value);
  return { reading, score, verdict: growthYieldVerdict(score), rate, marketCap, cash };
}
