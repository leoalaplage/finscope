# FinScope.io

Every US filer. Every filed figure.

FinScope reads a company's own filings from SEC EDGAR, normalizes them into
comparable periods, and shows you the result without an estimate anywhere in
the chain. **[finscope-financial-research.leoalaplage.workers.dev](https://finscope-financial-research.leoalaplage.workers.dev)**

Next.js App Router semantics through Vinext, React 19, strict TypeScript, and a
single Cloudflare Worker.

## Two surfaces, one engine

**FinScope.io — `/`** is the front door: a search field, and a company on one
screen. No helper text, no tooltip prose, no paragraph under a chart. One ink:
direction is written as a sign, never as a colour. It is the whole US filing
universe — around twelve thousand companies — not a curated list.

**The research workspace — `/research`** is the other shape of the same data,
for the session where you are auditing rather than reading: every period, every
provenance record, the coverage matrix, the screener, the charting bench, the
reverse DCF.

Both draw on the same normalization, the same formula registry, and the same
refusal to fill a gap.

## What a company page shows

`/s/AAPL`, `/s/CRWD`, `/s/BRK-B` — any symbol the SEC registry lists.

- **Price**, over five windows, drawn as one stroke with a crosshair and no
  grid, no axis ladder and no legend. Its high, its low, and the dates at each
  end are written beside it.
- **Valuation**: market capitalisation, enterprise value, P/E, P/S, P/FCF,
  EV/EBITDA, free-cash-flow yield and net debt — each stated on the trailing
  twelve months, with the share count and its basis named underneath.
- **Ten years of annual history** as eight small multiples: revenue, operating
  income, net income, free cash flow, EPS, FCF per share, operating margin and
  diluted share count, each with the rate it compounded at.
- **The statements in full**, annual or quarterly, TTM in the leading column:
  income statement, balance sheet, cash flow, then margins and returns — around
  sixty-five lines, every one of them a figure the filings support.
- **The filing itself**, linked to EDGAR by its accession number.

## The rules the engine will not break

These are not style preferences. Each of them exists because the alternative
produced a wrong number on screen at some point.

- **An absent figure is `null`, never zero.** A filer that does not tag a
  concept has not reported nothing; the page draws an em dash.
- **No currency is ever converted.** A company that files in euros and trades
  in dollars gets no market capitalisation and no multiple — the figure is
  withheld with its reason rather than silently mixed.
- **A multiple over a negative denominator is withheld.** A loss-making company
  is not a cheap company; it is a company the measure does not apply to.
- **A market capitalisation states which share count it is on** — the
  point-in-time count, the cover-page count with its own date, or the diluted
  weighted average, said out loud wherever it is used.
- **Only undimensioned facts are carried.** A company with several share
  classes reports the same concept once per class and once in total; taking a
  dimensioned value would report one class as if it were the company.
- **There are no analyst estimates.** Forward multiples, price targets and PEG
  are consensus figures from a provider FinScope does not have, so they are
  absent rather than guessed.

## How a page is served

A normalized company is about four megabytes and costs the Worker a couple of
hundred milliseconds of CPU to build from raw XBRL — enough that doing it
inside a reader's request used to make the platform refuse everything for
minutes. So nothing on the read path builds anything.

```text
/api/io/[ticker]         the page-sized view of a company, ~100 KB
                         derived once a day from the cached dataset and
                         stored under its own KV key; a warm request parses
                         nothing at all and streams the bytes straight out
/api/io/[ticker]/quote   the last print, cached five minutes — kept apart
                         from the filings because the two settle on
                         completely different clocks
/api/company/[ticker]    the full normalized dataset, built by a second
                         Worker invocation with its own CPU budget
/api/market/[ticker]     price history, cached by whether it is settled
/api/resolve             the SEC company registry, for the search box
```

A company nobody has opened before is answered `202`, handed to that second
invocation, and polled for. A symbol the SEC registry does not list is refused
with a `404` inside a second, and the refusal is remembered for a day.

## Quick start

Requirements: Node.js 22.13 or later and npm.

```bash
npm install && npm run dev
```

Open `http://localhost:3000`. Set `SEC_USER_AGENT` to a descriptive application
name and a real contact email before sustained SEC access; the SEC does not
require an API key.

## Quality checks

```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```

`npm run test:integration` runs the server-render smoke test after a build.

## Architecture

```text
app/
  page.tsx                 FinScope.io — the search, prerendered
  s/[ticker]/page.tsx      the company shell; every figure is fetched client-side
  research/page.tsx        the research workspace and its own stylesheet
  io.css                   the monochrome design system
  api/io/[ticker]/         the page-sized company view and its quote
  api/company/[ticker]/    SEC proxy, normalization and KV cache
  api/market/, api/price/  market history and session matching
components/io/             the .io interface
  Company.tsx              the page, and the two clocks it reads on
  Plot.tsx                 every chart, as plain SVG with no text inside it
  Statements.tsx           the statements, as filed
  Stats.tsx                what a live price and a filed statement make together
  format.ts                how a figure is written, decided in one place
components/                the research workspace
lib/
  io/view.ts               the four-megabyte company reduced to what a page draws
  adapters/sec.ts          official-filing provider adapter
  adapters/yahoo.ts        historical adjusted-close adapter
  periods.ts               annual/quarter/TTM normalization engine
  finance.ts               centralized, pure financial formulas
  metrics.ts               the metric registry and its display groups
  market-basis.ts          the one place a share price may meet a statement
  data-quality.ts          the validation gate every figure passes through
  dataset-cache.ts         key versions, freshness and the warm-up
  market-cache.ts          prices and history in KV, settled apart from live
  runtime-env.ts           Worker bindings handed to route handlers
  types.ts                 normalized facts and provenance model
tests/                     unit and rendered-output tests
worker/                    Cloudflare Worker entry point
ios/                       the SwiftUI client — parked, see Status
```

The normalized fact is the audit boundary. A value carries its period,
currency, unit, periodicity, concept, provider, filing accession, retrieval
time, status and source URL. Calculated values use the periods and formulas
defined in `lib/finance.ts`; missing inputs produce `null`, never an estimate.

## Data providers

Fundamentals come from the official SEC EDGAR Company Facts API. The adapter is
server-only because `data.sec.gov` does not support browser CORS. Prices and
session history come from Yahoo Finance.

See [docs/SOURCES.md](docs/SOURCES.md), [docs/FORMULAS.md](docs/FORMULAS.md),
[docs/LIMITATIONS.md](docs/LIMITATIONS.md) and
[docs/VALIDATION.md](docs/VALIDATION.md).

## Deployment

```bash
npm run build && npx wrangler deploy --config dist/server/wrangler.json
```

Deploy from a copy of `HEAD`, and **fetch before you do it** — a checkout that
is behind the remote deploys a rollback. Build outside any iCloud-synced
directory; on a synced Desktop the build does not finish.

Runtime configuration lives in the Cloudflare environment rather than in this
repository:

| Binding | Type | Purpose |
|---|---|---|
| `DATASET_CACHE` | KV namespace `finscope-datasets` | Normalized datasets, page views, prices and quotes. |
| `SELF` | Service binding to this same Worker | How the warm-up invokes its own endpoints. A plain fetch at this Worker's own hostname does not re-enter it. |
| `SELF_ORIGIN` | Variable (optional) | Where the warm-up addresses its own endpoints; defaults to the workers.dev hostname. |
| `SEC_USER_AGENT` | Variable | Identifies the automated SEC client with contact information. |
| `SITE_ORIGIN` | Variable (optional) | Canonical origin for social-preview URLs; defaults to the workers.dev hostname. |

Cron triggers at 01:00, 07:00, 13:00 and 19:00 UTC keep the cache current. A
company is rebuilt once its stored digest says the filings were read more than
twenty hours ago. **At most six companies are rebuilt per run**, which is a
limit rather than an optimisation: rebuilding eighteen filers inside ninety
seconds got the Worker throttled and the whole site answered `1102` for four
minutes.

The front page and `/research` are prerendered and cost no Worker CPU. Keep
dynamic APIs out of `app/layout.tsx`: one `headers()` call there makes every
page under it dynamic.

**GitHub Pages cannot host this.** FinScope needs a server-side SEC adapter,
KV, cache headers and secret-safe runtime configuration; a static host has none
of them. The code is here; the running site is the Cloudflare Worker.

## Environment variables

| Name | Required | Purpose |
|---|---:|---|
| `SEC_USER_AGENT` | Recommended | Identifies the automated SEC client with contact information. |
| `YAHOO_FINANCE_BASE_URL` | No | Optional Yahoo chart endpoint override. |

No variable is prefixed with `NEXT_PUBLIC_`; secrets never enter the client
bundle.

## Status

**FinScope.io is the product.** Work goes into `/` and `/s/[ticker]` first.

The **research workspace** at `/research` is maintained, not extended.

The **SwiftUI client** under `ios/` is parked. It is not deleted, because it
holds a working contract against the `/v1` API surface, but nothing is being
added to it.

Parked alongside it on `local-ios-and-v1-wip`: the versioned `/v1` endpoints,
the D1 schema and migration, the contract fixtures and the ingestion helpers.
That work is unfinished and is not on `main`.

Known gaps, stated rather than hidden: IFRS filers are invisible here, a
company that changes its CIK loses its history, and Apple's trailing-twelve-month
SG&A is understated because its recent quarters tag a narrower concept than its
annual report does.

FinScope is for research and is not investment advice.
