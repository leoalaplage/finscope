# Financial formulas

All formulas are implemented in `lib/finance.ts`. A missing or invalid input returns `null` and displays as unavailable.

| Metric | Formula | Rule |
|---|---|---|
| Gross margin | Gross profit / Revenue | Same normalized period and currency. |
| Operating margin | Operating income / Revenue | GAAP operating income only. |
| Net margin | Net income / Revenue | GAAP net income attributable to the filing entity where available. |
| OCF margin | Operating cash flow / Revenue | Same annual or quarterly period. |
| Free cash flow | Operating cash flow − abs(Capital expenditures) | Accepts positive-outflow and negative-outflow capex conventions. |
| FCF margin | Free cash flow / Revenue | Calculated only when OCF, capex and revenue exist. |
| Per-share metrics | Metric / Diluted weighted average shares | Uses the matching period's diluted weighted-average shares. |
| Dilution rate | Current diluted shares / Previous diluted shares − 1 | Cash buybacks are not inferred from this change. |
| Annualized dilution | (Current shares / Prior shares)^(1 / years) − 1 | Requires positive endpoints. |
| CAGR | (Ending value / Beginning value)^(1 / years) − 1 | Requires positive endpoints and a positive duration. |
| TTM flow | Sum of latest four complete quarters | Missing quarter makes TTM unavailable. |
| Market capitalization | Matched stock close × diluted shares | Price date and fiscal end must match by the price-selection rule. |
| P/S, P/E, P/OCF, P/FCF | Market capitalization / matching flow | Never combines current price with historical flow data. |
| FCF yield | Free cash flow / Market capitalization | Same matched price period. |
| Buyback yield | Gross repurchase cash flow / Market capitalization | Separate from effective share-count change. |

Balance-sheet facts are point-in-time values and are never summed for TTM. Restated facts take priority when they represent the same period and concept; their filing and accession remain attached.
