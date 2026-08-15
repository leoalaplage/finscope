# Financial formulas

Every formula is implemented in `lib/finance.ts` and named in the `FORMULAS` map, so the string a reader sees in the provenance drawer is the same one the code evaluates. A missing or invalid input returns `null` and displays as unavailable — never as zero, and never as an estimate.

## Margins and cash flow

| Metric | Formula | Rule |
|---|---|---|
| Gross margin | Gross profit / Revenue | Same normalized period and currency. |
| Operating margin | Operating income / Revenue | GAAP operating income only. |
| Net margin | Net income / Revenue | GAAP net income attributable to the filing entity where available. |
| OCF margin | Operating cash flow / Revenue | Same annual or quarterly period. |
| Free cash flow | Operating cash flow − abs(Capital expenditures) | Accepts positive-outflow and negative-outflow capex conventions. |
| FCF margin | Free cash flow / Revenue | Calculated only when OCF, capex and revenue exist. |
| **FCF after SBC** | Operating cash flow − abs(Capex) − Stock-based compensation | Treats share-based pay as the cash cost it economically is. Requires the filer to tag SBC. |
| **FCF after SBC margin** | FCF after SBC / Revenue | |
| **Capital intensity** | abs(Capital expenditures) / Revenue | |
| Cash conversion | Free cash flow / Net income | |

## Returns on capital

| Metric | Formula | Rule |
|---|---|---|
| **EBITDA** | Operating income + Depreciation and amortization | Built up from operating income rather than down from net income, so it never picks up financing or one-off items. |
| **Invested capital** | Total debt + Total equity − Cash and equivalents | The *financing* view. The operating build-up would need fixed assets and intangibles that several filers omit; equity and debt are carried reliably. |
| **NOPAT** | Operating income × (1 − Effective tax rate) | Effective rate from income tax expense over pre-tax income. |
| **ROIC** | NOPAT / Invested capital | |
| **Incremental ROIC** | Δ NOPAT over the window / Δ Invested capital over the window | What the *marginal* capital earned, which is what a compounder is judged on. |
| **ROE** | Net income / Total equity | |
| **ROA** | Net income / Total assets | |
| **ROTA** | Net income / (Total assets − Goodwill − Acquired intangibles) | Unavailable when the filer tags neither goodwill nor intangibles: that is not a statement that it owns none, and reporting total assets under a tangible label would publish ROA twice under two names. Apple stopped tagging goodwill in 2017. |
| **ROCE** | Operating income / (Total assets − Current liabilities) | |
| **Interest coverage** | Operating income / Interest expense | From interest expense alone, never a net figure — a net number offsets interest earned, and coverage asks what the debt costs. Apple stopped tagging it after 2023. |

Returns are stated on the period-end balance rather than an average of opening and closing balances. The average is marginally better for a year of heavy issuance, but it needs a prior balance sheet, and mixing the two conventions across companies would be worse than either. The statistics panel averages each ratio over five reported years, because one year's return moves with a single impairment or tax settlement.

## Per share

| Metric | Formula | Rule |
|---|---|---|
| Per-share metrics | Metric / Diluted weighted average shares | Uses the matching period's diluted weighted-average shares. |
| **FCF per share** | (Operating cash flow − abs(Capex)) / Diluted weighted average shares | |
| **FCF after SBC per share** | (Operating cash flow − abs(Capex) − SBC) / Diluted weighted average shares | Unavailable where the filer publishes no recoverable share count — Visa is the case in this watchlist. |
| Dilution rate | Current diluted shares / Previous diluted shares − 1 | Cash buybacks are not inferred from this change. |
| Annualized dilution | (Current shares / Prior shares)^(1 / years) − 1 | Requires positive endpoints. |

## Growth and consistency

| Metric | Formula | Rule |
|---|---|---|
| CAGR | (Ending value / Beginning value)^(1 / years) − 1 | Requires positive endpoints and a positive duration. A 5Y or 10Y request accepts an endpoint within half a year of the target; otherwise the maximum-available CAGR is reported instead, with its true span. |
| **Growth consistency (R²)** | R² of a least-squares fit of ln(value) against time | 1.00 is a perfectly steady compounding rate; a low value means the average hides a lumpy path. Needs at least three years, all strictly positive — a zero or negative year leaves the log fit undefined. |
| **Growth gap** | FCF CAGR − Revenue CAGR, in percentage points | Positive means cash flow is compounding faster than sales. |
| **Rule of 40** | Latest-year revenue growth + FCF margin | |
| **Worst drawdown** | Largest peak-to-trough decline across the reported years | Free cash flow by default. Needs at least three years. |

## Valuation

| Metric | Formula | Rule |
|---|---|---|
| Market capitalization | Matched stock close × diluted shares | Price date and fiscal end must match by the price-selection rule. |
| P/S, P/E, P/OCF, P/FCF | Market capitalization / matching flow | Never combines current price with historical flow data. |
| FCF yield | Free cash flow / Market capitalization | Same matched price period. |
| Buyback yield | Gross repurchase cash flow / Market capitalization | Separate from effective share-count change. |

## Period construction

| Rule | Detail |
|---|---|
| Isolated quarter | Current compatible YTD fact − prior compatible YTD fact. **Both facts must carry the same XBRL concept**: a filer that changes revenue tag mid-year would otherwise produce a subtraction across two different definitions, which put Mastercard's Q4 revenue at −1,889M. |
| Q4 | Annual − Q3 YTD, or a directly tagged Q4 fact when its period closes the fiscal year. Refusing direct Q4 facts on principle left S&P Global's Q4 negative. |
| Isolated weighted shares | (Current YTD average × current days − prior YTD average × prior days) / isolated days. Requires a 55–125 day isolated period. |
| TTM flow | Sum of four consecutive complete quarters. Missing, overlapping or implausibly spaced quarters make TTM unavailable. |
| TTM weighted shares | Day-weighted mean of four quarterly weighted averages. Point-in-time share facts use the latest quarter instead. |
| Balance-sheet facts | Point-in-time values. Never summed for TTM. |
| Restatements | A restated fact takes priority for the same period and concept; its filing date and accession stay attached. |
| Plausibility guard | A derived value that cannot exist — a negative weighted share count, a negative revenue — is dropped rather than published. Veeva's quarter arithmetic produced −115M weighted shares before this. |

## Split adjustment

Facts filed **before** a split are restated onto today's share basis; facts from later filings are already restated and are left alone, which is why every recovered fact must carry its own filing date.

- Share counts are **multiplied** by the split ratio.
- Per-share amounts — reported diluted EPS and dividends per share — are **divided** by it. Applying the share-count direction to a per-share figure inflates it by the ratio.

Splits are declared per company in `lib/company-registry.ts`. A missing entry shows as a step in the share count: CME's 2012 five-for-one split was absent and produced a ×5 jump.

## Concept selection

The SEC lets a filer tag the same economic fact several ways. Preference order is therefore part of the formula, not an implementation detail.

| Metric | Concepts, in order | Why the order |
|---|---|---|
| Net income | `NetIncomeLoss`, `NetIncomeLossAvailableToCommonStockholdersBasic`, `ProfitLoss` | `ProfitLoss` is consolidated income *including* non-controlling interests. Interactive Brokers tags no `NetIncomeLoss` at all — the public company owns a small slice of the group — so falling straight through to `ProfitLoss` overstated its earnings by 4.5×. |
| Capital expenditures | `PaymentsToAcquirePropertyPlantAndEquipment`, `PaymentsToAcquireProductiveAssets`, `PaymentsForProceedsFromProductiveAssets`, `PaymentsForSoftware` | Software-first filers capitalize development rather than property. Without the fallbacks IBKR had no capex at all, Veeva stopped in 2020 and Cboe covered 12 years instead of 17. |
| Total debt | `LongTermDebtAndFinanceLeaseObligationsCurrentAndNoncurrent`, else **current portion + non-current portion, summed** | The current and non-current portions are two halves of one balance, not alternatives. Choosing between them reported Apple's borrowings as 12.4bn instead of 90.7bn, which turned its net debt into net cash and its ROIC into 247%. |
| Diluted shares | `WeightedAverageNumberOfDilutedSharesOutstanding`, `WeightedAverageNumberOfShareOutstandingBasicAndDiluted`, then **Net income / Diluted EPS** | The recovery is a last resort for filers that tag a share count per class and never in total. It is marked `Calculated` with the concept `DilutedSharesFromEps` and carries the EPS fact's filing date. |

**Only undimensioned facts are carried.** A multi-class filer reports each concept once per class and once in total; taking a dimensioned value would report one class as if it were the whole company.

## Where the identity does not hold

The recovered share count assumes net income ÷ diluted EPS. That identity fails for pre-IPO years computed under the two-class method, where income attributable to common shareholders differs from consolidated net income. Those years are reported as unavailable rather than approximated.
