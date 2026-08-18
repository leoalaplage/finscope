/**
 * The fifty largest companies in the S&P 500, in order of index weight.
 *
 * A static list, and honestly so. The index's composition and weights are
 * published by S&P and licensed; there is no free feed of them, and the
 * alternative — inferring weights from prices and share counts for five hundred
 * companies — would be several hundred requests to answer a question about the
 * ordering of a grid.
 *
 * What this costs is accuracy of *membership*, not of the figures: every price
 * and every move shown for these tickers is fetched live. A company that has
 * left the top fifty since this list was written is still a real company with a
 * real move; it is simply in a position it no longer holds. The list is dated so
 * that staleness is visible rather than assumed away.
 *
 * Last reviewed 2026-08-18.
 */
export const SP500_REVIEWED = "2026-08-18";

export interface IndexMember {
  /** Yahoo's symbol, which differs from the exchange's for dual-class names. */
  symbol: string;
  /** How the tile labels it. Short, because a tile is small. */
  label: string;
  sector: string;
  /**
   * Shares outstanding, in billions, and only ever multiplied by a live price.
   *
   * This is what sizes a tile. It is static and approximate, and both are fine
   * for the job: a share count moves a percent or two a year through buybacks
   * and grants, so a tile drawn from one a few months old is a percent or two
   * off the area it should have — which is invisible next to a neighbour twice
   * its size, and is the only claim the tile is making. The *price* in it is
   * live, and so is the colour, which is where accuracy actually matters.
   *
   * Where a company has more than one class of stock the figure is every class
   * together, because the company's value is not only its A shares.
   */
  shares: number;
}

export const SP500_TOP_50: IndexMember[] = [
  { symbol: "NVDA", label: "NVDA", sector: "Technology" , shares: 24.4 },
  { symbol: "AAPL", label: "AAPL", sector: "Technology" , shares: 14.78 },
  { symbol: "MSFT", label: "MSFT", sector: "Technology" , shares: 7.43 },
  { symbol: "GOOGL", label: "GOOGL", sector: "Communication" , shares: 12.07 },
  { symbol: "AMZN", label: "AMZN", sector: "Consumer" , shares: 10.72 },
  { symbol: "META", label: "META", sector: "Communication" , shares: 2.52 },
  { symbol: "AVGO", label: "AVGO", sector: "Technology" , shares: 4.71 },
  { symbol: "BRK-B", label: "BRK.B", sector: "Financials" , shares: 2.16 },
  { symbol: "TSLA", label: "TSLA", sector: "Consumer" , shares: 3.5 },
  { symbol: "JPM", label: "JPM", sector: "Financials" , shares: 2.75 },
  { symbol: "LLY", label: "LLY", sector: "Health care" , shares: 0.95 },
  { symbol: "V", label: "V", sector: "Financials" , shares: 1.94 },
  { symbol: "NFLX", label: "NFLX", sector: "Communication" , shares: 0.425 },
  { symbol: "XOM", label: "XOM", sector: "Energy" , shares: 4.3 },
  { symbol: "COST", label: "COST", sector: "Consumer" , shares: 0.444 },
  { symbol: "MA", label: "MA", sector: "Financials" , shares: 0.91 },
  { symbol: "WMT", label: "WMT", sector: "Consumer" , shares: 8.0 },
  { symbol: "UNH", label: "UNH", sector: "Health care" , shares: 0.92 },
  { symbol: "PG", label: "PG", sector: "Consumer" , shares: 2.35 },
  { symbol: "JNJ", label: "JNJ", sector: "Health care" , shares: 2.41 },
  { symbol: "HD", label: "HD", sector: "Consumer" , shares: 0.99 },
  { symbol: "ORCL", label: "ORCL", sector: "Technology" , shares: 2.81 },
  { symbol: "ABBV", label: "ABBV", sector: "Health care" , shares: 1.77 },
  { symbol: "AMD", label: "AMD", sector: "Technology" , shares: 1.62 },
  { symbol: "BAC", label: "BAC", sector: "Financials" , shares: 7.6 },
  { symbol: "CRM", label: "CRM", sector: "Technology" , shares: 0.96 },
  { symbol: "KO", label: "KO", sector: "Consumer" , shares: 4.31 },
  { symbol: "CVX", label: "CVX", sector: "Energy" , shares: 2.0 },
  { symbol: "MRK", label: "MRK", sector: "Health care" , shares: 2.53 },
  { symbol: "PEP", label: "PEP", sector: "Consumer" , shares: 1.37 },
  { symbol: "TMO", label: "TMO", sector: "Health care" , shares: 0.38 },
  { symbol: "LIN", label: "LIN", sector: "Materials" , shares: 0.475 },
  { symbol: "CSCO", label: "CSCO", sector: "Technology" , shares: 3.96 },
  { symbol: "ADBE", label: "ADBE", sector: "Technology" , shares: 0.42 },
  { symbol: "ACN", label: "ACN", sector: "Technology" , shares: 0.63 },
  { symbol: "MCD", label: "MCD", sector: "Consumer" , shares: 0.715 },
  { symbol: "ABT", label: "ABT", sector: "Health care" , shares: 1.74 },
  { symbol: "PM", label: "PM", sector: "Consumer" , shares: 1.56 },
  { symbol: "IBM", label: "IBM", sector: "Technology" , shares: 0.93 },
  { symbol: "GE", label: "GE", sector: "Industrials" , shares: 1.07 },
  { symbol: "QCOM", label: "QCOM", sector: "Technology" , shares: 1.09 },
  { symbol: "TXN", label: "TXN", sector: "Technology" , shares: 0.91 },
  { symbol: "NOW", label: "NOW", sector: "Technology" , shares: 0.207 },
  { symbol: "CAT", label: "CAT", sector: "Industrials" , shares: 0.48 },
  { symbol: "DHR", label: "DHR", sector: "Health care" , shares: 0.72 },
  { symbol: "VZ", label: "VZ", sector: "Communication" , shares: 4.21 },
  { symbol: "INTU", label: "INTU", sector: "Technology" , shares: 0.28 },
  { symbol: "AMGN", label: "AMGN", sector: "Health care" , shares: 0.538 },
  { symbol: "ISRG", label: "ISRG", sector: "Health care" , shares: 0.357 },
  { symbol: "DIS", label: "DIS", sector: "Communication" , shares: 1.81 },
];
