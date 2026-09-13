/**
 * The two rows that finish the page: the rest of the world's equities, and
 * what a currency is worth.
 *
 * A page titled "Market" that shows three American indices is a page about one
 * country, and this one already prices Japanese and British government debt
 * two rows below. The same for currencies: the site quotes oil in dollars, a
 * gilt in sterling and a Bund in euros, and said nothing about what those are
 * worth against each other.
 *
 * Six each, chosen the way the commodities were — the benchmark rather than
 * the complete list. Europe as a whole, then its two largest markets
 * separately because they diverge and everybody watches both; Asia as its two
 * poles. For currencies, the three pairs that price most of world trade, and
 * the dollar against everything at once.
 *
 * Neither row is a chart by default. They are context, and context that takes
 * as much room as the subject stops being context — one click opens any of
 * them into the same panel the indices use.
 */

export interface StripQuoteDefinition {
  /** How this application names it, and what its URL says. */
  id: string;
  /** Yahoo's symbol. */
  symbol: string;
  label: string;
  /** What the number is, which for an index is never obvious from its name. */
  description: string;
  /** How finely it is quoted: an index to the point, a currency to the pip. */
  places: number;
  /** The sentence under the figure, as the commodity row has its unit. */
  note: string;
}

export const WORLD_INDICES: StripQuoteDefinition[] = [
  { id: "SX5E", symbol: "^STOXX50E", label: "Euro Stoxx 50", description: "The fifty largest companies of the euro area.", places: 2, note: "euro area" },
  { id: "DAX", symbol: "^GDAXI", label: "DAX", description: "Forty large German companies, with dividends reinvested.", places: 2, note: "Germany" },
  { id: "CAC", symbol: "^FCHI", label: "CAC 40", description: "Forty large French companies.", places: 2, note: "France" },
  { id: "FTSE", symbol: "^FTSE", label: "FTSE 100", description: "A hundred large companies listed in London.", places: 2, note: "United Kingdom" },
  { id: "N225", symbol: "^N225", label: "Nikkei 225", description: "Two hundred and twenty-five Japanese companies, weighted by share price.", places: 2, note: "Japan" },
  { id: "HSI", symbol: "^HSI", label: "Hang Seng", description: "The largest companies listed in Hong Kong.", places: 2, note: "Hong Kong" },
];

export const CURRENCIES: StripQuoteDefinition[] = [
  { id: "EURUSD", symbol: "EURUSD=X", label: "EUR / USD", description: "US dollars per euro.", places: 4, note: "dollars per euro" },
  { id: "USDJPY", symbol: "JPY=X", label: "USD / JPY", description: "Japanese yen per dollar.", places: 2, note: "yen per dollar" },
  { id: "GBPUSD", symbol: "GBPUSD=X", label: "GBP / USD", description: "US dollars per pound sterling.", places: 4, note: "dollars per pound" },
  { id: "USDCHF", symbol: "CHF=X", label: "USD / CHF", description: "Swiss francs per dollar.", places: 4, note: "francs per dollar" },
  { id: "USDCNY", symbol: "CNY=X", label: "USD / CNY", description: "Chinese yuan per dollar, at the offshore rate.", places: 4, note: "yuan per dollar" },
  { id: "DXY", symbol: "DX-Y.NYB", label: "Dollar index", description: "The dollar against a basket of six currencies, most of it the euro.", places: 2, note: "against six currencies" },
];

export type StripSet = "world" | "currencies";
export const STRIP_SETS: StripSet[] = ["world", "currencies"];

export const stripMembers = (set: StripSet): StripQuoteDefinition[] =>
  set === "world" ? WORLD_INDICES : CURRENCIES;

/** Every quote either row carries, for the one route that draws any of them. */
export const ALL_STRIP_QUOTES: StripQuoteDefinition[] = [...WORLD_INDICES, ...CURRENCIES];

export function stripQuoteById(id: string): StripQuoteDefinition | null {
  const wanted = id.toUpperCase();
  return ALL_STRIP_QUOTES.find((quote) => quote.id.toUpperCase() === wanted) ?? null;
}
