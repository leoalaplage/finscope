# Sources and lineage

## SEC EDGAR

The U.S. SEC is the primary provider for U.S. GAAP fundamentals. FinScope calls `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` server-side, validates the response, selects 10-K annual contexts with a 300–400 day duration, and uses concept fallbacks in declared priority order. Direct 55–125 day quarters are preferred. Compatible six- and nine-month cumulative facts are differenced, Q4 is annual minus Q3 year-to-date, and weighted shares use a day-weighted isolation formula.

Each fact retains provider, source URL, accession number, filing date, retrieval time, fiscal year, period end, periodicity, currency, unit, XBRL concept and status. Duplicate contexts are ordered by filing date and period end. The most recently filed compatible context is selected, allowing restatements to supersede older presentations without losing lineage. TTM flow values sum four consecutive quarters; weighted shares are day-weighted and point facts come from the latest quarter.

The company endpoint is cached at the edge for one hour with a 24-hour stale-while-revalidate window. The normalized KV dataset is a separate seven-day safety copy refreshed once it is twenty hours old; the shorter edge window prevents an older edge response from hiding a freshly rebuilt KV value for most of a day. Automated use identifies itself through `SEC_USER_AGENT` and must follow the SEC fair-access policy.

Scheduled triggers run at 01:00, 07:00, 13:00 and 19:00 UTC. Each run rebuilds at most six missing or aged companies, sequentially and through the Worker's `SELF` service binding, so every company build receives its own request budget without producing the burst that previously throttled the Worker. Four runs cover twenty-four companies per day. Reading a watchlist also warms up to three missing companies and refreshes one aged company in the background; this is what keeps companies added by a reader current even though the cron does not know their browser watchlist.

Normalized datasets are cached in a Cloudflare KV namespace bound as `DATASET_CACHE`, currently under `company:v18:<ticker>`; card-sized digests use `summary:v18.s6:<ticker>`. The version is bumped whenever normalization changes meaning — a new concept fallback, a corrected split direction, a new quarter rule or a different debt aggregation — so a cached dataset is never read under semantics it was not built with. A previous version is served during rebuilding only when it is explicitly listed as semantically safe. v18 has no such fallback because v17 withholds Adobe's ROIC instead of recognizing its explicitly filed current-debt zero. The bump history and fallback allowlist live together in `lib/dataset-cache.ts`, so the route and warm-up cannot disagree. This cache is load-bearing rather than an optimization: normalizing a company from raw XBRL on every request exceeds the Worker CPU limit.

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
