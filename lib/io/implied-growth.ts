/**
 * What the price is asking for, rather than what anybody forecasts.
 *
 * Every discounted cash flow on every other site is a forecast with a number
 * at the end of it, and the forecast is the part nobody can check: change the
 * growth by two points and the answer moves by half. This application does not
 * forecast — it reads what was filed — so the only honest form of the exercise
 * is the one that runs backwards.
 *
 * Take what the market pays for the equity today. Take the cash that equity
 * actually received last year. Ask: at what rate would that cash have to
 * compound for the price to be exactly right? That number is not an opinion.
 * It is arithmetic on a price and a filed figure, and it turns "is this
 * expensive" — which nobody can answer — into "the price is asking for 14% a
 * year, and this company has delivered 9% for a decade", which the reader can
 * answer for themselves.
 *
 * One assumption remains and cannot be removed: the rate at which a future
 * pound is discounted to a present one. It is the reader's, it is stated on
 * screen beside the answer, and it is the only number in this file that nobody
 * filed. The terminal rate is the second, held at the long-run growth of the
 * economy rather than chosen per company, because a terminal rate tuned per
 * company is where a reverse DCF quietly becomes a forecast again.
 */

export interface ImpliedGrowthTerms {
  /** What the market pays for the equity, in the currency of the accounts. */
  marketCap: number;
  /**
   * The cash the equity received over the period, as filed.
   *
   * Free cash flow here is operating cash flow less capital expenditure, and
   * that is struck *after* interest — so it is the cash available to owners and
   * it belongs against the market capitalisation rather than the enterprise
   * value. Comparing it with an enterprise value would charge the company for
   * its debt twice.
   */
  freeCashFlow: number;
  /** The reader's discount rate. The one number nobody filed. */
  discountRate: number;
  /** How many years of growth the price is being asked to pay for. */
  years: number;
  /** What is assumed to continue for ever afterwards. */
  terminalGrowth: number;
}

export type ImpliedGrowth =
  | { kind: "solved"; rate: number }
  /** The price is outside the band any rate in this model can explain. */
  | { kind: "beyond"; bound: number; direction: "below" | "above" }
  | { kind: "unavailable"; reason: string };

/** The widest rates worth solving between: a collapse, and a fivefold decade. */
const FLOOR = -.5;
const CEILING = 1;
/** Enough halvings to place the rate inside a basis point, and no more. */
const STEPS = 60;

/**
 * The present value of a cash flow growing at `rate`, on these terms.
 *
 * Ten years of compounding, then a perpetuity at the terminal rate, discounted
 * back. Written out rather than expressed in closed form so the reader of this
 * file can see exactly what is being claimed and what is not.
 */
export function presentValue(terms: ImpliedGrowthTerms, rate: number): number {
  const { freeCashFlow, discountRate, years, terminalGrowth } = terms;
  let value = 0;
  let flow = freeCashFlow;
  for (let year = 1; year <= years; year++) {
    flow *= 1 + rate;
    value += flow / (1 + discountRate) ** year;
  }
  // The perpetuity is struck on the year after the last one projected, which is
  // why the final flow is grown once more before it is capitalised.
  const terminal = (flow * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  return value + terminal / (1 + discountRate) ** years;
}

/**
 * The cash flows a rate implies, year by year.
 *
 * The same compounding the present value discounts, handed back rather than
 * summed, so the page can draw what it is claiming instead of only stating the
 * rate that produced it. Nothing here is a forecast: it is one number
 * compounded, and the picture is honest only because the bars it becomes are
 * drawn as outlines beside the filed ones.
 */
export function projectCashFlows(freeCashFlow: number, rate: number, years: number): number[] {
  const flows: number[] = [];
  let flow = freeCashFlow;
  for (let year = 1; year <= years; year++) {
    flow *= 1 + rate;
    flows.push(flow);
  }
  return flows;
}

/**
 * The rate that makes the price exactly right, by bisection.
 *
 * Present value rises monotonically with the growth rate, so halving the
 * interval converges on the single rate that clears it. Sixty halvings of a
 * one-and-a-half-wide interval is far finer than the figure is ever shown to.
 *
 * A price outside the band is reported as being outside it rather than clamped
 * to its edge: "more than 100% a year" is a true statement about a price, and
 * a rate of exactly 100% would be a false one.
 */
export function impliedGrowth(terms: ImpliedGrowthTerms): ImpliedGrowth {
  const { marketCap, freeCashFlow, discountRate, years, terminalGrowth } = terms;
  if (!(freeCashFlow > 0)) {
    return { kind: "unavailable", reason: "This company's free cash flow is not positive, so there is no cash flow for a price to be a multiple of." };
  }
  if (!(marketCap > 0)) return { kind: "unavailable", reason: "No market capitalisation can be struck for this company." };
  if (!(discountRate > terminalGrowth)) {
    return { kind: "unavailable", reason: "A discount rate at or below the terminal growth rate values every company at infinity." };
  }
  if (!Number.isInteger(years) || years < 1) return { kind: "unavailable", reason: "The horizon must be a whole number of years." };

  if (presentValue(terms, FLOOR) > marketCap) return { kind: "beyond", bound: FLOOR, direction: "below" };
  if (presentValue(terms, CEILING) < marketCap) return { kind: "beyond", bound: CEILING, direction: "above" };

  let low = FLOOR;
  let high = CEILING;
  for (let step = 0; step < STEPS; step++) {
    const middle = (low + high) / 2;
    if (presentValue(terms, middle) < marketCap) low = middle; else high = middle;
  }
  return { kind: "solved", rate: (low + high) / 2 };
}
