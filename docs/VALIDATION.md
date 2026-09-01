# Validation report

Validation date: 2026-09-01.

## Acceptance checks

- 634 automated tests pass and 2 are explicitly skipped. They cover direct and cumulative quarters, Q4 derivation, day-weighted shares, restatements, shifted fiscal years, 52/53-week years, fiscal-label errors, concept migrations, missing/overlapping quarters, fiscal-year changes, TTM completeness, stock splits, historical-session matching, transient-gateway recovery, Statistics frequency selection, date-based CAGR and non-meaningful endpoints.
- ESLint passes with no warning or error.
- Strict TypeScript compilation passes.
- The production Vinext/Cloudflare Worker build passes for `/`, `/api/company/:ticker` and `/api/price/:ticker`.
- `git diff --check` passes after final formatting cleanup.

## Arbitrary-ticker coverage sweep

The normalizer was also run from raw SEC Company Facts over a deterministic sample of 110 registry tickers, not only the built-in watchlist. Of the 91 companies for which annual periods could be normalized:

| Annual series | Companies with an internal gap | Result |
|---|---:|---:|
| Revenue | 1 | 90/91 continuous |
| Net income | 0 | 91/91 continuous |
| Free cash flow | 2 | 89/91 continuous |

For the 86 usable U.S.-GAAP datasets in the sample, annual metric availability was 97% for revenue, 100% for net income, 98% for weighted-average shares, 99% for cash and 99% for equity. Free cash flow is lower because banks and insurers do not have an economically comparable industrial FCF, while some industrial filers do not publish a supported capital-expenditure fact.

Quarterly TTM remains stricter: one unavailable source quarter removes four rolling observations. The Overview therefore uses exact filed annuals for 10Y and Max, and uses 4Y TTM only when every displayed metric is continuous. Quarterly and TTM detail remains available in Charts with the gap left explicit.

## Live filing profiles

All values below were retrieved through the SEC Company Facts adapter and retain their filing accession.

| Profile | Verification | Result |
|---|---|---|
| AAPL · weekend fiscal end / buybacks | FY2025 ended Saturday 2025-09-27; revenue $416.161B, OCF $111.482B, capex $12.715B, repurchases $90.711B; accession `0000320193-25-000079` | Exact fiscal date preserved. Yahoo selected adjusted close $254.5198 on Friday 2025-09-26 and marked `previous trading session` at distance one day. |
| MSFT · shifted fiscal year / high FCF | FY2026 ended 2026-06-30; revenue $331.839B and OCF $182.935B; accession `0001193125-26-323660` | June fiscal calendar and quarterly windows remain independent of calendar-year assumptions. |
| NVDA · shifted fiscal year / 53-week sensitivity | FY2026 ended 2026-01-25; revenue $215.938B, OCF $102.718B; accession `0001045810-26-000021` | Sunday fiscal end, split-adjusted shares and non-calendar quarter labels preserved. |
| TSLA · irregular FCF | FY2025 ended 2025-12-31; revenue $94.827B, OCF $14.747B and capex $8.527B; accession `0001628280-26-003952` | Negative/volatile cash-flow inputs stay visible and are not smoothed. |
| PLTR · dilution and SBC | FY2025 ended 2025-12-31; revenue $4.475B, diluted shares 2.565B and SBC $684.033M; accession `0001321655-26-000011` | Dilution, SBC/revenue and SBC/FCF remain separate from repurchase cash flows. |
| AMZN · large operating scale | 17 annual, 69 quarterly and 66 TTM periods normalized in the current Company Facts history | Long-range tables and rolling windows remain responsive. |

For AAPL, the latest quarterly sequence was checked directly: Q1 FY2025 OCF $29.935B reported; Q2 $23.952B, Q3 $27.867B and Q4 $29.728B calculated from compatible cumulative facts. Every calculated value exposes its formula and source accessions. The adapter produced 69 quarterly periods and 66 valid TTM windows through Q3 FY2026.

## Browser checks

- Desktop at 1440 × 900 and mobile at 390 × 844 render without horizontal page overflow; mobile sidebar starts closed and reopens from the menu control.
- Annual, Quarterly and TTM controls change both period counts and values. AAPL Quarterly and TTM each showed 12 requested visible periods through 2026-06-27.
- Units, growth mode, chart window, interactive legend, series type, axis assignment and visibility controls were exercised.
- Growth & CAGR contains 3/5/10/15/20/max comparisons plus custom start/end dates. AAPL FCF/share was 20.02% for 2009-09-26 → 2025-09-27 and 9.47% for 2020-09-26 → 2025-09-27 after split normalization.
- The capital-allocation chart exposes diluted shares, shares outstanding, buybacks, SBC and issuance proceeds together.
- Search loaded PLTR live; its FY2025 revenue provenance drawer showed the exact concept, period, filing date and accession.
- Yahoo valuation showed fiscal date 2025-09-27, price date 2025-09-26, adjusted-close type, AAPL ticker, USD currency and previous-session fallback.
- No browser console warning or error appeared in the checked flows.

## Bugs corrected in this iteration

1. Quarterly and TTM controls previously reused annual data; they now use real direct/isolated quarters and validated four-quarter windows.
2. Cash-flow YTD facts were not isolated; Q2/Q3/Q4 now use compatible cumulative subtraction with explicit provenance.
3. Charts divided values by one billion regardless of selected units; every series and axis now respects Units/K/M/B.
4. Series controls, dual axes, log scale and exports were decorative or absent; they are now functional.
5. Historical valuation did not call Yahoo; it now uses a bounded trading-session fallback and fails closed.
6. Shares, SBC, issuance and net-repurchase concepts were incomplete; they now have dedicated metrics and a comparative chart.
7. CAGR used nominal horizons and did not explain invalid endpoints; it now uses actual dates and returns an N/M reason.
8. Long-range per-share history mixed pre- and post-split share counts. Validated split events now adjust historical share facts while retaining the original SEC source and calculation factor.
9. SEC concept fallback priority and same-filing comparative selection could choose a lower-priority or older-period context. Both ordering rules are deterministic now.
10. A modal fiscal-end month/day incorrectly reassigned facts for 52/53-week filers. Facts are now attached to the actual filed annual window that contains them.
11. Point-in-time balances carrying an inconsistent `fy` or `fp` were missed. Instant facts are now joined by their exact balance-sheet date.
12. A later annual-only concept migration could erase exact quarters originally filed under the prior concept. The original basis is retained only when dates, unit, currency and quarterly contexts establish the identity; lineage explains the choice and no value is estimated.
13. A smaller later-tagged revenue segment could replace the company's top line. Positive full-period candidates are selected first and `Revenues` is promoted only when it is the larger reported total.
14. A single absent quarter produced four conspicuous holes in every long Overview card. Long ranges now display annual filings, while 4Y uses TTM only for a continuous company-wide chain.
15. A transient 502/503/504 forced the reader to repeat an identical safe read manually. GET requests now retry once after 500 ms, while mutating requests and Cloudflare CPU suspension `1102` responses are never repeated.
16. Statistics inherited the Overview's annual continuity policy and fixed the page's company as an irremovable first column. Statistics now defaults to a current TTM where every selected company has one, offers an explicit Annual/TTM choice, and treats the first company as the same removable toggle as its peers.
17. Valuation stated only P/FCF in a table. It now adds a current FCF-yield and FCF/share snapshot, five-year FCF-yield statistics, and an Annual/TTM FCF-per-share chart.

## Remaining limitations

- Yahoo's public interface is unofficial and may rate-limit; unavailable history remains unavailable rather than being replaced.
- Company extensions and non-GAAP metrics are not inferred from narrative disclosures.
- Split metadata must be validated when a new registry company is added.
- Point-in-time issued or treasury shares can be absent when a filer does not publish a supported standardized concept.
- Foreign private issuers reporting only under IFRS need a separate `ifrs-full` adapter; they fail with an explicit limitation instead of returning a partly mapped dataset.
- A ticker can point to a newly created successor CIK whose Company Facts contain no predecessor history. Exxon Mobil's current registry mapping is such a case in this sample; joining predecessor and successor entities requires a separately validated corporate-lineage registry.
- This validation is a research-data consistency check, not an audit opinion or investment recommendation.
