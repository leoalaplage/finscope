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
}

export const SP500_TOP_50: IndexMember[] = [
  { symbol: "NVDA", label: "NVDA", sector: "Technology" },
  { symbol: "AAPL", label: "AAPL", sector: "Technology" },
  { symbol: "MSFT", label: "MSFT", sector: "Technology" },
  { symbol: "GOOGL", label: "GOOGL", sector: "Communication" },
  { symbol: "AMZN", label: "AMZN", sector: "Consumer" },
  { symbol: "META", label: "META", sector: "Communication" },
  { symbol: "AVGO", label: "AVGO", sector: "Technology" },
  { symbol: "BRK-B", label: "BRK.B", sector: "Financials" },
  { symbol: "TSLA", label: "TSLA", sector: "Consumer" },
  { symbol: "JPM", label: "JPM", sector: "Financials" },
  { symbol: "LLY", label: "LLY", sector: "Health care" },
  { symbol: "V", label: "V", sector: "Financials" },
  { symbol: "NFLX", label: "NFLX", sector: "Communication" },
  { symbol: "XOM", label: "XOM", sector: "Energy" },
  { symbol: "COST", label: "COST", sector: "Consumer" },
  { symbol: "MA", label: "MA", sector: "Financials" },
  { symbol: "WMT", label: "WMT", sector: "Consumer" },
  { symbol: "UNH", label: "UNH", sector: "Health care" },
  { symbol: "PG", label: "PG", sector: "Consumer" },
  { symbol: "JNJ", label: "JNJ", sector: "Health care" },
  { symbol: "HD", label: "HD", sector: "Consumer" },
  { symbol: "ORCL", label: "ORCL", sector: "Technology" },
  { symbol: "ABBV", label: "ABBV", sector: "Health care" },
  { symbol: "AMD", label: "AMD", sector: "Technology" },
  { symbol: "BAC", label: "BAC", sector: "Financials" },
  { symbol: "CRM", label: "CRM", sector: "Technology" },
  { symbol: "KO", label: "KO", sector: "Consumer" },
  { symbol: "CVX", label: "CVX", sector: "Energy" },
  { symbol: "MRK", label: "MRK", sector: "Health care" },
  { symbol: "PEP", label: "PEP", sector: "Consumer" },
  { symbol: "TMO", label: "TMO", sector: "Health care" },
  { symbol: "LIN", label: "LIN", sector: "Materials" },
  { symbol: "CSCO", label: "CSCO", sector: "Technology" },
  { symbol: "ADBE", label: "ADBE", sector: "Technology" },
  { symbol: "ACN", label: "ACN", sector: "Technology" },
  { symbol: "MCD", label: "MCD", sector: "Consumer" },
  { symbol: "ABT", label: "ABT", sector: "Health care" },
  { symbol: "PM", label: "PM", sector: "Consumer" },
  { symbol: "IBM", label: "IBM", sector: "Technology" },
  { symbol: "GE", label: "GE", sector: "Industrials" },
  { symbol: "QCOM", label: "QCOM", sector: "Technology" },
  { symbol: "TXN", label: "TXN", sector: "Technology" },
  { symbol: "NOW", label: "NOW", sector: "Technology" },
  { symbol: "CAT", label: "CAT", sector: "Industrials" },
  { symbol: "DHR", label: "DHR", sector: "Health care" },
  { symbol: "VZ", label: "VZ", sector: "Communication" },
  { symbol: "INTU", label: "INTU", sector: "Technology" },
  { symbol: "AMGN", label: "AMGN", sector: "Health care" },
  { symbol: "ISRG", label: "ISRG", sector: "Health care" },
  { symbol: "DIS", label: "DIS", sector: "Communication" },
];
