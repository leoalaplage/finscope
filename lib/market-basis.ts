import { netDebt, valueOf } from "./finance";
import type { FinancialPeriod, PricePoint } from "./types";

/**
 * The one place a share price is allowed to meet a filed statement.
 *
 * Every screen that states a market capitalisation used to build one itself:
 * take whichever share count was there, multiply by whatever price had loaded,
 * and print it. Four screens, four slightly different rules, and none of them
 * asked the two questions that decide whether the product is a fact at all —
 * is the price in the currency the accounts are kept in, and is the share count
 * the one the company actually has outstanding.
 *
 * ASML answers the first one badly. It files in euros and its shares are quoted
 * in dollars, so its market capitalisation, enterprise value, price-to-earnings
 * and every valuation multiple were a dollar numerator over a euro denominator,
 * some of them labelled EUR. A warning existed and blocked nothing. There is no
 * exchange rate applied here and there never will be — a rate applied silently
 * to a filed figure is exactly the quiet estimate this application exists not
 * to make — so the answer is to withhold the figure and say why.
 */
export type SharesBasis = "outstanding" | "cover-date" | "diluted";

/** The cover-page count: outstanding, on the day the report was signed. */
const COVER_PAGE_SHARES = "dei:EntityCommonStockSharesOutstanding";

export interface MarketBasis {
  /** The matched session close, in `currency`. */
  price: number;
  /** The currency of both the price and the statements; they are equal or there is no basis. */
  currency: string;
  date: string;
  shares: number;
  sharesBasis: SharesBasis;
  /** Said out loud wherever the figure is shown, when the count is not the outstanding one. */
  sharesNote?: string;
  marketCap: number;
  netDebt: number | null;
  enterpriseValue: number | null;
  /** Why there is a market capitalisation but no enterprise value. */
  enterpriseValueReason?: string;
}

export type MarketBasisResult = { basis: MarketBasis; reason: undefined } | { basis: null; reason: string };

/**
 * The share count a market capitalisation may be built on, and what it is.
 *
 * The point-in-time count the filer reports at its period end is the right one.
 * The diluted weighted average is a different measure — an average over the
 * year, including shares issued for options that may not exist yet — and it is
 * 1.6% away from Apple's real count, 3.2% from JPMorgan's and 4.4% from
 * Rivian's. Substituting it is defensible; substituting it silently is not, so
 * the basis travels with the number and every caller states it.
 */
export function shareCount(period: FinancialPeriod): { shares: number; basis: SharesBasis; note?: string } | null {
  const outstanding = valueOf(period, "sharesOutstanding");
  if (outstanding != null && outstanding > 0) {
    /*
     * Three answers, in the order of how well each one answers the question.
     *
     * The parenthetical is the count on the day the books closed, which is the
     * count a market capitalisation wants. The cover-page count is the same
     * measure a few weeks later — a real count of real shares, moved only by
     * whatever was issued or bought back since — and for a filer with several
     * share classes it is the only one that reaches this endpoint at all. Both
     * beat an average over a year by a distance, and neither is passed off as
     * the other: the basis travels with the number and every caller states it.
     */
    return period.facts.sharesOutstanding?.provenance.concept === COVER_PAGE_SHARES
      ? {
        shares: outstanding, basis: "cover-date",
        note: "The filer publishes no period-end share count this feed can read, so the count on the cover of the report stands in. It is a real count of shares outstanding, taken a few weeks after the period closed.",
      }
      : { shares: outstanding, basis: "outstanding" };
  }
  const diluted = valueOf(period, "dilutedShares");
  if (diluted != null && diluted > 0) {
    return {
      shares: diluted, basis: "diluted",
      note: "The filer publishes no period-end share count this feed can read, so the diluted weighted average stands in. It is an average over the period rather than a count on one day.",
    };
  }
  return null;
}

export function marketBasis(period: FinancialPeriod, point: PricePoint | null | undefined): MarketBasisResult {
  const price = point ? point.priceClose ?? point.close : null;
  if (point == null || price == null || !Number.isFinite(price) || price <= 0) return { basis: null, reason: "No matched market price" };
  if (point.currency !== period.currency) {
    return {
      basis: null,
      reason: `The share price is quoted in ${point.currency} and the statements are filed in ${period.currency}. FinScope does not convert filed figures, so market capitalisation and every multiple built on it are withheld for this company.`,
    };
  }
  const count = shareCount(period);
  if (!count) return { basis: null, reason: "The filing carries no share count" };
  const debt = netDebt(period);
  return {
    reason: undefined,
    basis: {
      price, currency: period.currency, date: point.date,
      shares: count.shares, sharesBasis: count.basis, sharesNote: count.note,
      marketCap: price * count.shares,
      netDebt: debt,
      enterpriseValue: debt == null ? null : price * count.shares + debt,
      enterpriseValueReason: debt == null
        ? valueOf(period, "totalDebt") == null
          ? "The filing tags no debt concept this adapter reads, and an absent balance is not a zero one"
          : "The filing tags no cash balance, so net debt cannot be struck"
        : undefined,
    },
  };
}

/**
 * A multiple, or nothing — one rule, everywhere.
 *
 * A price over a negative free cash flow is a negative multiple, and a negative
 * multiple is not a cheap company: it is a company the measure does not apply
 * to. Three screens agreed on that and one did not, so a loss-making company
 * carried a numeric price-to-free-cash-flow under Latest figures and an em dash
 * under Statistics, in the same session, on the same figure.
 */
export function multipleOf(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator == null || denominator == null || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (numerator <= 0 || denominator <= 0) return null;
  return numerator / denominator;
}

/** The reason a multiple is unavailable, for a caller that shows one. */
export function multipleReason(denominatorLabel: string) {
  return `${denominatorLabel} is not positive`;
}
