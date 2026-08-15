# Sources and lineage

## SEC EDGAR

The U.S. SEC is the primary provider for U.S. GAAP fundamentals. FinScope calls `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` server-side, validates the response, selects 10-K annual contexts with a 300–400 day duration, and uses concept fallbacks in declared priority order. Direct 55–125 day quarters are preferred. Compatible six- and nine-month cumulative facts are differenced, Q4 is annual minus Q3 year-to-date, and weighted shares use a day-weighted isolation formula.

Each fact retains provider, source URL, accession number, filing date, retrieval time, fiscal year, period end, periodicity, currency, unit, XBRL concept and status. Duplicate contexts are ordered by filing date and period end. The most recently filed compatible context is selected, allowing restatements to supersede older presentations without losing lineage. TTM flow values sum four consecutive quarters; weighted shares are day-weighted and point facts come from the latest quarter.

The server cache response is six hours with a 24-hour stale-while-revalidate window. Automated use should identify itself through `SEC_USER_AGENT` and respect the SEC fair-access limit.

A scheduled trigger rebuilds every watchlist company into the cache at 07:00 UTC daily, one HTTP subrequest per company. Normalizing twenty-one filers inside a single invocation is what exhausts an isolate's CPU budget; a subrequest each gives every company its own. The cost therefore falls at a moment when nobody is waiting, and the requests readers actually make stay on the warm path.

Normalized datasets are cached in a Cloudflare KV namespace bound as `DATASET_CACHE`, under the key `company:<version>:<ticker>`. The version is bumped whenever normalization changes meaning — a new concept fallback, a corrected split direction, a new quarter rule — so a cached dataset is never served under semantics it was not built with. The bump history is recorded in `lib/dataset-cache.ts`, alongside the key itself so the route and the warm-up cannot disagree about it. This cache is load-bearing rather than an optimization: normalizing a company from raw XBRL on every request exceeds the Worker CPU limit.

Official references:

- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://www.sec.gov/about/developer-resources

## Yahoo Finance historical prices

Yahoo Finance is the requested source for market prices and market-dependent valuation. Its chart interface is unofficial, rate-limited and subject to licensing restrictions, so FinScope keeps this provider behind a replaceable server adapter.

Adjusted close is preferred. Each price fact carries ticker, requested fiscal date, actual trading-session date, price type, currency, fallback direction and source URL. The selection order is exact session, previous session within seven calendar days, then a clearly marked next session within two days. Otherwise valuation is unavailable.

Share-count histories are adjusted for validated stock-split events stored in the company registry. The calculation keeps the original SEC filing link and explicitly lists the cumulative factor and effective dates.

Yahoo references:

- https://help.yahoo.com/kb/finance/download-historical-data-yahoo-finance-sln2311.html
- https://help.yahoo.com/kb/finance-for-web/SLN2310.html

## Conflict policy

Official regulatory filings outrank third-party aggregations. Facts from incompatible GAAP/non-GAAP definitions are not merged. Currency changes, fiscal-year changes, 52/53-week periods, acquisitions, spin-offs, ticker changes and stock splits must remain explicit metadata or warnings. Missing values are not interpolated.
