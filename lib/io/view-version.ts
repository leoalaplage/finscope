import { KEY_VERSION } from "../data-version";

/**
 * What the page asks for, and what the answer is stored under.
 *
 * Two versions travel together and both belong in the URL. The shape is what
 * the browser knows how to draw — never serve an older one to a client that
 * asked for this one — and the data version is what the figures were built
 * with. The URL used to carry only the first, so a corrected split or a
 * corrected share count landed in the store behind a copy every browser had
 * already been told it could keep for a day: the fix was live, and the reader
 * kept seeing yesterday's company until they came back a third time.
 *
 * iov2 added the historical TTM series. iov3 dropped the per-metric colour it
 * also carried: no chart on this site is drawn in anything but one ink. iov4
 * carries every trailing period the filings support rather than six years of
 * them, and lists only the measures a company actually has. iov5 stops
 * shipping the statement layout with every company — it is the shape of the
 * page, not a fact about a filer, and a new section stayed invisible for a day
 * behind the cache. iov6 withholds the measures a bank, broker or insurer has
 * no boundary for. iov7 carries where the borrowings behind an enterprise value
 * were filed, so a balance the latest quarter does not tag is read back to the
 * filing that states one rather than taking the enterprise value with it.
 */
export const VIEW_SHAPE = "iov7";

/** The token a reader's request carries: the shape, then the figures. */
export const IO_VIEW = `${VIEW_SHAPE}.${KEY_VERSION}`;
