# Financial formulas

Every formula is implemented in `lib/finance.ts` and named in the `FORMULAS` map, so the string a reader sees in the provenance drawer is the same one the code evaluates. A missing or invalid input returns `null` and displays as unavailable — never as zero, and never as an estimate.

**Fail closed.** A figure that needs a balance, a share count or a price is withheld the moment one of them is missing or incompatible, and the screen says which. An absent fact is unknown, not zero: reading an untagged debt concept as no debt put JPMorgan at 343bn of net *cash* and, by understating the capital base, once put Apple's return on invested capital at 247%. Only a filed zero is zero. The one place an assumption is still applied is NOPAT's tax rate, and it is labelled as one wherever it appears.

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
| **Invested capital** | Total debt + Total equity − Cash and equivalents | The *financing* view; the operating build-up would need fixed assets and intangibles that several filers omit. **All three balances are required.** A filer whose borrowings this adapter does not read — a bank, a broker, or a company with genuinely none — has no invested capital and therefore no ROIC and no cash return on capital, rather than a return flattered by a capital base missing its debt. |
| **NOPAT** | Operating income × (1 − Effective tax rate) | Effective rate from income tax expense over pre-tax income. Where that rate is missing, negative or above 60% — a loss-making year, or one settled at an unusual rate — the statutory 21% stands in, and the rows built on it carry "assumed 21%" in their stated formula. It is the only assumption in this document. |
| **ROIC** | NOPAT / Invested capital | |
| **Cash RoC** | Free cash flow / Invested capital | The same question as ROIC asked of cash. NOPAT applies an effective tax rate and falls back to an assumed 21% when the reported one is unusable, so ROIC always carries one assumption; free cash flow carries none. Reported current *and* against its own five-year average, because a return below its own recent mean is the first thing to notice about a compounder. |
| **Incremental ROIC** | Δ NOPAT over the window / Δ Invested capital over the window | What the *marginal* capital earned, which is what a compounder is judged on. |
| **ROE** | Net income / Total equity | Requires equity above zero. A company that has bought back more stock than it has retained earnings is financed below zero, and a return on a negative base describes nothing: Booking's −96.9% ROE and −3.36× debt-to-equity were arithmetic, not facts about the business. Debt/equity and price-to-book follow the same rule. |
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

## Balance sheet

| Metric | Formula | Rule |
|---|---|---|
| Current ratio | Current assets / Current liabilities | |
| Quick ratio | (Cash + Short-term investments + Receivables) / Current liabilities | Inventory excluded. |
| Net debt / EBITDA | Net debt / EBITDA | Negative means net cash. |
| Net debt / FCF | Net debt / Free cash flow | The same question asked of cash. |
| Goodwill & intangibles / assets | (Goodwill + Acquired intangibles) / Total assets | How much of the balance sheet is the price of past acquisitions. |
| Equity / assets | Total equity / Total assets | |

## Statement diagrams

The income statement, the cash flow and the balance sheet are drawn as flows from the **last complete fiscal year**, never from a trailing window: a diagram of TTM figures mixes four filings and cannot be checked against any one of them.

Inside every column, money coming in is drawn above money going out — profit along the top, each cost peeling off underneath — and a node nothing feeds is placed immediately before what it feeds rather than in the first column. Ribbons are stacked in the order of the nodes at their far end, so they never cross.

| Diagram | Stages |
|---|---|
| Income statement | Revenue → cost of sales and gross profit → operating costs and operating income → tax and net income |
| **Cash flow** | Net income + non-cash charges → operating cash flow → capex and **free cash flow** → dividends, buybacks and what was kept |
| Balance sheet | Assets → total assets → liabilities, equity and any minority claim |

Free cash flow in the diagram is the same figure the rest of the application computes, so capex is drawn as operating cash flow less it. The bridge from profit to cash names depreciation and share-based pay **only while they fit inside it**: when they add to more than the gap, working capital consumed the difference, and splitting them would need an outflow the filing does not itemise, so the bridge is drawn as one line and the reason is stated.

Every ribbon is a filed figure or a subtraction from one. Where a filing does not fit the standard shape the diagram says so beneath itself rather than closing the gap quietly:

- **No tagged operating income.** Zoetis and Interactive Brokers publish none. Pre-tax income is recovered as net income plus tax, and the remaining operating costs become the balancing item.
- **Non-operating items.** Solved for, as net income plus tax less the profit above it. A net gain enters as its own source rather than being netted against a cost; a net cost is drawn as one.
- **Minority interests.** Assets equal liabilities plus equity, but the mapped equity is the parent's share. A group with minority partners leaves a third claim on the same assets — 8% of S&P Global's balance sheet and 7% of Interactive Brokers'. It is drawn as its own slice.
- **A breakdown exceeding its total.** Scaled to fit and flagged, never drawn as a negative ribbon.
- **A retained-earnings deficit.** Equity is left unsplit and the deficit is stated. Apple has distributed more than it has ever earned.
- **Returns exceeding the year's free cash flow.** Drawn to the cash the year produced and reported at full size, with the multiple stated — Zoetis returned 1.81× its free cash flow, Apple 1.07×, out of cash already held or borrowed.
- **No tagged capital expenditure.** The diagram stops at operating cash flow rather than inventing a split. Airbnb's recent filings itemise no property purchases at all, only "other investing activities", so it has no free cash flow to draw.
- **Profit that did not become cash.** When net income exceeds operating cash flow the difference is drawn as an outflow from profit, not netted away.

## Valuation

Every priced figure is built by one function, `marketBasis` in `lib/market-basis.ts`, so the company header, the statistics panel, the ranking table, the screener and the valuation history cannot disagree about what a market capitalisation is.

| Metric | Formula | Rule |
|---|---|---|
| Market capitalization | Matched stock close × period-end shares outstanding | Price date and fiscal end must match by the price-selection rule. **The price must be quoted in the currency the statements are filed in**; nothing is converted, so for a filer reporting in another currency the market capitalisation and every multiple built on it are withheld with that reason stated. Where the filer publishes no period-end count — a multi-class filer tags each class separately and only undimensioned facts reach us — the diluted weighted average stands in and the substitution is stated on the figure, never silent. |
| Enterprise value | Market capitalization + Net debt | Requires **both** a debt and a cash balance. Without one there is no enterprise value and no EV multiple, rather than an EV computed against an assumed zero. |
| P/S, P/E, P/OCF, P/FCF | Market capitalization / matching flow | Never combines current price with historical flow data. A multiple needs a positive denominator everywhere it is shown: a price over a loss is not a cheap company, and the same rule now governs Latest figures, Statistics, Charts and the valuation history alike. |
| **Reverse DCF entry price** | FCF/share × (1 + g)^n ÷ exit yield ÷ (1 + desired return)^n | Four assumptions, no cost of capital: the desired return *is* the discount rate. The exit yield and its reciprocal multiple are the same assumption. |
| FCF yield | Free cash flow / Market capitalization | Same matched price period. |
| Buyback yield | Gross repurchase cash flow / Market capitalization | Separate from effective share-count change. |

## Period construction

| Rule | Detail |
|---|---|
| Isolated quarter | Current compatible YTD fact − prior compatible YTD fact. **Both facts must carry the same XBRL concept**: a filer that changes revenue tag mid-year would otherwise produce a subtraction across two different definitions, which put Mastercard's Q4 revenue at −1,889M. |
| Which concept a year's quarters use | One concept for all four, chosen once per metric and year: the year's own, or another **proved to be the same measure** by its annual figure matching the published one to within a tenth of a percent. Adopting the revenue standard in 2018 made filers restate a year under a new concept while its quarters kept the old one; insisting on the year's concept lost about five quarters from seventeen of the twenty-one companies here, and two whole years from Apple. Where the restatement genuinely moved the year, the old quarters are not the new year's and the gap is left rather than published as a year that does not add up. |
| Q4 | Annual − Q3 YTD, or a directly tagged Q4 fact when its period closes the fiscal year. Refusing direct Q4 facts on principle left S&P Global's Q4 negative. |
| Isolated weighted shares | (Current YTD average × current days − prior YTD average × prior days) / isolated days. Requires a 55–125 day isolated period. |
| TTM flow | Sum of four consecutive complete quarters. Missing, overlapping or implausibly spaced quarters make TTM unavailable. |
| TTM weighted shares | Day-weighted mean of four quarterly weighted averages. Point-in-time share facts use the latest quarter instead. |
| Balance-sheet facts | Point-in-time values. Never summed for TTM. |
| Restatements | A restated fact takes priority for the same period and concept; its filing date and accession stay attached. |
| A year restated without its quarters | Some filers restated a year in place and never refiled its quarters, so the four do not add to it — Veeva's 2017 net income is 77.6M against quarters summing 68.8M, NVIDIA's 2017 operating cash flow 1,672M against 1,441M. The filed figures are published as filed; nothing is scaled to close the gap. |
| Dividend per share tagged as a rate | Most filers tag it cumulatively, so the annual context is the year's total and differencing recovers each quarter. Visa, NVIDIA and Interactive Brokers tag the *quarterly rate* against every context — 0.59 for the quarter, 0.59 for the year — which makes the fourth quarter come out as zero or negative and the year read as one payment. Where four quarters exist and the annual tag equals the largest of them rather than their sum, the year is rebuilt as the sum of its quarters. Detection is per year and never removes a reported figure: MSCI's first dividend year looks like a rate, and one ambiguous year must not condemn a decade. |
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
| Revenue | `RevenueFromContractWithCustomerExcludingAssessedTax`, `...IncludingAssessedTax`, `Revenues`, `SalesRevenueNet` — **except that a strictly larger `Revenues` for the same period wins** | `Revenues` is the income-statement line; the contract concepts are revenue recognised under ASC 606, which for most filers is the same number and for some is a component of it. Berkshire Hathaway tags 247.2bn of contract revenue and 371.4bn of total revenues for 2025 — the 124.2bn difference being insurance premiums earned and investment income — and the smaller figure was published as "Revenue". A total cannot be smaller than a component of itself, so the promotion is one-directional: where `Revenues` is the *lower* tag it is describing something narrower under that name and the chosen concept stands. The reconciliation, both figures and their difference, travels in the fact's provenance. |
| Shares outstanding | `us-gaap:CommonStockSharesOutstanding`, then `dei:EntityCommonStockSharesOutstanding` | The first is the balance-sheet parenthetical, dated at the period end. The second is the cover page, dated when the report was filed — Apple's is 17 October against a 27 September year end — so it is discarded by the period-end anchoring and cannot be the primary source. Reading only the cover page left six of seven audited companies with no share count at all. |
| Total debt | `LongTermDebtAndFinanceLeaseObligationsCurrentAndNoncurrent`, else **current portion + non-current portion, summed** | The current and non-current portions are two halves of one balance, not alternatives. Choosing between them reported Apple's borrowings as 12.4bn instead of 90.7bn, which turned its net debt into net cash and its ROIC into 247%. |
| Diluted shares | `WeightedAverageNumberOfDilutedSharesOutstanding`, `WeightedAverageNumberOfShareOutstandingBasicAndDiluted`, then **Net income / Diluted EPS**, then **Dividends paid / Dividends per share** | Two recoveries, in that order, for filers that tag a share count per class and never in total. The earnings recovery is exact by definition and wins. The dividend recovery is the last resort for Visa, which tags no combined share count *and* no diluted EPS — every per-share metric for it was unavailable. It lands within a third of a percent of the count Visa states in its own filings. |

**Only undimensioned facts are carried.** A multi-class filer reports each concept once per class and once in total; taking a dimensioned value would report one class as if it were the whole company.

## Where the identity does not hold

The recovered share count assumes net income ÷ diluted EPS. That identity fails for pre-IPO years computed under the two-class method, where income attributable to common shareholders differs from consolidated net income. Those years are reported as unavailable rather than approximated.
