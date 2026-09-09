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
 *
 * Bump it whenever the records change *meaning*, not only when they are
 * rebuilt from a newer quarter. h1 counted every report in the archive; h2
 * counts one quarter and one report a manager, and Apple's largest holder is a
 * different name under the two. Overwriting h1 in place left the store correct
 * and every reader looking at the old answer until the next day.
 *
 * `scripts/fetch-13f-holders.mjs` reads this line rather than repeating it: two
 * copies of a cache key are one edit away from writing under a name nothing
 * reads.
 */
export const HOLDERS_SHAPE = "h3";

/**
 * The key a company's record is stored under.
 *
 * Stripped to letters and digits, because the two conventions disagree about
 * separators and the store is written from one of them: Berkshire's B shares
 * are `BRKB` in the SEC's own symbol file and `BRK.B` here. Normalising only on
 * the way in wrote a record that nothing could ever read — which is precisely
 * what happened, and Berkshire showed no holders at all.
 */
export const holdersKey = (ticker: string) =>
  `holders:${HOLDERS_SHAPE}:${ticker.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;

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
 * What it must not carry on top of that is arithmetic of this application's
 * own making. It did: the quarterly archive is named for a span of filing
 * dates rather than a quarter, and summing every report in it added December's
 * holdings to March's and an amendment to the report it amends. Vanguard came
 * out at thirteen per cent of Apple against BlackRock's eight. Filtered to one
 * quarter and one report a manager, it is 6.5 against 7.8, and every reported
 * share of Apple comes to 64% of the company rather than 85%.
 */
export function shareOfCompany(shares: number, sharesOutstanding: number | null): number | null {
  if (sharesOutstanding == null || !(sharesOutstanding > 0) || !(shares > 0)) return null;
  return shares / sharesOutstanding;
}
