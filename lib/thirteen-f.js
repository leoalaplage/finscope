/**
 * Reading a Form 13F value in the unit its filer used.
 *
 * The form used to be filed in thousands of dollars and is now filed in whole
 * ones. Five per cent of managers are still on the old footing — a hundred and
 * forty-five thousand of the three million holdings in a single quarter — and
 * nothing in the file says which convention a row is on. T. Rowe Price reported
 * thirty-three million shares of Meta at $18.9m, a price of fifty-seven cents
 * for a share that traded at $572, and it went straight onto the page.
 *
 * This is plain JavaScript rather than TypeScript because the quarterly build
 * script is a plain Node module and imports it directly. The logic that broke
 * lived inside that script, where nothing could test it; here both the script
 * and the test suite read the same functions.
 */

/**
 * What one share was worth, according to everybody who reported holding it.
 *
 * No price is fetched. Thousands of managers hold a large company and the
 * median of what they implicitly paid a share *is* its price at the quarter
 * end: a filer at a thousandth of that is filing in thousands, and nothing else
 * is a thousandth of anything. It is the inference the screener makes about a
 * market-cap column stated in an unknown unit, for the same reason — the scale
 * is a fact about the source, not about the company.
 */
export function impliedPrice(prices) {
  const usable = prices.filter((price) => Number.isFinite(price) && price > 0).sort((left, right) => left - right);
  return usable.length ? usable[Math.floor(usable.length / 2)] : null;
}

/**
 * How far from the company's own median a value may sit and still be read.
 *
 * Wide, because a filer may value a holding at a date a few days from the
 * quarter end and a volatile share can move a fifth in a fortnight. Narrow
 * enough that the thousandfold band is nowhere near it.
 */
export const AS_FILED = { low: 0.2, high: 5 };
export const IN_THOUSANDS = { low: 0.0002, high: 0.005 };

/**
 * One holding's value in dollars, or nothing where it cannot be read.
 *
 * Three outcomes and no fourth. A value consistent with what everybody else
 * implied is taken as filed. One a thousandth of that is filed in thousands and
 * is multiplied. Anything else is a figure this cannot account for — a mistyped
 * share count, a class the CUSIP does not separate — and is withheld rather
 * than guessed at, because a wrong value that looks right is worse than a blank
 * one that says so.
 */
export function valueInDollars(raw, shares, typical) {
  if (!Number.isFinite(raw) || raw <= 0) return { value: null, state: "absent" };
  if (!Number.isFinite(shares) || shares <= 0) return { value: null, state: "absent" };
  if (!Number.isFinite(typical) || typical <= 0) return { value: null, state: "withheld" };
  const ratio = raw / shares / typical;
  if (ratio > AS_FILED.low && ratio < AS_FILED.high) return { value: raw, state: "as-filed" };
  if (ratio > IN_THOUSANDS.low && ratio < IN_THOUSANDS.high) return { value: raw * 1000, state: "rescaled" };
  return { value: null, state: "withheld" };
}

/**
 * Whether a finished company record prices its holders consistently.
 *
 * The check the pipeline had no way of failing. Every manager in one company's
 * table is quoting one quarter-end price, so their implied prices must agree;
 * where they do not, a convention has changed again or something else is wrong,
 * and the right move is to stop rather than to publish. Managers whose value
 * was withheld are not evidence either way and are skipped.
 */
export function pricingDisagreement(top) {
  const priced = top.filter((holding) => holding.value > 0 && holding.shares > 0);
  if (priced.length < 3) return null;
  const prices = priced.map((holding) => holding.value / holding.shares);
  const median = impliedPrice(prices);
  if (median == null) return null;
  const worst = priced.reduce((found, holding) => {
    const ratio = holding.value / holding.shares / median;
    const distance = Math.max(ratio, 1 / ratio);
    return distance > found.distance ? { name: holding.name, price: holding.value / holding.shares, distance } : found;
  }, { name: "", price: 0, distance: 1 });
  return worst.distance > AS_FILED.high ? { ...worst, median } : null;
}

/**
 * How far the filings' share basis is from the one this site keeps.
 *
 * A 13F reports the shares a manager held on the day, counted as they were
 * counted on the day. This application counts every share on today's basis,
 * restating the whole record through any split since — so the two disagree by
 * exactly the split whenever one has happened in between. Booking split
 * twenty-five for one after the March quarter, and BlackRock's genuine eight
 * and a half per cent of it reached the page as nought point three.
 *
 * Measured, not looked up, and from the one thing a split cannot move: dollars.
 * Every filing implies a price — its value over its shares — and the company's
 * own adjusted close on that day is the same price on the other basis. Their
 * ratio is the split, whatever it was, and it is one for every company that
 * never had one.
 */
export const SAME_BASIS = 0.15;

export function basisFactor(impliedPriceAtQuarter, adjustedCloseAtQuarter) {
  if (!Number.isFinite(impliedPriceAtQuarter) || !(impliedPriceAtQuarter > 0)) return 1;
  if (!Number.isFinite(adjustedCloseAtQuarter) || !(adjustedCloseAtQuarter > 0)) return 1;
  const factor = impliedPriceAtQuarter / adjustedCloseAtQuarter;
  // Within a sixth of one another they are the same basis, and what is left is
  // a filer valuing its holding a day or two from the quarter end.
  return Math.abs(factor - 1) < SAME_BASIS ? 1 : factor;
}
