/**
 * How many ordinary shares one American depositary share stands for.
 *
 * A foreign company's statements count its ordinary shares; its New York price
 * is for a depositary receipt that may hold one of them, several, or half of
 * one. Multiplying one by the other without the ratio is not an approximation:
 * Taiwan Semiconductor's receipt holds five shares, so its market capitalisation
 * would come out five times too large, and AstraZeneca's holds half a share, so
 * its would come out at half.
 *
 * Only ratios this application is sure of are listed. A company whose price is
 * quoted in a different currency from its statements and which is not listed
 * here keeps its valuation withheld, with the reason, rather than priced on a
 * guess. A ratio changes rarely and is announced when it does; this list is the
 * place to change it.
 */
export const ORDINARY_SHARES_PER_RECEIPT: Readonly<Record<string, number>> = {
  // One receipt, several ordinary shares.
  TSM: 5,
  BABA: 8,
  HSBC: 5,
  BP: 6,
  SHEL: 2,
  GSK: 2,
  BHP: 2,
  DEO: 4,
  HDB: 3,
  IBN: 2,
  PDD: 4,
  JD: 2,
  NTES: 5,
  TM: 10,
  // One receipt, part of an ordinary share.
  AZN: 0.5,
  SNY: 0.5,
  // One receipt, one share.
  ASML: 1,
  NVO: 1,
  NVS: 1,
  SAP: 1,
  UL: 1,
  SONY: 1,
  RIO: 1,
  BTI: 1,
  TTE: 1,
  INFY: 1,
  TCOM: 1,
  ARM: 1,
};

/** Ordinary shares per receipt for this ticker, or null where it is not known. */
export function sharesPerReceipt(ticker: string): number | null {
  return ORDINARY_SHARES_PER_RECEIPT[ticker.toUpperCase()] ?? null;
}
