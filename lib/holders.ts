/**
 * Who holds a company, as its holders themselves reported it.
 *
 * Every institutional manager with over $100m under discretion files Form 13F
 * within forty-five days of a quarter end, and the SEC republishes each quarter
 * as a single archive. `scripts/fetch-13f-holders.mjs` reduces it to one record
 * a company; this is the shape of that record and the one rule for reading it.
 */

/**
 * What the stored records were built from.
 *
 * In the key, so a rebuilt quarter never sits behind the last one, and in the
 * URL the page asks with, because the reader's own browser is a second cache
 * keyed by the address rather than by the key.
 */
export const HOLDERS_SHAPE = "h1";

export const holdersKey = (ticker: string) => `holders:${HOLDERS_SHAPE}:${ticker.toUpperCase()}`;

export interface HeldPosition {
  name: string;
  shares: number;
  /** As the manager valued it on the cover of its own filing, in dollars. */
  value: number;
}

export interface HoldersRecord {
  /** The quarter these positions were reported for. */
  asOf: string | null;
  /** How many managers reported a position at all. */
  managers: number;
  /** Every reported share, not only the ones listed below. */
  reported: number;
  top: HeldPosition[];
}

/**
 * A holding as a share of the company — summed, and therefore an upper bound.
 *
 * Two managers may both report the same shares when discretion over them is
 * shared: a custodian and the adviser behind it each file, and both are telling
 * the truth. Adding the filings up is what every table of this kind does, and
 * it double-counts — Apple's reported shares come to eighty-five per cent of a
 * company that is not eighty-five per cent institutionally owned.
 *
 * The figure is kept because it is what a reader wants, and it is returned with
 * nothing hiding what it is: the page states it as the sum of filings and says
 * it may double-count. A percentage printed without that sentence is the same
 * arithmetic, wrong, and quiet about it.
 */
export function shareOfCompany(shares: number, sharesOutstanding: number | null): number | null {
  if (sharesOutstanding == null || !(sharesOutstanding > 0) || !(shares > 0)) return null;
  return shares / sharesOutstanding;
}
