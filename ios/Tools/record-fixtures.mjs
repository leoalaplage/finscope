/**
 * Records the `/v1` fixtures the iOS app reads before Codex's endpoints exist.
 *
 * Every figure written here comes from FinScope's own engine, unchanged: the
 * datasets are fetched from the deployed Worker, the derived metrics come from
 * `lib/finance.ts`, and the Quality Score comes from `lib/qs/*` scored against
 * the covered universe. Nothing is invented, estimated or rounded into being.
 * That is the whole point of a recorder rather than a mock — the app is wired
 * to real values from its first screen, so a wrong unit or a missing reason
 * shows up as a wrong screen instead of a plausible one.
 *
 * The shape written is the `/v1` contract of AUDIT_FINSCOPE_IOS.md §5.5. When
 * `contracts/v1/` lands, these files are replaced by Codex's fixtures and the
 * Swift DTOs should not move.
 *
 *   node --import tsx ios/Tools/record-fixtures.mjs [--host URL] [--tickers A,B]
 *
 * Read-only with respect to the backend: it calls public GET routes and writes
 * only under ios/Fixtures/.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isFinancialBusiness, businessTypeLabel } from "../../lib/business-type.ts";
import { derivedValue, valueOf } from "../../lib/finance.ts";
import { qsRow, qsTable, qsValuationColumns } from "../../lib/qs-export.ts";
import { screen, QS_METRICS, QS_METRIC_NAMES, QS_METRIC_NOTES, QS_COVERAGE_FLOOR } from "../../lib/qs/screener.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../Fixtures/v1");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const HOST = flag("host", "https://finscope-financial-research.leoalaplage.workers.dev");
/** The companies whose full fiche is recorded. The screener records all 21. */
const DETAILED = flag("tickers", "AAPL,MSFT,NVDA,BKNG,CME").split(",");

const SCHEMA_VERSION = "1.0.0";
/** Bumped with `KEY_VERSION` in lib/dataset-cache.ts, which stamps the datasets. */
const DATA_VERSION = "v23";
/** Identifies the QS rules, weights and anchors these scores were produced by. */
const SCORE_VERSION = `qs-1.${QS_METRICS.length}`;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function getJSON(path) {
  const response = await fetch(`${HOST}${path}`, {
    headers: { "user-agent": "FinScope-iOS fixture recorder (leoalaplage@gmail.com)" },
  });
  if (!response.ok) throw new Error(`GET ${path} → ${response.status}`);
  return response.json();
}

const write = (relative, body) => {
  const path = join(OUT, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
  const size = JSON.stringify(body).length;
  console.log(`  ${relative.padEnd(38)} ${(size / 1024).toFixed(1)} kB`);
};

// ---------------------------------------------------------------------------
// The value envelope
// ---------------------------------------------------------------------------

/**
 * One figure with its status and, when it is missing, its reason.
 *
 * This is the rule the web product is built on carried into the contract: an
 * absent figure is *unknown*, never zero, and it says why on the line. The app
 * never sees a bare `null` it has to invent an explanation for.
 */
const known = (value, { status = "calculated", unit, currency = null, basis = null } = {}) =>
  value == null || !Number.isFinite(value)
    ? null
    : { value, status, unit, currency, basis };

const unknown = (reason, { unit, currency = null } = {}) => ({
  value: null,
  status: "unavailable",
  reason,
  unit,
  currency,
});

const orUnknown = (value, reason, options) => known(value, options) ?? unknown(reason, options);

// ---------------------------------------------------------------------------
// Fundamental series
// ---------------------------------------------------------------------------

/**
 * The metrics the fiche can chart, with the presentation rules that belong to
 * the figure rather than to the screen: a flow of money is a bar, a rate is a
 * line, and a rate's axis does not get to hide zero.
 */
const SERIES = [
  { metric: "revenue", label: "Revenue", unit: "currency", style: "bar", source: "fact" },
  { metric: "netIncome", label: "Net income", unit: "currency", style: "bar", source: "fact" },
  { metric: "dilutedEpsReported", label: "EPS (diluted)", unit: "perShare", style: "bar", source: "fact" },
  { metric: "freeCashFlow", label: "Free cash flow", unit: "currency", style: "bar", source: "derived" },
  { metric: "freeCashFlowPerShare", label: "FCF / share", unit: "perShare", style: "bar", source: "derived" },
  { metric: "grossMargin", label: "Gross margin", unit: "fraction", style: "line", source: "derived" },
  { metric: "operatingMargin", label: "Operating margin", unit: "fraction", style: "line", source: "derived" },
  { metric: "freeCashFlowMargin", label: "FCF margin", unit: "fraction", style: "line", source: "derived" },
  { metric: "roic", label: "ROIC", unit: "fraction", style: "line", source: "derived" },
  { metric: "dilutedShares", label: "Shares outstanding (diluted)", unit: "shares", style: "line", source: "fact" },
  { metric: "totalDebt", label: "Total debt", unit: "currency", style: "bar", source: "fact" },
  { metric: "netDebt", label: "Net debt", unit: "currency", style: "bar", source: "derived" },
];

/** "an exchange", "a bank" — the engine's own word for the business. */
const article = (type) => {
  const label = businessTypeLabel(type);
  return `${/^[aeiou]/.test(label) ? "an" : "a"} ${label}`;
};

/** Why a figure is missing, in the filer's terms rather than the code's. */
function absenceReason(period, definition, businessType) {
  const industrialOnly = ["roic", "freeCashFlow", "freeCashFlowMargin", "freeCashFlowPerShare", "netDebt"];
  if (isFinancialBusiness(businessType) && industrialOnly.includes(definition.metric)) {
    return `Not comparable for ${article(businessType)}: borrowing is an input to this business, not a burden on it.`;
  }
  if (definition.source === "fact") {
    return `The filer publishes no ${definition.label.toLowerCase()} for this period.`;
  }
  return `Built from figures this period does not carry.`;
}

function seriesFor(dataset, frequency) {
  const periods = dataset.periods
    .filter((period) => period.periodicity === frequency)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const businessType = dataset.company.businessType;

  return SERIES.map((definition) => {
    const points = periods.map((period) => {
      const raw =
        definition.source === "fact"
          ? valueOf(period, definition.metric)
          : derivedValue(period, definition.metric);
      const fact = period.facts?.[definition.metric];
      const base = {
        periodEnd: period.periodEnd,
        fiscalYear: period.fiscalYear,
        label: period.label,
      };
      if (raw == null || !Number.isFinite(raw)) {
        return { ...base, value: null, status: "unavailable", reason: absenceReason(period, definition, businessType) };
      }
      return {
        ...base,
        value: raw,
        status: definition.source === "fact" ? (fact?.provenance?.status ?? "reported") : "calculated",
        ...(fact?.provenance?.note && fact.provenance.status !== "reported" ? { note: fact.provenance.note } : {}),
      };
    });

    // A series nothing was ever published for is carried as an empty series
    // with its reason, not dropped: the picker must be able to say why a
    // metric it offers has nothing behind it for this company.
    const usable = points.filter((point) => point.value != null);
    return {
      metric: definition.metric,
      label: definition.label,
      unit: definition.unit,
      style: definition.style,
      currency: definition.unit === "currency" || definition.unit === "perShare" ? dataset.periods[0]?.currency ?? null : null,
      available: usable.length > 0,
      ...(usable.length === 0
        ? { unavailableReason: absenceReason(periods.at(-1) ?? {}, definition, businessType) }
        : {}),
      points,
    };
  });
}

// ---------------------------------------------------------------------------
// Quality Score
// ---------------------------------------------------------------------------

const PILLAR_KEYS = { Quality: "quality", Health: "health", Growth: "growth", Value: "value" };

/**
 * Projects one scored company into the contract, keeping the engine's own
 * numbers and translating only the names. `couverture` becomes `coverage`;
 * nothing is re-derived, re-weighted or re-ranked here.
 */
function scorePayload(scored, universe) {
  const pillars = Object.fromEntries(
    Object.entries(PILLAR_KEYS).map(([engine, key]) => [key, scored.piliers?.[engine] ?? null]),
  );

  const metrics = QS_METRICS.map(({ cle, pilier, poids, sens }) => {
    const raw = scored.brut?.[cle] ?? null;
    const score = scored.score_metrique?.[cle] ?? null;
    return {
      key: cle,
      label: QS_METRIC_NAMES[cle] ?? cle,
      note: QS_METRIC_NOTES[cle] ?? null,
      pillar: PILLAR_KEYS[pilier],
      weight: poids,
      direction: sens === "H" ? "higherIsBetter" : "lowerIsBetter",
      raw,
      score,
      ...(raw == null
        ? { unavailableReason: "Not published for this company, so its weight is spread over the metrics that are." }
        : {}),
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    scoreVersion: SCORE_VERSION,
    universeVersion: universe.version,
    universeSize: universe.size,
    universeLabel: universe.label,
    ticker: scored.Ticker,
    sector: scored.Secteur,
    total: scored.total,
    grade: scored.note,
    coverage: scored.couverture,
    coverageFloor: QS_COVERAGE_FLOOR,
    pillars,
    rank: scored.rang ?? null,
    sectorRank: scored.rang_secteur ?? null,
    sectorSize: scored.taille_secteur ?? null,
    alerts: scored.alertes_detail ?? [],
    strengths: (scored.forces ?? []).map(([key, value]) => ({
      key,
      label: QS_METRIC_NAMES[key] ?? key,
      score: value,
    })),
    weaknesses: (scored.faiblesses ?? []).map(([key, value]) => ({
      key,
      label: QS_METRIC_NAMES[key] ?? key,
      score: value,
    })),
    valuation: { label: scored.valuation, level: scored.valo_niveau, sweetSpot: scored.sweet_spot === true },
    metrics,
    asOf: universe.asOf,
    retrievedAt: universe.retrievedAt,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function priceFor(ticker) {
  // Two closes: the latest the provider matched, and the one before it, which
  // is what a day's change is measured against. Neither is computed here.
  const end = new Date();
  const start = new Date(end.getTime() - 20 * 86_400_000);
  const iso = (date) => date.toISOString().slice(0, 10);
  try {
    const history = await getJSON(
      `/api/market/${ticker}?start=${iso(start)}&end=${iso(end)}&frequency=daily`,
    );
    const bars = history.bars ?? [];
    const last = bars.at(-1);
    const previous = bars.at(-2);
    if (!last) return null;
    return {
      value: last.close,
      previousClose: previous?.close ?? null,
      changePercent:
        previous?.close != null && previous.close > 0
          ? ((last.close - previous.close) / previous.close) * 100
          : null,
      currency: last.currency,
      asOf: last.date,
      type: "split-adjusted close",
      sourceUrl: last.sourceUrl,
    };
  } catch (error) {
    console.warn(`  ! no price for ${ticker}: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log(`Recording /v1 fixtures from ${HOST}\n`);

  const [watchlist, freshness] = await Promise.all([
    getJSON("/api/watchlist"),
    getJSON("/api/freshness"),
  ]);
  const summaries = watchlist.summaries ?? [];
  console.log(`Universe: ${summaries.length} companies\n`);

  // --- Prices, then the QS table the engine reads -------------------------
  const prices = {};
  for (const summary of summaries) prices[summary.ticker] = await priceFor(summary.ticker);

  const rows = summaries.map((summary) => ({
    ticker: summary.ticker,
    values: {
      ...summary.qs,
      ...qsValuationColumns(summary.qsPrice, prices[summary.ticker]?.value ?? null, prices[summary.ticker]?.currency ?? null),
    },
  }));

  const universe = {
    version: `${DATA_VERSION}-${freshness.rows?.[0]?.readAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}`,
    size: rows.length,
    label: "Covered US SEC filers",
    asOf: new Date().toISOString().slice(0, 10),
    retrievedAt: new Date().toISOString(),
  };

  const result = screen(qsTable(rows), {});
  const byTicker = new Map(result.all.map((company) => [company.Ticker, company]));
  const names = new Map(summaries.map((summary) => [summary.ticker, summary.name]));

  // --- Screener -----------------------------------------------------------
  write("screener.json", {
    schemaVersion: SCHEMA_VERSION,
    scoreVersion: SCORE_VERSION,
    universeVersion: universe.version,
    universeLabel: universe.label,
    universeSize: universe.size,
    asOf: universe.asOf,
    retrievedAt: universe.retrievedAt,
    warnings: result.warnings,
    /** Metrics no company in this universe carried, so no filter can use them. */
    /// Metrics no company in this universe carried, in the engine's own keys.
    unavailableMetrics: result.missing,
    cursor: null,
    rows: result.all
      .slice()
      .sort((a, b) => (b.total ?? -1) - (a.total ?? -1))
      .map((company) => ({
        ticker: company.Ticker,
        name: names.get(company.Ticker) ?? company.Ticker,
        sector: company.Secteur,
        total: company.total,
        grade: company.note,
        coverage: company.couverture,
        pillars: Object.fromEntries(
          Object.entries(PILLAR_KEYS).map(([engine, key]) => [key, company.piliers?.[engine] ?? null]),
        ),
        alerts: company.alertes ?? 0,
        // Billions, as the engine's own column states it.
        marketCapBillions: company.Cap,
        // Keyed by the engine's own metric keys (`QS_METRICS[].cle`), not by
        // the CSV column headings. Reading `brut["Revenue 5Y CAGR"]` instead
        // of `brut.Rev5` returned undefined for seven of these eight, and the
        // screener drew a dash for every company on figures it had.
        metrics: {
          roic: company.brut?.ROIC ?? null,
          revenueGrowth: company.brut?.Rev5 ?? null,
          fcfGrowth: company.brut?.LevFCF5 ?? null,
          operatingMargin: company.brut?.OpM ?? null,
          fcfMargin: company.brut?.FCFM5 ?? null,
          netDebtToEbitda: company.brut?.NetDebtEBITDA ?? null,
          evToFcf: company.brut?.EV_FCF ?? null,
          fcfYield: company.brut?.FCFYield ?? null,
        },
      })),
  });

  // --- Search catalogue ---------------------------------------------------
  write("search.json", {
    schemaVersion: SCHEMA_VERSION,
    retrievedAt: universe.retrievedAt,
    // The fixture carries the covered universe and the client filters it.
    // The live endpoint filters server-side against the SEC registry; the app
    // cannot tell the difference because it only ever asks the repository.
    results: summaries.map((summary) => ({
      ticker: summary.ticker,
      name: summary.name,
      exchange: "US listing",
      sector: byTicker.get(summary.ticker)?.Secteur ?? null,
      currency: summary.currency,
      cik: summary.cik,
      covered: true,
    })),
  });

  // --- Data status --------------------------------------------------------
  //
  // Two different counts, kept apart: the universe is every company FinScope
  // covers and scores, while `companies` below is only those whose read state
  // the freshness endpoint reports. Collapsing them made Home claim six
  // covered companies on the same screen as a score computed against 21.
  write("data-status.json", {
    schemaVersion: SCHEMA_VERSION,
    dataVersion: DATA_VERSION,
    scoreVersion: SCORE_VERSION,
    universeVersion: universe.version,
    universeSize: universe.size,
    retrievedAt: universe.retrievedAt,
    companies: (freshness.rows ?? []).map((row) => ({
      ticker: row.ticker,
      periodEnd: row.held,
      readAt: row.readAt,
      status: row.status,
      filing: row.filed
        ? { form: row.filed.form, filingDate: row.filed.filingDate, reportDate: row.filed.reportDate, accession: row.filed.accession }
        : null,
    })),
  });

  // --- Per company --------------------------------------------------------
  for (const ticker of DETAILED) {
    const summary = summaries.find((entry) => entry.ticker === ticker);
    if (!summary) {
      console.warn(`  ! ${ticker} is not in the covered universe, skipped`);
      continue;
    }
    console.log(`\n${ticker}`);
    const dataset = await getJSON(`/api/company/${ticker}`);
    const price = prices[ticker];
    const scored = byTicker.get(ticker);
    const financial = isFinancialBusiness(dataset.company.businessType);
    const business = article(dataset.company.businessType);

    const keyMetrics = [
      {
        key: "revenueGrowth",
        label: "Revenue growth",
        detail: "Trailing twelve months against the twelve before",
        ...orUnknown(summary.revenueGrowth == null ? null : summary.revenueGrowth * 100, "The company does not publish a comparable prior period.", { unit: "percent" }),
      },
      {
        key: "roic",
        label: "Return on invested capital",
        detail: "Operating profit after tax over the capital funding it",
        ...orUnknown(
          financial ? null : summary.cashReturnOnCapital == null ? null : summary.cashReturnOnCapital * 100,
          financial
            ? `Not comparable for ${business}: borrowing is an input to this business, not a burden on it.`
            : "Invested capital cannot be built from what this company files.",
          { unit: "percent" },
        ),
      },
      {
        key: "freeCashFlowMargin",
        label: "Free cash flow margin",
        detail: "Cash left after the spending that keeps the business running",
        ...orUnknown(
          financial ? null : summary.freeCashFlowMargin == null ? null : summary.freeCashFlowMargin * 100,
          financial
            ? `Not comparable for ${business}: capital expenditure is not what its cash goes to.`
            : "The company does not publish the cash-flow figures this is built from.",
          { unit: "percent" },
        ),
      },
      {
        key: "netDebt",
        label: "Net debt",
        detail: "Borrowings less the cash held against them",
        ...orUnknown(financial ? null : summary.netDebt, financial
          ? `Not comparable for ${business}: borrowing is an input to this business, not a burden on it.`
          : "This company files no borrowing total for the period.", { unit: "currency", currency: summary.currency }),
      },
    ];

    write(`companies/${ticker}/summary.json`, {
      schemaVersion: SCHEMA_VERSION,
      dataVersion: DATA_VERSION,
      company: {
        ticker: dataset.company.ticker,
        name: dataset.company.name,
        cik: dataset.company.cik,
        exchange: dataset.company.exchange,
        sector: scored?.Secteur ?? dataset.company.sector,
        currency: dataset.company.currency,
        businessType: dataset.company.businessType,
        businessTypeLabel: businessTypeLabel(dataset.company.businessType),
        isFinancial: financial,
        regulatoryId: dataset.company.regulatoryId,
        description: dataset.company.description,
      },
      price,
      period: {
        label: summary.periodLabel,
        end: summary.periodEnd,
        frequency: "ttm",
        currency: summary.currency,
      },
      score: scored
        ? {
            total: scored.total,
            grade: scored.note,
            coverage: scored.couverture,
            scoreVersion: SCORE_VERSION,
            universeVersion: universe.version,
            universeSize: universe.size,
            pillars: Object.fromEntries(
              Object.entries(PILLAR_KEYS).map(([engine, key]) => [key, scored.piliers?.[engine] ?? null]),
            ),
          }
        : null,
      keyMetrics,
      asOf: summary.periodEnd,
      retrievedAt: summary.retrievedAt,
      warnings: dataset.warnings ?? [],
    });

    for (const frequency of ["annual", "ttm"]) {
      write(`companies/${ticker}/fundamentals-${frequency}.json`, {
        schemaVersion: SCHEMA_VERSION,
        dataVersion: DATA_VERSION,
        ticker,
        frequency,
        currency: dataset.company.currency,
        retrievedAt: dataset.retrievedAt,
        series: seriesFor(dataset, frequency),
      });
    }

    if (scored) write(`companies/${ticker}/score.json`, scorePayload(scored, universe));
  }

  console.log(`\nWritten to ${OUT}`);
}

await main();
