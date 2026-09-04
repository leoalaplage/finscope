import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const origin = process.env.FINSCOPE_FIXTURE_ORIGIN || "https://finscope-financial-research.leoalaplage.workers.dev";
const output = resolve(process.cwd(), "contracts/v1");
const server = await createServer({ configFile: false, server: { middlewareMode: true } });

try {
  const companyModule = await server.ssrLoadModule("/lib/api/v1/company.ts");
  const contractsModule = await server.ssrLoadModule("/lib/api/v1/contracts.ts");
  const sourcesModule = await server.ssrLoadModule("/lib/api/v1/sources.ts");
  const secModule = await server.ssrLoadModule("/lib/adapters/sec.ts");
  const quotesModule = await server.ssrLoadModule("/lib/adapters/quotes.ts");
  const registryModule = await server.ssrLoadModule("/lib/company-registry.ts");
  const qsExportModule = await server.ssrLoadModule("/lib/qs-export.ts");
  const screenerModule = await server.ssrLoadModule("/lib/qs/screener.ts");
  const screenerD1Module = await server.ssrLoadModule("/lib/api/v1/screener-d1.ts");

  const datasetResponse = await fetch(`${origin}/api/company/AAPL`);
  if (!datasetResponse.ok) throw new Error(`AAPL dataset returned HTTP ${datasetResponse.status}.`);
  const dataset = await datasetResponse.json();
  if (!dataset?.company || !Array.isArray(dataset.periods)) throw new Error("AAPL dataset response is not normalized financial data.");

  const [searchProfiles, quotes, watchlistResponse] = await Promise.all([
    secModule.searchSecCompanies("AAPL", { limit: 6 }),
    quotesModule.fetchQuotes(["AAPL", "MSFT"]),
    fetch(`${origin}/api/watchlist`).then((response) => {
      if (!response.ok) throw new Error(`Watchlist returned HTTP ${response.status}.`);
      return response.json();
    }),
  ]);
  const generatedAt = new Date().toISOString();
  const wrap = (data, meta = {}) => ({ meta: contractsModule.v1Meta({ retrievedAt: generatedAt, ...meta }), data });
  const write = (name, value) => writeFileSync(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`);
  mkdirSync(output, { recursive: true });

  const summary = companyModule.companySummary(dataset);
  if (!summary) throw new Error("AAPL has no normalized period.");
  const fundamentals = companyModule.companyFundamentals(dataset, ["revenue", "eps", "fcf"], "annual");
  const sources = sourcesModule.companySources(dataset, "revenue", summary.latestPeriod.periodEnd);
  write("search.json", wrap({ query: "AAPL", results: searchProfiles.map(companyModule.searchItem), nextCursor: null }, {
    dataVersion: "sec-company-registry-v1", asOf: generatedAt.slice(0, 10), status: "reported",
  }));
  write("company-summary-aapl.json", wrap(summary, {
    dataVersion: contractsModule.FINANCIAL_DATA_VERSION, asOf: summary.latestPeriod.periodEnd,
    retrievedAt: dataset.retrievedAt, currency: dataset.company.currency, frequency: summary.latestPeriod.frequency,
    status: "calculated", warnings: dataset.warnings,
  }));
  write("fundamentals-aapl.json", wrap(fundamentals, {
    dataVersion: contractsModule.FINANCIAL_DATA_VERSION,
    asOf: fundamentals.series.flatMap((series) => series.values).map((value) => value.periodEnd).sort().at(-1) || null,
    retrievedAt: dataset.retrievedAt, currency: dataset.company.currency, frequency: "annual", status: "calculated", warnings: dataset.warnings,
  }));
  write("sources-aapl-revenue.json", wrap(sources, {
    dataVersion: contractsModule.FINANCIAL_DATA_VERSION, asOf: sources?.period || null,
    retrievedAt: dataset.retrievedAt, currency: dataset.company.currency, status: "reported", warnings: dataset.warnings,
  }));
  write("quotes-aapl-msft.json", wrap({ quotes: quotes.map((quote) => ({ ...quote, status: quote.price == null ? "unavailable" : "reported" })) }, {
    dataVersion: "market-quotes-v1", asOf: quotes.map((quote) => quote.asOf).filter(Boolean).sort().at(-1) || null,
    frequency: "live", status: "reported",
  }));

  const summaries = Array.isArray(watchlistResponse.summaries) ? watchlistResponse.summaries : [];
  if (summaries.length !== registryModule.COVERED_TICKERS.length) {
    throw new Error(`Refusing an incomplete score fixture universe: ${summaries.length} of ${registryModule.COVERED_TICKERS.length} companies.`);
  }
  const universeQuotes = await quotesModule.fetchQuotes(summaries.map((item) => item.ticker));
  const quoteBySymbol = new Map(universeQuotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
  const structured = summaries.map((item) => {
    const quote = quoteBySymbol.get(item.ticker.toUpperCase());
    const values = { ...item.qs, ...qsExportModule.qsValuationColumns(item.qsPrice, quote?.price ?? null, quote?.currency ?? null) };
    return qsExportModule.qsStructuredInputFromRow({ ticker: item.ticker, values });
  });
  const scored = screenerModule.screenStructured(structured).all;
  const summaryByTicker = new Map(summaries.map((item) => [item.ticker.toUpperCase(), item]));
  const scoreData = (row) => {
    const item = summaryByTicker.get(row.Ticker.toUpperCase());
    const quote = quoteBySymbol.get(row.Ticker.toUpperCase());
    return {
      ticker: row.Ticker, scoreVersion: contractsModule.QUALITY_SCORE_VERSION,
      universeVersion: contractsModule.WATCHLIST_UNIVERSE_VERSION,
      fundamentalsAsOf: item?.periodEnd ?? "", priceAsOf: quote?.asOf ?? null,
      total: row.total, quality: row.piliers.Quality, health: row.piliers.Health,
      growth: row.piliers.Growth, value: row.piliers.Value, coverage: row.couverture,
      grade: row.note, rank: row.rang, alerts: row.alertes_detail,
      strengths: row.forces.map(([name]) => name), weaknesses: row.faiblesses.map(([name]) => name),
      units: { total: "score-0-100", pillars: "score-0-100", coverage: "ratio-0-1", rank: "ordinal" },
    };
  };
  const appleScore = scored.find((row) => row.Ticker.toUpperCase() === "AAPL");
  if (!appleScore) throw new Error("AAPL is missing from the real cached score universe.");
  const appleScoreData = scoreData(appleScore);
  write("quality-score-aapl.json", wrap(appleScoreData, {
    dataVersion: contractsModule.WATCHLIST_UNIVERSE_VERSION, scoreVersion: contractsModule.QUALITY_SCORE_VERSION,
    asOf: appleScoreData.priceAsOf ?? appleScoreData.fundamentalsAsOf, unit: "score-0-100",
    frequency: "point-in-time", status: "calculated",
  }));

  const screenerRows = [...scored].sort((left, right) => left.rang - right.rang).map((row) => {
    const item = summaryByTicker.get(row.Ticker.toUpperCase());
    const quote = quoteBySymbol.get(row.Ticker.toUpperCase());
    return {
      ticker: row.Ticker, name: item?.name ?? row.Ticker, sector: row.Secteur, currency: item?.currency ?? "USD",
      fundamentalsAsOf: item?.periodEnd ?? "", priceAsOf: quote?.asOf ?? null,
      score: { total: row.total, quality: row.piliers.Quality, health: row.piliers.Health, growth: row.piliers.Growth, value: row.piliers.Value, coverage: row.couverture, grade: row.note, rank: row.rang },
      metrics: {
        marketCap: row.Cap == null ? null : row.Cap * 1e9,
        revenueGrowth: row.brut.Rev5 == null ? null : row.brut.Rev5 / 100,
        fcfGrowth: row.brut.LevFCF5 == null ? null : row.brut.LevFCF5 / 100,
        roic: row.brut.ROIC == null ? null : row.brut.ROIC / 100,
        operatingMargin: row.brut.OpM == null ? null : row.brut.OpM / 100,
        fcfMargin: row.brut.FCFM5 == null ? null : row.brut.FCFM5 / 100,
        debt: null, valuation: row.brut.EV_FCF,
      },
      alerts: row.alertes_detail, strengths: row.forces.map(([name]) => name), weaknesses: row.faiblesses.map(([name]) => name),
    };
  });
  write("screener.json", wrap({
    universeVersion: contractsModule.WATCHLIST_UNIVERSE_VERSION,
    scoreVersion: contractsModule.QUALITY_SCORE_VERSION,
    publishedAt: generatedAt, rows: screenerRows, units: screenerD1Module.V1_SCREENER_UNITS, nextCursor: null,
  }, {
    dataVersion: contractsModule.WATCHLIST_UNIVERSE_VERSION, scoreVersion: contractsModule.QUALITY_SCORE_VERSION,
    asOf: generatedAt, unit: "mixed", frequency: "point-in-time", status: "calculated",
  }));
  write("data-status.json", wrap({
    service: "degraded",
    financials: { available: true, dataVersion: contractsModule.FINANCIAL_DATA_VERSION },
    qualityScore: { available: true, scoreVersion: contractsModule.QUALITY_SCORE_VERSION, universeVersion: contractsModule.WATCHLIST_UNIVERSE_VERSION },
    screener: { available: false, universeVersion: null },
  }, {
    dataVersion: contractsModule.FINANCIAL_DATA_VERSION, scoreVersion: contractsModule.QUALITY_SCORE_VERSION,
    asOf: generatedAt, frequency: "point-in-time", status: "unavailable",
    warnings: ["D1 screener index is not bound; indexed screener results are unavailable."],
  }));
} finally {
  await server.close();
}
