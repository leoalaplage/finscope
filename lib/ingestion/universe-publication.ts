import type { V1ScreenerRow } from "../api/v1/screener-d1";

export interface UniversePublication {
  runId: string;
  universeVersion: string;
  dataVersion: string;
  scoreVersion: string;
  startedAt: string;
  publishedAt: string;
  rows: V1ScreenerRow[];
}

/**
 * Publishes a fully computed universe in one D1 batch.
 *
 * The previous published universe is never updated or deleted. The final run
 * marker is written in the same transactional batch as the new rows, so a
 * failed statement leaves `/v1/screener` selecting the previous valid run.
 */
export async function publishUniverse(database: D1Database, publication: UniversePublication): Promise<void> {
  if (!publication.rows.length) throw new Error("Refusing to publish an empty score universe.");
  if (new Set(publication.rows.map((row) => row.ticker.toUpperCase())).size !== publication.rows.length) {
    throw new Error("Refusing to publish duplicate tickers in one score universe.");
  }

  const statements: D1PreparedStatement[] = [
    database.prepare(
      "INSERT INTO ingestion_runs (id, universe_version, data_version, score_version, status, started_at, company_count, succeeded_count, failed_count, errors_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(publication.runId, publication.universeVersion, publication.dataVersion, publication.scoreVersion, "materializing", publication.startedAt, publication.rows.length, 0, 0, "[]"),
  ];

  for (const row of publication.rows) {
    statements.push(database.prepare(
      "INSERT INTO screener_rows (ticker, universe_version, score_version, company_name, sector, currency, fundamentals_as_of, price_as_of, total, quality, health, growth, value, coverage, grade, rank, alerts_json, strengths_json, weaknesses_json, market_cap, revenue_growth, free_cash_flow_growth, roic, operating_margin, free_cash_flow_margin, total_debt, enterprise_to_free_cash_flow, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      row.ticker, publication.universeVersion, publication.scoreVersion, row.name, row.sector, row.currency,
      row.fundamentalsAsOf, row.priceAsOf, row.score.total, row.score.quality, row.score.health, row.score.growth,
      row.score.value, row.score.coverage, row.score.grade, row.score.rank, JSON.stringify(row.alerts),
      JSON.stringify(row.strengths), JSON.stringify(row.weaknesses), row.metrics.marketCap, row.metrics.revenueGrowth,
      row.metrics.fcfGrowth, row.metrics.roic, row.metrics.operatingMargin, row.metrics.fcfMargin, row.metrics.debt,
      row.metrics.valuation, publication.publishedAt,
    ));
  }

  statements.push(database.prepare(
    "UPDATE ingestion_runs SET status = ?, completed_at = ?, succeeded_count = ? WHERE id = ? AND status = ?",
  ).bind("published", publication.publishedAt, publication.rows.length, publication.runId, "materializing"));
  await database.batch(statements);
}
