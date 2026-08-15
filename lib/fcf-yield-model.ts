import { derivedValue } from "./finance";
import type { FinancialPeriod } from "./types";

/**
 * A reverse discounted-cash-flow on free cash flow per share.
 *
 * The full FCFF model in `lib/dcf.ts` asks for a cost of capital, a terminal
 * growth rate and a decade of margin assumptions, and it answers with one
 * intrinsic value. This asks four questions a shareholder can actually hold an
 * opinion about — what the business earns per share today, how fast that grows,
 * what the market should pay for it at the end, and what return you want — and
 * answers with the price you would have to pay to get that return.
 *
 * Neither model is more correct. This one has fewer places to hide an
 * assumption, which is why it is the default.
 */
export interface FcfYieldInputs {
  /** Trailing free cash flow per share, in the company's currency. */
  fcfPerShare: number;
  /** Expected annual growth in free cash flow per share, as a decimal. */
  growthRate: number;
  /** The free cash flow yield the shares should trade at by the exit year. */
  exitYield: number;
  /** The same exit assumption expressed as a price-to-free-cash-flow multiple. */
  exitMultiple: number;
  /** Which of the two the reader is steering with. They are reciprocals. */
  useMultiple: boolean;
  /** The annualized return the reader wants from the position. */
  desiredReturn: number;
  years: number;
}

export interface FcfYieldPoint {
  year: number;
  label: string;
  /** Free cash flow per share in that year, compounded from today. */
  fcfPerShare: number;
  /** Today's price compounded at the implied return: what the money does. */
  price: number;
}

export interface FcfYieldResult {
  projection: FcfYieldPoint[];
  exitFcfPerShare: number;
  /** What the shares are worth in the exit year under the exit assumption. */
  exitPrice: number;
  /** Annualized return if bought at today's price, or null without one. */
  returnFromCurrentPrice: number | null;
  /** What you would have to pay today to earn the desired return. */
  entryPrice: number;
  /** Positive when today's price is below that entry price. */
  marginOfSafety: number | null;
}

/** A yield and a multiple are the same statement said two ways. */
export const yieldToMultiple = (rate: number) => rate > 0 ? 1 / rate : Number.NaN;
export const multipleToYield = (multiple: number) => multiple > 0 ? 1 / multiple : Number.NaN;

export function calculateFcfYieldModel(inputs: FcfYieldInputs, currentPrice: number | null): FcfYieldResult | null {
  const { fcfPerShare, growthRate, desiredReturn, years } = inputs;
  const exitYield = inputs.useMultiple ? multipleToYield(inputs.exitMultiple) : inputs.exitYield;
  if (!Number.isFinite(fcfPerShare) || fcfPerShare <= 0) return null;
  if (!Number.isFinite(exitYield) || exitYield <= 0) return null;
  if (!Number.isFinite(years) || years < 1) return null;

  // Year zero is now: the first point is the price you would pay today.
  const startYear = new Date().getUTCFullYear();
  const exitFcfPerShare = fcfPerShare * (1 + growthRate) ** years;
  const exitPrice = exitFcfPerShare / exitYield;
  // Compounding backwards from the exit price is the whole point of the model:
  // it converts an opinion about the future into a price you can act on today.
  const entryPrice = exitPrice / (1 + desiredReturn) ** years;
  const returnFromCurrentPrice = currentPrice != null && currentPrice > 0
    ? (exitPrice / currentPrice) ** (1 / years) - 1
    : null;

  // The drawn line is today's price growing at the return the model implies,
  // which is what the money does rather than what the business is worth. Both
  // ends are real: it starts at the price you would pay and finishes at the
  // exit price. Without a price there is nothing to compound, so the line
  // becomes the implied value of the business instead.
  const base = currentPrice != null && currentPrice > 0 ? currentPrice : fcfPerShare / exitYield;
  const rate = currentPrice != null && currentPrice > 0 && returnFromCurrentPrice != null
    ? returnFromCurrentPrice
    : (exitPrice / base) ** (1 / years) - 1;

  const projection: FcfYieldPoint[] = Array.from({ length: years + 1 }, (_, index) => ({
    year: startYear + index,
    label: `${startYear + index}`,
    fcfPerShare: fcfPerShare * (1 + growthRate) ** index,
    price: base * (1 + rate) ** index,
  }));

  return {
    projection, exitFcfPerShare, exitPrice, entryPrice, returnFromCurrentPrice,
    marginOfSafety: currentPrice != null && currentPrice > 0 ? entryPrice / currentPrice - 1 : null,
  };
}

export interface FcfYieldBase {
  fcfPerShare: number | null;
  fcfYield: number | null;
  /** How much of free cash flow stock compensation consumes, as a negative. */
  sbcImpact: number | null;
  periodLabel: string;
  periodEnd: string;
}

/**
 * The trailing figures the model starts from, read off the latest period.
 *
 * TTM when four clean quarters exist, the last reported year otherwise. The
 * stock-compensation impact is shown next to them because a reader setting a
 * growth rate on free cash flow should see how much of that cash is already
 * spoken for by pay.
 */
export function fcfYieldBase(periods: FinancialPeriod[], currentPrice: number | null): FcfYieldBase | null {
  const ttm = periods.filter((period) => period.periodicity === "ttm").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const annual = periods.filter((period) => period.periodicity === "annual").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const period = ttm.at(-1) ?? annual.at(-1);
  if (!period) return null;

  const fcfPerShare = derivedValue(period, "freeCashFlowPerShare");
  const afterSbc = derivedValue(period, "freeCashFlowAfterSbcPerShare");
  return {
    fcfPerShare,
    fcfYield: fcfPerShare != null && currentPrice != null && currentPrice > 0 ? fcfPerShare / currentPrice : null,
    sbcImpact: fcfPerShare != null && afterSbc != null && fcfPerShare !== 0 ? afterSbc / fcfPerShare - 1 : null,
    periodLabel: period.periodicity === "ttm" ? "TTM" : period.label,
    periodEnd: period.periodEnd,
  };
}

/** A growth rate the reader can start from rather than invent. */
export function suggestedGrowth(cagr5: number | null, cagr10: number | null) {
  const usable = [cagr5, cagr10].filter((value): value is number => value != null && Number.isFinite(value));
  if (!usable.length) return .07;
  // The lower of the two horizons, capped: a five-year rate caught mid-boom
  // extrapolates a boom, and nothing compounds at forty percent for a decade.
  return Math.max(-.2, Math.min(.2, Math.min(...usable)));
}
