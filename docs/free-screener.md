# Custom fundamental screener

Available in FinScope Terminal at `/t/screener`, alongside the existing Quality Score view.

Searches combine fundamental, valuation, consensus and daily technical criteria with AND or OR. Numeric limits use the units displayed in the editor: percentage points, ratios or billions. Field comparisons require matching units; crossovers require current and previous technical values. Missing values never count as zero. Invalid criteria stop the search until corrected.

The initial universe is the existing S&P 500 membership, optionally intersected with the current watchlist. Sectors, company search, selected column order and sorting are saved with each search. Up to 50 searches persist in the browser under `finscope.free-screener.v1`; without account synchronization. Blocked browser storage falls back to the current tab and displays a warning.

`GET /api/screener` joins three prepared snapshots by ticker: the served fundamental universe, daily technical table and compact consensus table. It does not make per-company provider requests. The existing estimates cron updates consensus during its normal rotation, so coverage grows over the first full rotation after deployment. Quotes and technical builds older than seven days, and consensus older than three days, are withheld. Coverage and unavailable criteria are visible in the interface.

Valuation requires a known matching quote/filing currency. Nasdaq EPS and target prices require a USD quote. Forward P/E is unavailable for non-positive EPS; PEG requires positive growth. Each cell exposes its source, date and relevant EPS/share basis. Exports include these dates and bases.

Verification: `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`. Focused tests cover filter semantics, missing values, units, persistence validation, snapshot freshness, currencies, loss-making companies, consensus preservation and the bounded API read path.
