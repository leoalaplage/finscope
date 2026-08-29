import { COMPANIES } from "./company-registry";
import type { CompanyProfile } from "./types";

/**
 * A plausible exchange symbol: letters, digits, and the dot and dash classes
 * exchanges use. Every endpoint that accepts a ticker from a query string
 * checks it against this before doing anything with it.
 */
export const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

/**
 * The profile a market endpoint needs for any company a reader may open.
 *
 * The price endpoints used to answer `404 Ticker not supported` for anything
 * outside the twenty-one-company registry, while `/api/company` happily
 * normalized any SEC filer. The two halves of the application therefore
 * disagreed about what counts as a known company, and every company a reader
 * added themselves loaded its filings and then showed no price, no market
 * capitalisation, no valuation multiple, no price chart and no DCF — an
 * application that looks half broken on the first company you choose yourself.
 *
 * Fundamentals need a CIK and a verified identity, which is why the registry
 * exists. A price needs a symbol and nothing else, so the fallback is the
 * symbol itself: for a US listing the exchange ticker and the Yahoo symbol are
 * the same string, and where they are not, the request simply finds no
 * sessions and the caller reports that — which is the same outcome as today,
 * reached honestly.
 *
 * What the fallback does *not* claim is split history. A synthesised profile
 * carries none, so `resolutionStatus` stays `partial` and callers can say that
 * long per-share series for such a company are unadjusted rather than implying
 * the registry vouches for them.
 */
export function resolveMarketProfile(symbol: string): CompanyProfile | null {
  const ticker = symbol.toUpperCase();
  const known = COMPANIES.find((company) => company.ticker.toUpperCase() === ticker);
  if (known) return known;
  if (!TICKER_PATTERN.test(ticker)) return null;
  return {
    name: ticker,
    ticker,
    yahooTicker: ticker,
    cik: "",
    regulatoryId: "",
    exchange: "US exchange",
    currency: "USD",
    sector: "Unclassified",
    description: "Resolved from the requested symbol; market data only.",
    resolutionStatus: "partial",
    resolutionNote: "No verified split history is held for this symbol, so long per-share price series are unadjusted.",
    businessType: "operating",
  };
}
