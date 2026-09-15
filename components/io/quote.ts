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
  /** Set when this is a price per ordinary share in the statements' currency, derived from the quote. */
  conversion?: PriceConversion;
}

export interface PriceConversion {
  /** The currency the receipt is quoted in. */
  from: string;
  /** Units of the statements' currency one unit of `from` bought, where a conversion was made. */
  rate: number | null;
  asOf: string | null;
  /** Ordinary shares one receipt stands for, where that is not one. */
  sharesPerReceipt: number | null;
}

/**
 * The price a filed share count can be multiplied by.
 *
 * A company's statements count ordinary shares in the currency it reports in.
 * Its New York quote may be for a depositary receipt holding several of those
 * shares, or half of one, and may be in dollars against accounts in euros or
 * Taiwan dollars. Multiplying the two as they come is not an approximation — it
 * made TSMC five times its size. So the receipt is divided into ordinary shares
 * and the price converted at today's rate, and the result says both.
 *
 * Where the currencies differ and the receipt's ratio is not known, nothing is
 * converted and the valuation stays withheld, as before, with that reason.
 */
export function priceForStatements(
  quote: IoQuote | null,
  statementCurrency: string | null | undefined,
  fx: { rate: number; asOf: string | null } | null,
  sharesPerReceipt: number | null,
): IoQuote | null {
  if (!quote || quote.price == null || !Number.isFinite(quote.price)) return quote;
  const foreign = Boolean(statementCurrency && quote.currency && quote.currency !== statementCurrency);
  if (!foreign && (sharesPerReceipt == null || sharesPerReceipt === 1)) return quote;
  if (foreign && (sharesPerReceipt == null || !fx?.rate)) return quote;
  const rate = foreign ? fx!.rate : null;
  const price = (quote.price / (sharesPerReceipt ?? 1)) * (rate ?? 1);
  return {
    ...quote,
    price,
    currency: foreign ? statementCurrency! : quote.currency,
    conversion: { from: quote.currency, rate, asOf: foreign ? fx!.asOf : null, sharesPerReceipt: sharesPerReceipt === 1 ? null : sharesPerReceipt },
  };
}
