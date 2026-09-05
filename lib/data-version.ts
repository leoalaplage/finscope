/**
 * How the stored figures are versioned, and nothing else.
 *
 * A bare constant with no imports, so the browser may read it too. The page
 * asks for a company view under this version, which is what keeps a reader's
 * own cache from answering with figures built under semantics that have since
 * been corrected: the key in KV carried the version from the start, and the URL
 * did not, so a corrected split or a corrected share count reached the KV store
 * and then sat behind a copy the browser had already been told it could reuse
 * for a day.
 */
/**
 * The cache key version.
 *
 * Bump it whenever normalization changes *meaning* — a new concept, a corrected
 * sign, a different quarter rule — so a dataset is never served under semantics
 * it was not built with. Changing it twice within one piece of work is the
 * mistake to avoid: the first half of a change warms the new key and the second
 * half then reads its own stale output back.
 *
 * v2: capex falls back to productive-asset and software concepts.
 * v3: diluted share counts are recovered from reported EPS.
 * v4: net income prefers income attributable to common; reported EPS is
 *     split-adjusted like every other per-share value.
 * v5: total equity is mapped, which invested capital and ROIC depend on.
 * v6: a share count recovered from EPS carries its filing date, so a split is
 *     not applied to a figure the filer had already restated.
 * v7: derived quarters may not mix revenue concepts; CME's 2012 split is known.
 * v8: a directly reported fourth quarter is preferred over subtraction, and an
 *     impossible derived quarter is dropped instead of published.
 * v9: total assets, goodwill, acquired intangibles, interest expense and
 *     dividends per share are carried; and total debt is the sum of its current
 *     and non-current portions rather than whichever one the filer tagged.
 * v10: balance-sheet detail (total liabilities, PP&E, inventory, receivables,
 *     payables, investments, retained earnings) and the operating-expense
 *     breakdown, which the statement diagrams and the balance-sheet view need.
 * v11: a dividend per share tagged as a rate against every context is rebuilt
 *     from its quarters, and a share count is recovered from the dividend for
 *     filers publishing neither a share count nor diluted earnings per share.
 * v12: a quarter uses the concept its own annual figure uses. Mastercard tags
 *     its quarters with a gross contract-revenue concept while its year uses
 *     net `Revenues`, so its quarterly and trailing revenue — and every margin,
 *     per-share and valuation figure built on one — was about 40% too high.
 * v13: a quarter may be built from a concept other than its year's, where that
 *     concept is provably the same measure. Adopting the revenue standard in
 *     2018 made filers restate a year under a new concept while its quarters
 *     kept the old one, and seventeen of the twenty-one companies here lost
 *     about five quarters to it — Apple two whole years.
 * v14: an annual report on Form 20-F or 40-F is read like a 10-K, and a
 *     company that normalizes to no periods at all is an error rather than an
 *     empty answer. ASML files 623 US GAAP concepts, every one of them on a
 *     20-F, and came back as a company with nothing in it and a 200 status.
 * v15: a quarter republished as a comparative inside a later annual report is
 *     read, and dated by the year it belongs to rather than by the calendar
 *     year of its end. Microsoft's restated fiscal 2017 quarters were in the
 *     filings all along under the restated concept, carrying the filing's own
 *     `fp: "FY"`; seven companies gain quarters and no existing value moves.
 * v16: revenue is the total the filer states rather than the contract revenue
 *     inside it — Berkshire's 2025 moves from 247.2bn to the 371.4bn its own
 *     income statement carries — and the period-end share count is read from
 *     the balance sheet rather than only from the cover page, which gives ten
 *     of the audited filers a true count where market capitalisation had been
 *     falling back to the diluted weighted average. Both change stored facts.
 * v17: financial companies carry a verified economic type, and debt may be
 *     rebuilt from explicitly non-overlapping long- and short-term borrowing
 *     totals. JPMorgan's stated borrowing total includes both 435.2bn of
 *     long-term debt and 64.8bn of short-term borrowings; CME's published
 *     unsecured debt and finance-lease components are likewise kept distinct.
 * v18: `DebtCurrent` — debt due within a year, short-term borrowing and current
 *     maturities together — is read as a synonym for the current portion rather
 *     than as a separate short-term line, so one balance is counted once
 *     however many concepts name it. NVIDIA files 999m under both concepts and
 *     came out at 9,467m of borrowings against the 8,468m it states itself.
 *     A long-term total whose current side is a filed zero is now complete on
 *     its own, which is what Adobe publishes and what its invested capital and
 *     ROIC were withheld for want of.
 * v19: a dynamically resolved filer carries its official SEC SIC and therefore
 *     receives a financial economic type before any industrial ROIC, FCFF or
 *     enterprise-value measure is considered. Exact ticker matches are also
 *     prioritised before the twelve-result search limit.
 * v20: annual filings labelled `fp: Q4` carry the same comparative facts as FY
 *     filings, recovering Mastercard's reported 2017 quarters. Exact quarters
 *     originally filed under SalesRevenueNet also survive a later ASC 606
 *     annual-only restatement, recovering Microsoft's fiscal 2016 history
 *     without allocating or estimating the restatement.
 *     Total debt, in the same version, is the most complete filed reading at
 *     the balance-sheet date rather than only a pair of balances that prove
 *     each other. A sweep of 110 US filers found 27% with no debt total at all
 *     — Meta, Home Depot, Caterpillar, McDonald's, Thermo Fisher, Micron —
 *     none of them debt-free: each files a borrowing balance, and not the pair
 *     the older rule required. Net debt, enterprise value and the returns on
 *     capital move with it.
 * v21: facts are assigned to the actual annual window that contains them,
 *     rather than one modal fiscal-end month/day; instant balances are joined
 *     by exact date regardless of the filing's fy/fp label; and an exact
 *     originally reported quarterly basis survives any later annual-only
 *     restatement, not only the ASC 606 revenue transition. These rules remove
 *     generic 52/53-week, context-label and concept-migration gaps.
 * v22: splits are read from the filings. A filer declares its ratio —
 *     Amazon's twenty-for-one on 27 May 2022 — and the ratio is applied where
 *     it explains a break in that company's own share counts, which extends
 *     the correction from the twenty-one curated companies to any filer a
 *     reader types. Amazon's 2019 earnings per share moves from $22.99 to
 *     $1.15, and Broadcom, Walmart, Lam Research, Alibaba, Canadian Pacific
 *     and Flowserve are restated onto one basis with it.
 */
/*
 * v27: the count on the cover of a report is read into the period that report
 * covers. It is dated the day the report was signed, so it matched no period
 * and was dropped — and for the filers with several share classes, which tag
 * their balance-sheet count per class, it is the only count that reaches this
 * endpoint at all. An average over the whole year stood in for all of them:
 * six per cent above the shares Booking actually has, and every multiple struck
 * on it wrong by the same six per cent. The stored datasets carry the average.
 *
 * v26: a split the filer declared nowhere is read from the filer restating its
 * own history. Booking split twenty-five for one and tagged no ratio, so its
 * share counts sat on two bases at once — 33 million diluted shares against a
 * company that has 800 million, free cash flow per share falling from $278 to
 * $21 across one point of the chart. The same quarter filed twice, at two
 * counts a clean ratio apart, is the event; every stored dataset built before
 * this carries the split it missed, so nothing may stand in for them.
 *
 * v25: separately reported direct cost lines are reconciled into cost of
 * revenue, a lone finance lease is accepted as the only filed debt balance,
 * and clustered stock splits are recognized together. Copart needs all three
 * corrections, so its cached statements must be rebuilt.
 *
 * v24: where a filer publishes no operating income subtotal, earnings before
 * interest and taxes are struck from the pre-tax income and the interest
 * expense it does publish. Exxon and Johnson & Johnson tag no operating income
 * at all, and six measures rest on it, so both scored on barely half their data.
 *
 * v23: a quarter whose operating cash flow was genuinely negative is kept.
 *
 * It was being discarded as failed arithmetic, and a trailing figure needs all
 * four quarters — so every company that burns cash in a quarter, and every
 * exchange whose clearing balances swing through zero, lost years of free cash
 * flow from the trailing series with nothing on the page saying why. Cboe lost
 * sixteen of them. The stored datasets carry those holes, so they have to be
 * built again; nothing may stand in for them, because standing in would serve
 * the very figures this corrects.
 */
export const KEY_VERSION = "v27";
