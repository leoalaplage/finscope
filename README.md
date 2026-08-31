# FinScope

FinScope is an auditable financial-research web application. It normalizes official SEC XBRL facts for a curated watchlist of U.S. public companies, centralizes every financial formula in one module, renders long-term statements and charts, and preserves the lineage of each reported or calculated value.

It uses Next.js App Router semantics through Vinext, React 19, strict TypeScript and a Cloudflare Worker output. It is deployed at [finscope-financial-research.leoalaplage.workers.dev](https://finscope-financial-research.leoalaplage.workers.dev).

## What is included

### Coverage

- A 21-company watchlist of quality-growth compounders: NVDA, AAPL, GOOGL, MSFT, META, V, MA, ANET, BKNG, NOW, SPGI, ABNB, CME, PAYX, IBKR, MSCI, VEEV, ZTS, CBOE, CPRT, FDS. Any other SEC filer can be added by ticker from the company manager.
- Live SEC Company Facts adapter with schema validation, concept fallbacks and explicit error handling, backed by a Cloudflare KV cache.
- Offline Apple fixture covering FY 2009–2025 so the application stays demonstrable when SEC EDGAR is unavailable.
- Historical Yahoo adjusted close matched to an explicit fiscal date, with an exact / previous-seven-day / next-two-day fallback policy and full date lineage. A current price is never applied to old fundamentals.
- Figures fail closed. Nothing is converted between currencies, an unreported balance is never read as zero, and a market capitalisation states which share count it is on — so a figure that cannot be built from the filings is withheld with its reason on the row rather than estimated.

### Navigation

Five destinations, and a search box in the header that reaches any company from any page — the watchlist you follow, and every SEC filer behind it.

- **Watchlist** — the companies you follow as cards stating five-year figures, with the ranked table and its column picker one click away, plus a quality-versus-valuation scatter.
- **Market** — the three US indices intraday, and the day's moves as sector treemaps.
- **Portfolio** — transactions, value, and return with deposits stripped out.
- **Charts** — the multi-company, multi-metric workspace.
- **QS Screener** — the quality-score screen, with PNG export.

Everything about a single company is on that company's page, in six tabs: **Overview** (a KPI card grid, one chart per measure), **Statistics** (the headline panel, alone or with up to five other companies compared row by row), **Statements** (income statement, cash flow and balance sheet drawn as flow diagrams, then the balance sheet in detail), **Financials** (statements, per share, margins, capital allocation, growth and cash quality), **Valuation** (multiples against their own five-year history, a reverse DCF on free cash flow per share, and the full FCFF model) and **Sources**.

Every view is addressable: `/?ticker=VEEV&view=company&tab=valuation` opens exactly that, and Back and Forward work.

Secondary views reachable from the footer: Data Quality, Formula Audit, Import status and Sources.

### Data views

- Annual, real-quarter and rolling four-quarter TTM periods.
- Absolute, per-share, margin, growth and CAGR modes, with values abbreviated to K, M and B.
- Profile, margins, five-year average returns (ROA, ROTA, ROE, ROCE, ROIC), trailing valuation multiples, financial health and dividends, grouped as a single statistics panel.
- 5Y and 10Y CAGR for revenue, gross profit, operating profit, net income, FCF, FCF per share and share price; growth consistency as the R² of a log-linear fit; the revenue-versus-FCF growth gap in percentage points.
- CSV export carrying company, period, unit, currency, provider, status, concept/formula and source URL.
- A click-through provenance drawer on every reported SEC fact.

### Charts

- Any number of companies and metrics on one workspace, with per-series style (line, bar, area), colour, visibility and frequency (annual / quarterly / TTM for fundamentals, daily / weekly / monthly for price).
- Presets, small multiples, indexed-to-zero and percent-change presentations, log scale, range selection, NBER recession bands, stock-split marks and a data table.
- **One value axis per panel.** Two measures on different scales become two panels or a shared indexed base — a second y-scale is never overlaid, because the crossing point of two independent axes is an artefact of where they were placed.
- SVG/PNG export.
- Light and dark themes, each with its own validated categorical palette rather than an inversion of the other.

## Quick start

Requirements: Node.js 22.13 or later and npm.

```bash
npm install && npm run dev
```

Open `http://localhost:3000`. Set `SEC_USER_AGENT` to a descriptive application name and a real contact email before sustained SEC access; the SEC does not require an API key.

## Quality checks

```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```

`npm run test:integration` runs the server-render smoke test after a build.

## Architecture

```text
app/                       App Router pages and API endpoints
  api/company/[ticker]/    SEC proxy, normalization and KV cache
  api/price/[ticker]/      historical Yahoo session-matching endpoint
  api/prices/, api/market/ batch and market-series price endpoints
components/                interactive research workspace
  FinanceApp.tsx           the shell, the address bar, and the company page
  HeaderSearch.tsx         watchlist and SEC search, from any page
  Skeleton.tsx             the shape of what is loading, at its own size
lib/
  adapters/sec.ts          official-filing provider adapter
  adapters/yahoo.ts        historical adjusted-close adapter
  market-profile.ts        the company a market endpoint needs, registry or not
  market-cache.ts          prices and history in KV, settled apart from live
  dataset-cache.ts         key versions, freshness and the warm-up
  periods.ts               annual/quarter/TTM normalization engine
  finance.ts               centralized, pure financial formulas
  metrics.ts               the metric registry and its display groups
  growth-quality.ts        CAGR tables, consistency, incremental returns
  statement-flows.ts       statements as flows, and balance-sheet health
  sankey.ts                the flow-diagram layout
  fcf-yield-model.ts       the reverse discounted-cash-flow model
  charting.ts              palettes, axis bounds and tick selection
  chart-workspace.ts       the chart model, presets and serialization
  auto-chart.ts            automatic panel planning and value formatting
  runtime-env.ts           Worker bindings handed to route handlers
  demo-data.ts             traceable offline SEC fixture
  types.ts                 normalized facts and provenance model
tests/                     unit and rendered-output tests
worker/                    Cloudflare Worker entry point
```

The normalized fact is the audit boundary. A value carries its period, currency, unit, periodicity, concept, provider, filing/accession, retrieval time, status and source URL. Calculated values use the same periods and formulas defined in `lib/finance.ts`; missing inputs produce `null`, never an estimate.

## Data providers

Fundamentals come from the official SEC EDGAR Company Facts API. The adapter is server-only because `data.sec.gov` does not support browser CORS.

**Only undimensioned facts are carried.** A company with multiple share classes reports the same concept once per class and once in total; taking any dimensioned value would silently report one class as if it were the company.

See [docs/SOURCES.md](docs/SOURCES.md), [docs/FORMULAS.md](docs/FORMULAS.md), [docs/LIMITATIONS.md](docs/LIMITATIONS.md), and [docs/VALIDATION.md](docs/VALIDATION.md).

## Deployment

The generated Worker output is deployed to Cloudflare. Two pieces of runtime configuration live in the Cloudflare environment rather than in this repository:

| Binding | Type | Purpose |
|---|---|---|
| `DATASET_CACHE` | KV namespace `finscope-datasets` | Caches normalized company datasets. |
| `SELF` | Service binding to this same Worker | How the warm-up invokes its own endpoints. A plain fetch at this Worker's own hostname does not re-enter it. |
| `SELF_ORIGIN` | Variable (optional) | Where the warm-up addresses its own endpoints; defaults to the workers.dev hostname. |
| `SEC_USER_AGENT` | Variable | Identifies the automated SEC client with contact information. |
| `SITE_ORIGIN` | Variable (optional) | Canonical origin for social-preview URLs; defaults to the workers.dev hostname. |

Cron triggers at 01:00, 07:00, 13:00 and 19:00 UTC keep the cache current. A company is rebuilt once its stored digest says the filings were read more than twenty hours ago, so a quarterly result is on screen within a day of being published rather than whenever the key happened to expire. **At most six companies are rebuilt per run**, which is not an optimisation but a limit: rebuilding eighteen filers inside ninety seconds got the Worker throttled and the whole site answered `1102` for four minutes. Four runs a day at six each still covers twenty-four companies.

The request that reads a reader's watchlist also warms what is missing from it, and refreshes one aged company behind that — which is the only thing that ever refreshes a company the reader added themselves, since no cron knows about it.

Prices and market history are cached in the same namespace, separated by whether they are settled: five minutes for today's price, a day for a close that is a matter of record.

The front page is prerendered and served for about a millisecond of Worker CPU. Keep dynamic APIs out of `app/layout.tsx`: one `headers()` call there makes every page under it dynamic, and the whole application tree is then server-rendered on every visit.

The KV cache is not an optimization detail — normalizing a company from raw XBRL exceeds the Worker CPU limit on a cold request, which returned error 1102 until the cache was added. `lib/runtime-env.ts` hands the bindings to the route handlers; a missing binding degrades to an uncached fetch rather than failing.

GitHub Pages is not suitable: FinScope requires a server-side SEC adapter, cache headers and secret-safe runtime configuration.

## Environment variables

| Name | Required | Purpose |
|---|---:|---|
| `SEC_USER_AGENT` | Recommended | Identifies the automated SEC client with contact information. |
| `YAHOO_FINANCE_BASE_URL` | No | Optional Yahoo chart endpoint override. |

No variable is prefixed with `NEXT_PUBLIC_`; secrets never enter the client bundle.

## Scope notes

**There are no analyst estimates.** Forward multiples, price targets, PEG and estimated growth are consensus figures from an estimates provider FinScope does not have, so they are absent rather than guessed.

FinScope is a research foundation, not a licensed market-data redistribution service. Legacy pre-XBRL filings, international regulators and non-GAAP reconciliation remain explicit future adapters rather than silently simulated features. Where a company's data genuinely cannot be recovered — Visa's share count is absent from companyfacts, and a handful of filers omit capital expenditures for some years — the gap is reported rather than filled with an estimate.

FinScope is for research and is not investment advice.
