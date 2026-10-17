# Operating DCF conventions

The company page and `/t/dcf` use `components/io/DcfModel.tsx`, `lib/io/dcf-model.ts` and the shared `lib/dcf.ts` calculator. This is an auditable valuation workbench. Automatic forecasts remain screening assumptions, not analyst underwriting or certified fair values.

## Source boundary

The base is the latest annual or trailing period. Revenue, operating income, shares, cash, debt, capital spending and D&A must exist in that period. Missing cash or debt is never zero. Older flow periods are not silently combined with newer ones. The screen names the period and discloses assumptions and coverage gaps.

Where available, period-end shares plus the observed diluted-minus-basic award increment approximate the current fully diluted count. Otherwise the diluted weighted average is a labelled proxy. A complete options valuation is not implied.

SEC D&A is either a reported combined total or a same-window, same-currency sum of depreciation and separately reported intangible amortization. Narrow depreciation-only facts are marked partial. Lease right-of-use amortization is not added to the reconstructed split. A broad reported total may have a different boundary; standalone physical depreciation is preferred in the DCF.

## Normalization and stock compensation

When intangible amortization is separately reported, it is added to operating income to model operating profit before that charge; the same amount is excluded from forecast physical D&A. This is not a projection of GAAP earnings. No future amortization tax shield is assumed. Forward amortization tax deductions need the actual tax and intangible amortization schedules before they can be valued explicitly.

Employee stock compensation remains an expense in operating profit. Historical share-count changes, including acquisition shares, are not extrapolated. Current diluted shares divide the equity value. Future share issuance cannot be priced using a dilution rate alone: it requires a cash-proceeds and equity-claims schedule, and the engine refuses that unsupported calculation. Buybacks do not create extra value by shrinking the divisor while their cash remains in the DCF numerator.

Operating profit derived solely as pre-tax income plus interest may contain nonoperating gains. It is not accepted without the complete nonoperating subtotal. With that subtotal, operating income is pre-tax income minus the aggregate nonoperating result (which already includes interest).

## Forecasts and investment

Five explicit years are followed by 1-15 transition years (five by default). The reader can enter first-stage revenue growth and operating margins year by year. Automatic growth uses current and historical observations; it does not infer guidance, customer orders, acquisition contributions or consensus. Historical growth of more than 35% is no longer automatically truncated to 35%.

Two reinvestment methods are available:

- Capital efficiency: net investment is additional revenue divided by sales-to-operating-capital. The default is the historical median when a meaningful positive operating-capital base exists. Contracting revenue does not automatically liquidate assets.
- Spending ratios: capex less physical D&A plus the change in operating working capital. Missing working-capital history uses a disclosed 1%-of-revenue assumption.

The operating-capital proxy is common equity plus borrowing and reported minority/temporary capital, less cash and observed short-term financial investments. Equity that already includes minority interests is not counted twice. Goodwill remains part of the capital paid for acquisitions. This is an aggregate historical proxy; leases, R&D capitalization and unreported financial items require review.

Operating working capital excludes cash, observed financial investments and current financing liabilities. Its coverage metadata states missing categories and residual taxes or other nonoperating balances. It is distinct from the legacy net-working-capital statistic.

During transition, net reinvestment moves toward the terminal identity. Losses receive no assumed cash-tax refund without an explicit tax-loss schedule. Initial and terminal tax assumptions are independently editable.

## Terminal year

The terminal year N+1 is normalized explicitly:

```
NOPAT(N+1) = Revenue(N) * (1+g) * terminal operating margin * (1-terminal tax)
Reinvestment(N+1) = NOPAT(N+1) * g / RONIC
FCFF(N+1) = NOPAT(N+1) - Reinvestment(N+1)
TV(N) = FCFF(N+1) / (WACC-g)
```

RONIC is the return on new invested capital. It equals WACC by default, so growth alone creates no incremental terminal economic profit. A permanent excess return is an explicit editable assumption. Positive growth without the investment it requires is not a default. Exit multiples remain available as a separately labelled relative-valuation assumption.

The enterprise-to-equity bridge is PV of explicit FCFF plus PV of terminal value, plus cash and financial investments, less debt and other equity claims. Reported minority and temporary-equity claims initialize the editable claims input. Unreported preferred stock, pensions and options are not automatically valued.

## Discount rate and uncertainty

CAPM uses dated, adjusted weekly returns aligned on both interval endpoints. Missing weeks cannot shift one security relative to the index. Treasury source/date, matched observations, beta adjustment and premium source are exposed. A stale or unavailable rate is not called live. An index-implied equity premium is an estimate, not an observed market price.

When market inputs fail, the assumed 9% cost of equity (and assumed 5% pre-tax debt cost when needed) are disclosed. A reader can override WACC. Unavailable matching prices also prevent reliable market-weight and upside comparisons. Such results require review.

Bear and bull are illustrative operating stresses on growth, margins and capital efficiency. They share financing and perpetual-growth assumptions; the sensitivity grids separately explore discount rate and terminal assumptions. They are not calibrated probabilities or comprehensive recession scenarios. Reverse DCF scans for multiple value/growth branches and withholds a single implied growth rate when the solution is ambiguous.

## Audit and exports

The screen exposes base normalized operating FCFF and a separate cash-flow-statement diagnostic: CFO minus capex minus stock compensation plus after-tax interest. Their residual is not forced to zero: actual working-capital movements, deferred/cash tax differences, lease payments, amortization tax shields and other noncash adjustments can explain it. This is a diagnostic comparison, not a certified statement tie-out.

Reported CFO less capex and modeled FCFF are separate chart series with distinct boundaries. The JSON export contains the model version, export time, source period, current-share convention, forecasts, cost-of-capital diagnostics, equity bridge, results and warnings.

## Validation references

- [Damodaran: excess returns and terminal value](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/termvalueexreturns.htm)
- [Damodaran: growth, investment and marginal returns](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/AppldCF/derivn/ch12deriv.html)
- [Morningstar equity research methodology](https://www.morningstar.com/content/dam/marketing/shared/research/methodology/705988Morningstar_Equity_Research_Methodology.pdf)

Regression tests cover source gaps, acquisition issuance, compensation expense, D&A boundaries, operating working capital, capital efficiency, contraction, explicit forecasts, negative operating profits, current equity claims, terminal reinvestment, competitive equilibrium, rate validation and ambiguous reverse valuations. Actual issuer filings remain necessary to review each investment case.
