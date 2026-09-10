/**
 * What governments pay to borrow, which is the price everything else is set
 * against.
 *
 * A market page showing equities and raw materials is still missing the number
 * that discounts both of them. Every valuation on this site starts from a
 * risk-free rate; this row is where that rate actually comes from, and the
 * shape of it — three months against thirty years — is the single most watched
 * reading in finance.
 *
 * Six lines, and only where a source exists that publishes daily and can be
 * read by a machine:
 *
 *   United States  Yahoo carries the four Treasury yields as symbols, with
 *                  intraday bars, so they behave exactly like the indices.
 *   Euro area      The ECB publishes its own curve once a business day. It is
 *                  the AAA-rated curve — the euro-area risk-free benchmark —
 *                  and it is never labelled as the Bund, which it is not.
 *
 * The United Kingdom is absent, and absent for a stated reason rather than by
 * oversight. Yahoo carries no gilt yield under any symbol tried; the Bank of
 * England's own database serves its interactive page rather than the CSV it
 * advertises; Stooq answers with a bot challenge; and the ECB's own UK series
 * stopped at January 2020 with the end of convergence reporting. The nearest
 * reachable figure is a monthly OECD average running two to three months
 * behind, and a stale monthly average sitting unlabelled in a row of daily
 * readings would be the substitution this application does not make.
 */

export type BondFeed =
  /** A Yahoo symbol, quoted like any other instrument, with intraday bars. */
  | { kind: "yahoo"; symbol: string }
  /** A key into the ECB's daily yield-curve dataset. */
  | { kind: "ecb"; key: string };

export interface BondDefinition {
  /** How this application names it, and what its URL says. */
  id: string;
  label: string;
  /** What the quoted number is a yield on, which is never obvious from a tenor. */
  description: string;
  /**
   * Whether the reading moves while the market is open.
   *
   * The Treasury yields do; the ECB's curve is struck once a business day and
   * published with about a day's lag. The difference is shown on screen rather
   * than left for a reader to discover from a date that never changes.
   */
  live: boolean;
  feed: BondFeed;
}

const ECB_AAA = (tenor: string) => `B.U2.EUR.4F.G_N_A.SV_C_YM.SR_${tenor}`;

export const BONDS: BondDefinition[] = [
  {
    id: "US3M", label: "US 3-month", live: true, feed: { kind: "yahoo", symbol: "^IRX" },
    // Quoted as a discount rate on the bill rather than as a bond-equivalent
    // yield, which is how it is quoted everywhere and worth saying once.
    description: "The 13-week Treasury bill, on the discount basis it is quoted on.",
  },
  { id: "US5Y", label: "US 5-year", live: true, feed: { kind: "yahoo", symbol: "^FVX" }, description: "The five-year Treasury note yield." },
  { id: "US10Y", label: "US 10-year", live: true, feed: { kind: "yahoo", symbol: "^TNX" }, description: "The ten-year Treasury note yield — the world's reference rate." },
  { id: "US30Y", label: "US 30-year", live: true, feed: { kind: "yahoo", symbol: "^TYX" }, description: "The thirty-year Treasury bond yield." },
  { id: "EU2Y", label: "Euro area 2-year", live: false, feed: { kind: "ecb", key: ECB_AAA("2Y") }, description: "The ECB's two-year spot rate for triple-A euro-area governments." },
  { id: "EU10Y", label: "Euro area 10-year", live: false, feed: { kind: "ecb", key: ECB_AAA("10Y") }, description: "The ECB's ten-year spot rate for triple-A euro-area governments." },
];

export function bondById(id: string) {
  return BONDS.find((bond) => bond.id.toUpperCase() === id.toUpperCase()) ?? null;
}
