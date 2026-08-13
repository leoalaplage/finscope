# FinScope

FinScope is an auditable financial-research web application. It searches supported U.S. public companies, normalizes official SEC XBRL facts, centralizes financial formulas, renders long-term statements and charts, and preserves the lineage of each reported or calculated value.

The repository is private-deployment ready. It uses Next.js-compatible App Router semantics through Vinext, React 19, strict TypeScript and a Cloudflare Worker output.

## What is included

- Search by ticker or company name for Apple, Microsoft, Amazon, NVIDIA and Tesla.
- Live SEC Company Facts adapter with schema validation, concept fallbacks, six-hour cache headers and explicit error handling.
- Offline Apple fixture covering FY 2009–2025 so the application remains demonstrable when an upstream provider is unavailable.
- Company overview, income statement, cash flow, margins, per-share, shares and buybacks, valuation, sources and settings views.
- Annual financial tables with sticky period headers and metric columns.
- Absolute, per-share, margin and growth presentation modes; units through billions.
- Revenue, profit, cash-flow and dilution analysis with CAGR and YoY comparisons.
- CSV export containing company, period, unit, currency, provider, status, concept/formula and source URL.
- Click-through provenance drawer for every reported SEC fact.
- Dark/light themes and responsive desktop, tablet and mobile layouts.
- Unit tests for financial math and a server-render integration test.

## Quick start

Requirements: Node.js 22.13 or later and npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`. Set `SEC_USER_AGENT` to a descriptive application name and real contact email before sustained SEC access; the SEC does not require an API key.

## Quality checks

```bash
npm test                 # financial unit tests
npx tsc --noEmit         # strict TypeScript validation
npm run build            # production Worker build
npm run test:integration # server-render smoke test after build
```

## Architecture

```text
app/                       App Router pages and API endpoints
  api/company/[ticker]/    server-side SEC proxy and normalization endpoint
components/                interactive research workspace
lib/
  adapters/sec.ts          official-filing provider adapter
  finance.ts               centralized, pure financial formulas
  demo-data.ts             traceable offline SEC fixture
  types.ts                 normalized facts and provenance model
tests/                     unit and rendered-output tests
worker/                    Cloudflare Worker entry point
```

The normalized fact is the audit boundary. A value carries its period, currency, unit, periodicity, concept, provider, filing/accession, retrieval time, status and source URL. Calculated values use the same periods and formulas defined in `lib/finance.ts`; missing inputs produce `null`, never an estimate.

## Data providers

Fundamentals come from the official SEC EDGAR Company Facts API. The adapter is server-only because `data.sec.gov` does not support browser CORS. A replaceable Yahoo Finance price adapter boundary is documented, but the production UI intentionally shows market-dependent values as unavailable until a historical price response can be verified. It never applies a current price to old fundamentals.

See [docs/SOURCES.md](docs/SOURCES.md), [docs/FORMULAS.md](docs/FORMULAS.md), [docs/LIMITATIONS.md](docs/LIMITATIONS.md), and [docs/VALIDATION.md](docs/VALIDATION.md).

## Deployment

### Codex Sites / Cloudflare Worker

The checked-in `.openai/hosting.json` is the Sites manifest. The generated Worker output is compatible with Cloudflare. In Codex, save a site version and deploy it with owner-only access for a private research workspace. Runtime variables should be set in the hosting environment, never committed.

### Vercel alternative

Import the private GitHub repository in Vercel, select Next.js, use `npm run build`, and add `SEC_USER_AGENT` in Project Settings → Environment Variables. Keep the repository private; Vercel can deploy private repositories through its GitHub integration.

### Cloudflare Pages/Workers alternative

Connect the private GitHub repository to Cloudflare Workers Builds. Use Node.js 22+, `npm run build`, and publish the generated Worker entry/output according to the Vinext configuration. Add `SEC_USER_AGENT` as a runtime variable.

GitHub Pages is not suitable because FinScope requires a server-side SEC adapter, cache headers and secret-safe runtime configuration.

## Environment variables

| Name | Required | Purpose |
|---|---:|---|
| `SEC_USER_AGENT` | Recommended | Identifies the automated SEC client with contact information. |
| `YAHOO_FINANCE_BASE_URL` | No | Reserved for the isolated market-price adapter. |
| `CACHE_TTL_SECONDS` | No | Reserved provider cache override; default design is six hours. |

No variable is prefixed with `NEXT_PUBLIC_`; secrets never enter the client bundle.

## Important scope notes

The application is a production-quality research foundation, not a licensed market-data redistribution service. SEC fundamentals work live for the included U.S. registry. Full quarterly/TTM extraction, legacy pre-XBRL filings, international regulators, persistent cloud favorites, historical Yahoo price ingestion and non-GAAP reconciliation are explicit next adapters rather than silently simulated features.

FinScope is for research and is not investment advice.
