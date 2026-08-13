# Known limitations

- SEC standardized XBRL history generally begins in 2009. Pre-XBRL history requires a filing-document parser and company-specific validation.
- The live registry currently includes AAPL, MSFT, AMZN, NVDA and TSLA. Adding a company requires a profile/CIK registry entry; the provider adapter itself is reusable.
- Annual SEC normalization is implemented. The UI exposes Quarterly and TTM controls, but they display only when normalized quarter facts exist; a complete Q4 derivation and quarterly context resolver remain future work.
- Yahoo Finance pricing is isolated but not enabled in the deployed research view because its unofficial endpoint was rate-limited during validation. No price or valuation is invented.
- Historical stock splits can create discontinuities in raw weighted-average-share series. A split utility is tested, but automated event ingestion is not yet connected.
- Basic weighted-average shares, point-in-time shares outstanding and issuance proceeds may be missing when a filer does not use a supported standardized concept.
- Announced repurchase authorizations are narrative disclosures and require a filing-section parser. FinScope currently keeps reported repurchase cash flows separate from effective share-count changes.
- Non-GAAP metrics are intentionally excluded until a source-specific taxonomy and reconciliation model is implemented.
- Favorites and recent companies are device-session UI state in this build; there is no cloud persistence or account database.
- CSV export is implemented. Chart SVG/PNG export and clipboard-table copy are planned extensions.
- Provider availability and SEC taxonomy changes can create gaps. Errors are shown and the verified offline fixture remains available.
