/** The last print, as `/api/io/[ticker]/quote` answers it. */
export interface IoQuote {
  ticker: string;
  symbol: string;
  name: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string;
  asOf: string | null;
}
