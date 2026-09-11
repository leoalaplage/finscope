/**
 * What governments pay to borrow, which is the price everything else is set
 * against.
 *
 * A market page showing equities and raw materials is still missing the number
 * that discounts both of them. Every valuation on this site starts from a
 * risk-free rate; these rows are where that rate actually comes from, and the
 * shape of it — three months against thirty years, Tokyo against London — is
 * the most watched reading in finance.
 *
 * Three sets of six, and only where a source exists that publishes and can be
 * read by a machine and republished:
 *
 *   United States  Yahoo carries the four Treasury yields as symbols, with
 *                  intraday bars, so they behave exactly like the indices.
 *   Daily          The institution that strikes the number: the ECB for the
 *                  euro-area curve, the Bundesbank, the Bank of England, Japan's
 *                  Ministry of Finance, Banco de España, the Bank of Canada and
 *                  the Reserve Bank of Australia. Each publishes once a business
 *                  day, and each figure is shown with the date it belongs to.
 *   Monthly        France, Italy and four more euro members, from the ECB's
 *                  long-term rate for convergence purposes: a month's average,
 *                  published the month after, and labelled as exactly that.
 *
 * France is monthly for a reason that is not technical. Its daily ten-year is
 * the TEC 10, an index Euronext administers, and its values "may not be
 * redistributed" without Euronext's written authorisation — whichever site it
 * is read from, the Banque de France's and the Agence France Trésor's
 * included. Italy's daily figure is not published anywhere this site can
 * read. The ECB's monthly series is published for reuse, so it is the figure
 * this site can honestly show.
 */

import type { DailyFeed } from "./adapters/daily-yields";

export type BondFeed =
  /** A Yahoo symbol, quoted like any other instrument, with intraday bars. */
  | { kind: "yahoo"; symbol: string }
  /** A series struck once a day by the institution that publishes it. */
  | DailyFeed;

/**
 * Which strip a line sits in.
 *
 * The first is the pair of curves every other rate is read against; the second
 * is the rest of the largest government markets that publish daily; the third
 * is the euro members that publish only a monthly figure anybody may reuse.
 */
export type BondSet = "core" | "world" | "euro";
export const BOND_SETS: BondSet[] = ["core", "world", "euro"];

export interface BondDefinition {
  /** How this application names it, and what its URL says. */
  id: string;
  label: string;
  set: BondSet;
  /** What the quoted number is a yield on, which is never obvious from a tenor. */
  description: string;
  /**
   * Whether the reading moves while the market is open.
   *
   * The Treasury yields do; every other line is struck once a business day and
   * published hours or a day later. The difference is shown on screen rather
   * than left for a reader to discover from a date that never changes.
   */
  live: boolean;
  feed: BondFeed;
}

const ECB_AAA = (tenor: string) => `B.U2.EUR.4F.G_N_A.SV_C_YM.SR_${tenor}`;
const BUND = (years: string) => `D.I.ZST.ZI.EUR.S1311.B.A604.R${years}XX.R.A.A._Z._Z.A`;

export const BONDS: BondDefinition[] = [
  {
    id: "US3M", label: "US 3-month", set: "core", live: true, feed: { kind: "yahoo", symbol: "^IRX" },
    // Quoted as a discount rate on the bill rather than as a bond-equivalent
    // yield, which is how it is quoted everywhere and worth saying once.
    description: "The 13-week Treasury bill, on the discount basis it is quoted on.",
  },
  { id: "US5Y", label: "US 5-year", set: "core", live: true, feed: { kind: "yahoo", symbol: "^FVX" }, description: "The five-year Treasury note yield." },
  { id: "US10Y", label: "US 10-year", set: "core", live: true, feed: { kind: "yahoo", symbol: "^TNX" }, description: "The ten-year Treasury note yield — the world's reference rate." },
  { id: "US30Y", label: "US 30-year", set: "core", live: true, feed: { kind: "yahoo", symbol: "^TYX" }, description: "The thirty-year Treasury bond yield." },
  { id: "EU2Y", label: "Euro area 2-year", set: "core", live: false, feed: { kind: "ecb", key: ECB_AAA("2Y") }, description: "The ECB's two-year spot rate for triple-A euro-area governments." },
  { id: "EU10Y", label: "Euro area 10-year", set: "core", live: false, feed: { kind: "ecb", key: ECB_AAA("10Y") }, description: "The ECB's ten-year spot rate for triple-A euro-area governments." },

  { id: "DE10Y", label: "Germany 10-year", set: "world", live: false, feed: { kind: "bundesbank", key: BUND("10") }, description: "The Bundesbank's ten-year yield on listed Federal securities — the Bund curve." },
  { id: "UK10Y", label: "UK 10-year", set: "world", live: false, feed: { kind: "boe", maturity: "10" }, description: "The Bank of England's ten-year nominal spot yield on gilts." },
  { id: "JP10Y", label: "Japan 10-year", set: "world", live: false, feed: { kind: "mof", tenor: "10Y" }, description: "Japan's Ministry of Finance ten-year constant-maturity JGB yield." },
  { id: "ES10Y", label: "Spain 10-year", set: "world", live: false, feed: { kind: "bde", series: "D_G0B1F0ZP" }, description: "Banco de España's ten-year secondary-market yield on Spanish government bonds." },
  { id: "CA10Y", label: "Canada 10-year", set: "world", live: false, feed: { kind: "boc", series: "BD.CDN.10YR.DQ.YLD" }, description: "The Bank of Canada's ten-year benchmark bond yield." },
  { id: "AU10Y", label: "Australia 10-year", set: "world", live: false, feed: { kind: "rba", series: "FCMYGBAG10D" }, description: "The Reserve Bank of Australia's ten-year Australian Government bond yield." },

  { id: "FR10Y", label: "France 10-year", set: "euro", live: false, feed: { kind: "ecb-monthly", country: "FR" }, description: "France's ten-year government yield, as the ECB's monthly average." },
  { id: "IT10Y", label: "Italy 10-year", set: "euro", live: false, feed: { kind: "ecb-monthly", country: "IT" }, description: "Italy's ten-year government yield, as the ECB's monthly average." },
  { id: "NL10Y", label: "Netherlands 10-year", set: "euro", live: false, feed: { kind: "ecb-monthly", country: "NL" }, description: "The Netherlands' ten-year government yield, as the ECB's monthly average." },
  { id: "BE10Y", label: "Belgium 10-year", set: "euro", live: false, feed: { kind: "ecb-monthly", country: "BE" }, description: "Belgium's ten-year government yield, as the ECB's monthly average." },
  { id: "PT10Y", label: "Portugal 10-year", set: "euro", live: false, feed: { kind: "ecb-monthly", country: "PT" }, description: "Portugal's ten-year government yield, as the ECB's monthly average." },
  { id: "GR10Y", label: "Greece 10-year", set: "euro", live: false, feed: { kind: "ecb-monthly", country: "GR" }, description: "Greece's ten-year government yield, as the ECB's monthly average." },
];

export function bondById(id: string) {
  return BONDS.find((bond) => bond.id.toUpperCase() === id.toUpperCase()) ?? null;
}
