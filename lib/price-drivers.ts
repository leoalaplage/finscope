import { cagrBetweenDates, derivedValue } from "./finance";
import type { FinancialPeriod, PricePoint } from "./types";

/**
 * What actually moved the share price: the business, or the market's opinion.
 *
 * A share price is the free cash flow behind each share divided by the yield
 * the market demands on it — so a price can only rise two ways. Either the
 * company produced more cash per share, or the market agreed to accept less
 * yield for the same cash. Both are visible in the filings and the tape, and
 * the difference between them is the difference between a return you can
 * expect to keep and one you borrowed from the next buyer:
 *
 *   Share price = FCF per share / FCF yield
 *
 * The identity is exact, which is what makes the split honest rather than
 * attributed. If cash per share doubles and the yield holds, the price doubles.
 * If cash per share doubles and the yield doubles with it, the price does not
 * move at all — the company delivered and the multiple took it back. And if the
 * price doubles while cash per share stands still, nothing was earned: the
 * whole return came from the market paying more for the same cash, which is a
 * return the next holder has to be persuaded to pay again.
 *
 * Each year is priced at its own fiscal year end, which is the only date that
 * means the same thing for every year. The filing date does not: a year that a
 * later report restated carries *that* report's date, so Apple's 2015 is dated
 * November 2017 in this data, and pairing on it would divide a 2015 cash flow
 * by a 2017 share price and call the difference growth. The trailing yield at
 * a year end is computed with the year's own figures, which the market did not
 * yet have in full — the split explains a move that has already happened
 * rather than claiming the market could have known it.
 */
export interface PriceDriverEndpoint {
  date: string;
  periodEnd: string;
  price: number;
  freeCashFlowPerShare: number;
  /** Free cash flow per share over the price, on that day. */
  yield: number;
}

export interface PriceDrivers {
  years: number;
  start: PriceDriverEndpoint;
  end: PriceDriverEndpoint;
  /** The whole move, as a multiple of the starting price minus one. */
  totalReturn: number;
  /** What the business contributed: growth in free cash flow per share. */
  businessReturn: number;
  /** What the market contributed: the yield it moved to accept. */
  valuationReturn: number;
  /** The same three, per year. */
  annualised: { total: number | null; business: number | null; valuation: number | null };
  /**
   * How the move divides, as a share of one. Computed in logarithms because
   * the two components multiply rather than add — 50% plus 50% of a doubling
   * is not a doubling — and only where the arithmetic says something: a fall
   * and a rise cancelling each other have no meaningful share.
   */
  share: { business: number; valuation: number } | null;
}

export type PriceDriverResult = { drivers: PriceDrivers; reason?: undefined } | { drivers: null; reason: string };

/** The annual periods carrying a free cash flow per share, oldest first. */
function priceable(periods: FinancialPeriod[]) {
  return periods
    .filter((period) => period.periodicity === "annual" && derivedValue(period, "freeCashFlowPerShare") != null)
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd));
}

function endpoint(period: FinancialPeriod, point: PricePoint): PriceDriverEndpoint | null {
  const price = point.priceClose ?? point.close;
  const perShare = derivedValue(period, "freeCashFlowPerShare");
  if (perShare == null || perShare <= 0 || !(price > 0)) return null;
  if (point.currency !== period.currency) return null;
  return { date: point.date, periodEnd: period.periodEnd, price, freeCashFlowPerShare: perShare, yield: perShare / price };
}

/**
 * The decomposition over roughly `years`, or the reason there is none.
 *
 * Endpoints are chosen the way every other long-run figure here chooses them:
 * the latest year that can be priced, and the year closest to the requested
 * distance from it, accepted within half a year so a fiscal calendar does not
 * disqualify a company.
 */
export function priceDrivers(periods: FinancialPeriod[], pricesByPeriodEnd: Record<string, PricePoint | null>, years: number): PriceDriverResult {
  const priceOf = (period: FinancialPeriod) => {
    const point = pricesByPeriodEnd[period.periodEnd];
    return point ? endpoint(period, point) : null;
  };
  // A price in another currency is the one refusal worth naming: it is not a
  // gap in the filings, and a reader of a euro filer would otherwise be told
  // their company lacks a cash flow it plainly reports.
  let foreignQuote = "";
  const usable = priceable(periods).flatMap((period) => {
    const quoted = pricesByPeriodEnd[period.periodEnd];
    if (quoted && quoted.currency !== period.currency) {
      foreignQuote = `The share price is quoted in ${quoted.currency} and the statements are filed in ${period.currency}. FinScope does not convert, so this split is withheld.`;
    }
    const point = priceOf(period);
    return point ? [{ period, point }] : [];
  });
  if (usable.length < 2) return { drivers: null, reason: foreignQuote || "Needs two years that carry both a free cash flow per share and a matched market price" };

  const end = usable.at(-1)!;
  const distance = (item: typeof end) => (Date.parse(end.point.date) - Date.parse(item.point.date)) / (365.2425 * 86_400_000);
  const start = usable
    .map((item) => ({ item, span: distance(item) }))
    .filter((candidate) => candidate.span > .5 && Math.abs(candidate.span - years) <= .5)
    .sort((left, right) => Math.abs(left.span - years) - Math.abs(right.span - years))[0]?.item;
  if (!start) {
    const longest = distance(usable[0]);
    return { drivers: null, reason: `Needs ${years} years of priced history; the longest available is ${longest.toFixed(1)}` };
  }

  const span = distance(start);
  const totalReturn = end.point.price / start.point.price - 1;
  const businessReturn = end.point.freeCashFlowPerShare / start.point.freeCashFlowPerShare - 1;
  // The yield falling is the market paying more, so the contribution is the
  // ratio of the old yield to the new one — the inverse of the yield's change.
  const valuationReturn = start.point.yield / end.point.yield - 1;

  const logs = [Math.log(1 + businessReturn), Math.log(1 + valuationReturn)];
  const magnitude = Math.abs(logs[0]) + Math.abs(logs[1]);
  const share = logs.every(Number.isFinite) && magnitude > 1e-9
    ? { business: Math.abs(logs[0]) / magnitude, valuation: Math.abs(logs[1]) / magnitude }
    : null;

  return {
    drivers: {
      years: span, start: start.point, end: end.point, totalReturn, businessReturn, valuationReturn,
      annualised: {
        total: cagrBetweenDates(start.point.price, end.point.price, start.point.date, end.point.date).value,
        business: cagrBetweenDates(start.point.freeCashFlowPerShare, end.point.freeCashFlowPerShare, start.point.date, end.point.date).value,
        // The yield the other way up, so a compressing yield reads as a positive rate.
        valuation: cagrBetweenDates(1 / start.point.yield, 1 / end.point.yield, start.point.date, end.point.date).value,
      },
      share,
    },
  };
}

/**
 * Whether the move was earned or bought, in one word.
 *
 * The split is only useful to someone who already knows why it matters, and a
 * reader meeting three multiples has no way to tell which arrangement of them
 * is the good one. This is the judgement the book makes, and it is a judgement
 * about *where the return came from* rather than about the shares: a return the
 * company produced is one it can produce again, and a return the market handed
 * over is one the next buyer has to hand over again. Neither is a forecast and
 * neither is advice.
 */
export type PriceDriverTone = "earned" | "borrowed" | "mixed" | "lost";

export interface PriceDriverVerdict { tone: PriceDriverTone; label: string; meaning: string }

const VERDICTS: Record<PriceDriverTone, string> = {
  earned: "The company produced this return, so it is the kind it can produce again.",
  borrowed: "The market paid more for the same cash. That part only repeats if the next buyer pays more again.",
  mixed: "Part of the move was produced by the company and part was paid by the market.",
  lost: "The cash behind each share fell.",
};

export function priceDriverVerdict(drivers: PriceDrivers): PriceDriverVerdict {
  const { businessReturn, totalReturn, share } = drivers;
  const of = (tone: PriceDriverTone, label: string) => ({ tone, label, meaning: VERDICTS[tone] });
  if (businessReturn <= 0 && totalReturn <= 0) return of("lost", "Both went backwards");
  if (businessReturn <= 0) return of("borrowed", "Paid for by the market");
  if (totalReturn <= 0) return of("mixed", "Business grew, price did not");
  if (!share) return of("mixed", "Half and half");
  // Three fifths, not two thirds. At the tighter line a move the panel itself
  // described as "64% from the multiple" was still badged "half and half",
  // and a verdict that argues with the sentence beside it teaches nothing.
  if (share.business >= .6) return of("earned", "Earned by the business");
  if (share.valuation >= .6) return of("borrowed", "Mostly re-rating");
  return of("mixed", "Half and half");
}

/**
 * The sentence a reader should take away, which is the point of the split.
 *
 * A return that came from the business is one the company can repeat. A return
 * that came from the multiple is one the next buyer has to agree to pay again,
 * and the book this follows calls that a warning rather than a result.
 */
export function priceDriverReading(drivers: PriceDrivers): string {
  const { businessReturn, totalReturn, share } = drivers;
  if (totalReturn <= 0 && businessReturn > 0) return "The business grew and the share price did not follow: the whole fall is the market accepting a higher yield on the same cash.";
  if (businessReturn <= 0 && totalReturn > 0) return "The cash behind each share did not grow. The whole rise came from the market paying more for it — a return the next buyer has to agree to pay again.";
  if (!share) return "Growth and valuation moved the price by about the same amount in opposite directions.";
  if (share.business >= .8) return "Almost all of the move came from the business rather than from the multiple.";
  if (share.valuation >= .8) return "Almost all of the move came from the multiple rather than from the business.";
  return `${Math.round(share.business * 100)}% of the move came from the business and ${Math.round(share.valuation * 100)}% from the multiple.`;
}
