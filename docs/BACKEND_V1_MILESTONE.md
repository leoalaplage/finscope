# Backend v1 milestone handoff

Date: 4 September 2026

## Delivered

The TypeScript financial core remains the server-side source of truth. Existing `/api/...` routes and the web application are unchanged. The new versioned surface is:

- `GET /v1/companies/search?q=&cursor=`
- `GET /v1/companies/{ticker}/summary`
- `GET /v1/companies/{ticker}/fundamentals?frequency=&metrics=`
- `GET /v1/companies/{ticker}/score`
- `GET /v1/companies/{ticker}/sources?metric=&period=`
- `GET /v1/quotes?symbols=`
- `GET /v1/screener?minScore=&sector=&sort=&cursor=`
- `GET /v1/data-status`

The first iOS integration milestone—Search, Summary, and Fundamentals—is implemented with compact projections, typed errors, cache metadata, ETags, and real contract fixtures under `contracts/v1/`.

## Contract decision log

Contract `1.0.0` uses one success/error envelope. Money is expressed in whole currency units, percentages as decimal fractions, Quality Scores on `0...100`, and coverage on `0...1`. Missing data is `null`, never an inferred zero. Every financial observation carries its own status and date; full provenance is requested separately.

Summary and Fundamentals deliberately read normalized cached data through pure projection functions in `lib/api/v1/`. They do not call React, `NextResponse`, or a UI module. A cache miss returns typed HTTP `202 data_building` with `Retry-After`, while an unavailable binding returns typed HTTP `503`.

## Quality Score transition

`qsStructuredInput()` now creates the engine's native, typed input directly from `CompanyDataset`. `screenStructured()` scores that input without passing through CSV. The legacy `qsRow()`, `qsTable()`, parser, and static screener remain available for the current web application.

The structured path intentionally applies the same four-decimal serialization boundary as the generated CSV path. A parity test asserts that CSV and structured inputs yield byte-equivalent score objects for the same rows.

The temporary `/v1/companies/{ticker}/score` implementation scores the complete configured KV universe before selecting one company. It does not recompute percentiles after filtering. It will move to the published D1 universe after ingestion materialization is connected.

## D1 state

The first Drizzle migration creates:

- `companies`
- `company_snapshots`
- `screener_rows`
- `ingestion_runs`

The screener endpoint reads only the latest `published` ingestion run and performs indexed filtering, sorting, and 30-row pagination. A D1 publication helper inserts a complete, already-scored universe in a transactional batch and marks it published last. It never deletes or mutates the prior published universe.

D1 is intentionally not activated in `.openai/hosting.json`: no real database identifier or deployment decision was available. Until the binding and first universe are provisioned, `/v1/screener` returns a typed `503`, and `/v1/data-status` reports the capability as degraded rather than pretending it is live.

## Verification

- 655 tests pass; 2 existing tests are skipped.
- TypeScript strict mode passes.
- ESLint passes on the complete backend scope. The repository-wide command also includes the concurrently owned `ios/` tree and must be evaluated after that work settles.
- The production build passes and lists all existing `/api` routes plus all eight `/v1` routes.
- Local HTTP smoke tests return `200` for Search and the legacy Resolve route. A production-mode local server without injected KV correctly returns the documented typed `503` for financial endpoints.
- No file under `ios/` was created or modified by this backend work.

## Remaining backend work

1. Provision staging and production D1 bindings, then apply the generated migration.
2. Add the ingestion materializer that writes verified company metadata and snapshot pointers before publishing the scored universe.
3. Move the individual Score route from the temporary KV universe calculation to the published D1 row.
4. Add contract compatibility tests against the Swift decoders once the iOS target consumes the fixtures.
5. Resolve the production market-data provider and redistribution rights before App Store release.
