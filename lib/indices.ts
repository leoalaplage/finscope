/**
 * The three headline US indices, and nothing else.
 *
 * Held apart from both the company registry and the benchmark list in the
 * market route. An index has no filings, so it does not belong beside
 * companies; and unlike a benchmark, which exists to be a line behind a
 * portfolio, these are the subject of their own page. The Dow is here and not
 * in the benchmark list precisely because nobody measures a book against it.
 *
 * Nasdaq is the Composite rather than the Nasdaq 100. The number quoted as
 * "the Nasdaq" on every front page is the Composite, and showing the 100 under
 * that label would be a different index wearing the expected name.
 */
export interface IndexDefinition {
  /** How this application names it, and what its URL says. */
  id: string;
  /** Yahoo's symbol. */
  symbol: string;
  label: string;
  description: string;
}

export const INDICES: IndexDefinition[] = [
  { id: "SPX", symbol: "^GSPC", label: "S&P 500", description: "Five hundred large US companies, weighted by market value." },
  { id: "NASDAQ", symbol: "^IXIC", label: "NASDAQ", description: "Every common stock listed on Nasdaq, weighted by market value." },
  { id: "DOW", symbol: "^DJI", label: "DOW", description: "Thirty large US companies, weighted by share price." },
];

export function indexById(id: string) {
  return INDICES.find((index) => index.id.toUpperCase() === id.toUpperCase()) ?? null;
}
