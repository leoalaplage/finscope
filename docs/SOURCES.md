# Sources and lineage

## SEC EDGAR

The U.S. SEC is the primary provider for U.S. GAAP fundamentals. FinScope calls `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` server-side, validates the response, selects 10-K annual contexts with a 300–400 day duration, and uses concept fallbacks in declared priority order.

Each fact retains provider, source URL, accession number, filing date, retrieval time, fiscal year, period end, periodicity, currency, unit, XBRL concept and status. Duplicate annual facts are ordered by filing date and the most recently filed compatible context is selected, allowing restatements to supersede older presentations without losing lineage.

The server cache response is six hours with a 24-hour stale-while-revalidate window. Automated use should identify itself through `SEC_USER_AGENT` and respect the SEC fair-access limit.

Official references:

- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://www.sec.gov/about/developer-resources

## Yahoo Finance boundary

Yahoo Finance is the requested source for market prices, split history and market-dependent valuation. Its chart/download interfaces are unofficial, rate-limited and subject to licensing restrictions, so FinScope keeps this provider behind a replaceable adapter boundary.

The present build fails closed: when a historical close cannot be verified, valuation is shown as unavailable. A future price fact must carry ticker, exact date, price type, currency and source URL. The selection rule is the close on the fiscal period end, or the nearest preceding trading day.

Yahoo references:

- https://help.yahoo.com/kb/finance/download-historical-data-yahoo-finance-sln2311.html
- https://help.yahoo.com/kb/finance-for-web/SLN2310.html

## Conflict policy

Official regulatory filings outrank third-party aggregations. Facts from incompatible GAAP/non-GAAP definitions are not merged. Currency changes, fiscal-year changes, 52/53-week periods, acquisitions, spin-offs, ticker changes and stock splits must remain explicit metadata or warnings. Missing values are not interpolated.
