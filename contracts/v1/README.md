# FinScope REST API v1 contract

This directory is the temporary integration boundary between the TypeScript backend and the native iOS application. JSON files are generated snapshots of real FinScope-supported companies; they are not invented demo payloads.

## Envelope

Every success response is `{ "meta": V1Meta, "data": ... }`. Every error is `{ "meta": V1Meta, "error": { "code", "message", "retryable", "details?" } }`.

`meta` always carries `schemaVersion`, `dataVersion`, `scoreVersion`, `asOf`, `retrievedAt`, `currency`, `unit`, `frequency`, `status`, and `warnings`. Nullable metadata means that one value cannot honestly describe a mixed response. `status` is one of `reported`, `calculated`, `restated`, or `unavailable`.

The current schema is `1.0.0`. Additive fields may be introduced within v1. Removing, renaming, or changing the meaning/unit of a field requires a new schema version and updated fixtures.

## Numeric conventions

- Currency amounts are whole currency units, never abbreviated millions or billions.
- Percentages are decimal fractions: `0.25` means 25%.
- Quality Scores and coverage are exceptions: scores use `0...100`; coverage uses `0...1`.
- Missing or invalid values are JSON `null` with `status: "unavailable"`; zero is used only when zero is the actual value.
- Dates are ISO 8601. A date-only SEC period uses `YYYY-MM-DD`; retrieval and market timestamps include an offset.

## Endpoints

| Endpoint | Notes |
|---|---|
| `GET /v1/companies/search?q=&cursor=` | 20 results per page; cursor is opaque to clients. |
| `GET /v1/companies/{ticker}/summary` | Compact identity, current period, headline metrics, and 5-year growth. |
| `GET /v1/companies/{ticker}/fundamentals?frequency=annual&metrics=revenue,eps,fcf` | Compact series; defaults to the three shown metrics. |
| `GET /v1/companies/{ticker}/score` | Scores the complete configured universe before selecting the company. |
| `GET /v1/companies/{ticker}/sources?metric=&period=` | Full filing provenance only when requested. |
| `GET /v1/quotes?symbols=AAPL,MSFT` | At most 50 symbols; missing quotes remain explicit rows. |
| `GET /v1/screener?minScore=&sector=&sort=&cursor=` | Reads only precomputed D1 rows; page size defaults to 30 and is capped at 50. |
| `GET /v1/data-status` | Reports whether KV and D1-backed capabilities are actually available. |

Summary and Fundamentals can return HTTP `202` with `error.code = "data_building"` and `Retry-After: 3` on a cold cache. Clients should preserve their last valid response and retry. They must not present a stale timestamp as live.

Successful cacheable responses include an `ETag` and honor `If-None-Match` with HTTP `304`.

## Fixtures

- `search.json`
- `company-summary-aapl.json`
- `fundamentals-aapl.json`
- `sources-aapl-revenue.json`
- `quotes-aapl-msft.json`
- `quality-score-aapl.json`
- `screener.json`
- `data-status.json`

Regenerate them with `npm run contracts:generate`. The generator reads the currently deployed FinScope cache and live SEC/market endpoints. Review fixture diffs: a real filing, quote, universe, or calculation change can legitimately move values, while structural changes require an explicit contract decision.

## D1 publication rule

KV remains the document store. D1 contains company metadata, pointers to snapshots, precomputed screener rows, and ingestion run state. A run writes a new `universeVersion` without deleting the last published one. Only after every required row is materialized is the run marked `published`; `/v1/screener` selects the latest published run. Filters and sorts never recompute Quality Scores or percentiles.

