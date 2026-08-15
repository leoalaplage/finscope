# Known limitations

- SEC standardized XBRL history generally begins in 2009. Pre-XBRL history requires a filing-document parser and company-specific validation.
- The live registry currently includes NVDA, AAPL, GOOGL, MSFT, META, V, MA, ANET, BKNG, NOW, SPGI, ABNB, CME, PAYX, IBKR, MSCI, VEEV, ZTS, CBOE, CPRT and FDS. Adding a company requires a profile/CIK registry entry; the provider adapters are reusable.
- Some gaps are in the filings themselves and are reported rather than filled. Visa publishes no diluted share count recoverable from companyfacts, so its per-share series are unavailable. NVIDIA and Airbnb omit capital expenditures for some years, which removes free cash flow for those years only. Pre-IPO years computed under the two-class method fail the net income ÷ diluted EPS identity, so a share count is not recovered for them.
- Quarterly normalization depends on standardized SEC concepts. Unsupported company extensions stay unavailable; cumulative facts are differenced only when their fiscal starts and durations are compatible.
- TTM requires four consecutive reliable quarters totaling 330–380 days. A gap, overlap or missing metric produces no TTM value for that metric.
- Yahoo Finance pricing uses an unofficial public interface and can be rate-limited. FinScope fails closed and never replaces an unavailable historical price with the current quote.
- SEC focal-period share counts are normalized with the registry's effective split events; Yahoo adjusted close is split-adjusted. New companies need validated split metadata before long-range per-share comparisons are considered complete.
- Basic weighted-average shares, point-in-time shares outstanding and issuance proceeds may be missing when a filer does not use a supported standardized concept.
- Announced repurchase authorizations are narrative disclosures and require a filing-section parser. FinScope currently keeps reported repurchase cash flows separate from effective share-count changes.
- No forward-looking data of any kind. Next-twelve-month multiples, price targets, PEG and forward growth are analyst consensus estimates; FinScope reads filings and prices and has no estimates provider.
- Return on tangible assets is unavailable for filers that tag neither goodwill nor acquired intangibles, and interest coverage for those tagging no interest expense. Apple stopped tagging goodwill in 2017 and interest expense after 2023.
- Employee counts are not in the SEC companyfacts endpoint, so headcount statistics are absent.
- Non-GAAP metrics are intentionally excluded until a source-specific taxonomy and reconciliation model is implemented.
- Favorites and recent companies are device-session UI state in this build; there is no cloud persistence or account database.
- CSV, SVG, PNG and clipboard-table exports are implemented. Raster export uses the rendered chart and follows the active series configuration.
- A company outside the watchlist is normalized on demand and is not covered by the daily warm-up, so its first load takes a couple of seconds and can still be refused when the Worker is busy. Loading it again succeeds.
- Provider availability and SEC taxonomy changes can create gaps. Errors are shown and the verified offline fixture remains available.
