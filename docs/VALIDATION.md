# Validation report

Validation date: 2026-08-13.

## Automated checks

- 11 financial unit tests passed: free cash flow under both capex sign conventions, margins, per-share values, dilution, annualized dilution, CAGR, TTM completeness, unit conversion, split adjustment, missing periods, lineage and price-matched valuation.
- Strict TypeScript compilation passed.
- Production Vinext/Cloudflare Worker build passed with the application route and dynamic company API route.
- Server-render integration test verifies product metadata, Apple content, financial workspace content and removal of all starter-preview markers.

## Browser checks

- Desktop dashboard rendered at 1440 × 900.
- Mobile layout rendered at 390 × 844 with the sidebar collapsed and an accessible open-menu control.
- Navigation opened the Income Statement view.
- Clicking a reported 2025 revenue value opened its provenance drawer with exact period, currency, SEC concept, filing date, retrieval date, accession and filing link.
- Live Microsoft retrieval returned 17 normalized annual periods through FY 2026 from the SEC endpoint after validating nullable SEC context fields.
- No browser console errors were observed in the checked flows.

## Demonstration profiles

The live registry contains Apple, Microsoft, Amazon, NVIDIA and Tesla, providing profitable, cash-intensive, high-growth and share-count-change profiles. The offline Apple demonstration spans FY 2009–2025. Because the current build refuses to fabricate unavailable prices and concepts, remaining company-specific gaps are visible rather than backfilled.

## Observed provider issue

Yahoo's unofficial chart endpoint returned HTTP 429 during validation. The valuation page therefore displays an explicit unavailable state. This is the intended fail-closed behavior and is documented in `docs/LIMITATIONS.md`.
