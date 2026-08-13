# Known limitations

- SEC standardized XBRL history generally begins in 2009. Pre-XBRL history requires a filing-document parser and company-specific validation.
- The live registry currently includes AAPL, MSFT, AMZN, NVDA, TSLA and PLTR. Adding a company requires a profile/CIK registry entry; the provider adapters are reusable.
- Quarterly normalization depends on standardized SEC concepts. Unsupported company extensions stay unavailable; cumulative facts are differenced only when their fiscal starts and durations are compatible.
- TTM requires four consecutive reliable quarters totaling 330–380 days. A gap, overlap or missing metric produces no TTM value for that metric.
- Yahoo Finance pricing uses an unofficial public interface and can be rate-limited. FinScope fails closed and never replaces an unavailable historical price with the current quote.
- SEC focal-period share counts are normalized with the registry's effective split events; Yahoo adjusted close is split-adjusted. New companies need validated split metadata before long-range per-share comparisons are considered complete.
- Basic weighted-average shares, point-in-time shares outstanding and issuance proceeds may be missing when a filer does not use a supported standardized concept.
- Announced repurchase authorizations are narrative disclosures and require a filing-section parser. FinScope currently keeps reported repurchase cash flows separate from effective share-count changes.
- Non-GAAP metrics are intentionally excluded until a source-specific taxonomy and reconciliation model is implemented.
- Favorites and recent companies are device-session UI state in this build; there is no cloud persistence or account database.
- CSV, SVG, PNG and clipboard-table exports are implemented. Raster export uses the rendered chart and follows the active series configuration.
- Provider availability and SEC taxonomy changes can create gaps. Errors are shown and the verified offline fixture remains available.
