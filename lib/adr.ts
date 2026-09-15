/**
 * How many ordinary shares one American depositary share stands for.
 *
 * A foreign company's statements count its ordinary shares; its New York price
 * is for a depositary receipt that may hold one of them, several, or half of
 * one. Multiplying one by the other without the ratio is not an approximation:
 * Taiwan Semiconductor's receipt holds five shares, so its market capitalisation
 * would come out five times too large.
 *
 * Only ratios this application is sure of are listed, and the list says how
 * each is known. Checked on 15 September 2026 against the cover page of each
 * company's latest annual report (`dei:Security12bTitle`): most state "each
 * representing N ordinary shares" in so many words; the rest name the receipt
 * without its ratio, and carry the long-standing ratio of their programme.
 *
 * A company whose price is quoted in a different currency from its statements
 * and which is not listed here keeps its valuation withheld, with the reason,
 * rather than priced on a guess. A company that lists its ordinary shares in New
 * York directly needs no entry: AstraZeneca did in 2026, and the half-share
 * receipt this list once carried for it doubled its market capitalisation.
 */
export const ORDINARY_SHARES_PER_RECEIPT: Readonly<Record<string, number>> = {
  // Stated on the annual report's cover.
  BABA: 8, // "each representing eight Ordinary Shares"
  HSBC: 5, // "each representing 5 Ordinary Shares"
  NTES: 5, // "each representing five ordinary shares"
  PDD: 4, // "one American depositary share representing four Class A ordinary shares"
  HDB: 3, // "each representing three Equity Shares"
  SHEL: 2, // "American Depositary Shares representing two ordinary shares"
  SNY: 0.5, // "each representing one half of one ordinary share"
  NVO: 1, // "each representing one B Share"
  NVS: 1, // "each representing 1 share"
  SAP: 1, // "each Representing one Ordinary Share"
  UL: 1, // "each representing one ordinary share"
  INFY: 1, // "each represented by one Equity Share"
  ARM: 1, // "each representing one Ordinary Share"
  // The ordinary shares themselves are listed in New York.
  ASML: 1,
  TTE: 1,
  // Receipts the cover names without a ratio; the programme's standing ratio.
  TSM: 5,
  BP: 6,
  TM: 10,
  DEO: 4,
  GSK: 2,
  BHP: 2,
  JD: 2,
  IBN: 2,
  SONY: 1,
  RIO: 1,
  BTI: 1,
  TCOM: 1,
};

/** Ordinary shares per receipt for this ticker, or null where it is not known. */
export function sharesPerReceipt(ticker: string): number | null {
  return ORDINARY_SHARES_PER_RECEIPT[ticker.toUpperCase()] ?? null;
}
