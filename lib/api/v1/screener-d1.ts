export const V1_SCREENER_SORTS = ["score", "rank", "marketCap", "revenueGrowth", "fcfGrowth", "roic", "operatingMargin", "fcfMargin", "debt", "valuation"] as const;
export type V1ScreenerSort = typeof V1_SCREENER_SORTS[number];
export const V1_SCREENER_UNITS = {
  score: "score-0-100",
  coverage: "ratio-0-1",
  rank: "ordinal",
  marketCap: "currency",
  revenueGrowth: "percent",
  fcfGrowth: "percent",
  roic: "percent",
  operatingMargin: "percent",
  fcfMargin: "percent",
  debt: "currency",
  valuation: "ratio",
} as const;

export interface V1ScreenerQuery {
  minScore?: number;
  sector?: string;
  sort: V1ScreenerSort;
  cursor?: string | null;
  limit?: number;
}

export interface V1ScreenerRow {
  ticker: string;
  name: string;
  sector: string;
  currency: string;
  fundamentalsAsOf: string;
  priceAsOf: string | null;
  score: { total: number | null; quality: number | null; health: number | null; growth: number | null; value: number | null; coverage: number; grade: string; rank: number };
  metrics: { marketCap: number | null; revenueGrowth: number | null; fcfGrowth: number | null; roic: number | null; operatingMargin: number | null; fcfMargin: number | null; debt: number | null; valuation: number | null };
  alerts: string[];
  strengths: string[];
  weaknesses: string[];
}

interface D1ScreenerRecord {
  ticker: string; company_name: string; sector: string; currency: string; fundamentals_as_of: string; price_as_of: string | null;
  total: number | null; quality: number | null; health: number | null; growth: number | null; value: number | null; coverage: number; grade: string; rank: number;
  alerts_json: string; strengths_json: string; weaknesses_json: string;
  market_cap: number | null; revenue_growth: number | null; free_cash_flow_growth: number | null; roic: number | null;
  operating_margin: number | null; free_cash_flow_margin: number | null; total_debt: number | null; enterprise_to_free_cash_flow: number | null;
}

const SORT_SQL: Record<V1ScreenerSort, string> = {
  score: "(total IS NULL) ASC, total DESC, ticker ASC",
  rank: "rank ASC, ticker ASC",
  marketCap: "(market_cap IS NULL) ASC, market_cap DESC, ticker ASC",
  revenueGrowth: "(revenue_growth IS NULL) ASC, revenue_growth DESC, ticker ASC",
  fcfGrowth: "(free_cash_flow_growth IS NULL) ASC, free_cash_flow_growth DESC, ticker ASC",
  roic: "(roic IS NULL) ASC, roic DESC, ticker ASC",
  operatingMargin: "(operating_margin IS NULL) ASC, operating_margin DESC, ticker ASC",
  fcfMargin: "(free_cash_flow_margin IS NULL) ASC, free_cash_flow_margin DESC, ticker ASC",
  debt: "(total_debt IS NULL) ASC, total_debt ASC, ticker ASC",
  valuation: "(enterprise_to_free_cash_flow IS NULL) ASC, enterprise_to_free_cash_flow ASC, ticker ASC",
};

function offsetFromCursor(cursor: string | null | undefined): number | null {
  if (!cursor) return 0;
  const match = /^v1:(\d+)$/.exec(cursor);
  if (!match) return null;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
}

function strings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function queryPublishedScreener(database: D1Database, query: V1ScreenerQuery) {
  const offset = offsetFromCursor(query.cursor);
  if (offset == null) throw new Error("invalid_cursor");
  const limit = Math.max(1, Math.min(50, Math.floor(query.limit ?? 30)));
  const published = await database.prepare(
    "SELECT universe_version, score_version, completed_at FROM ingestion_runs WHERE status = ? ORDER BY completed_at DESC LIMIT 1",
  ).bind("published").first<{ universe_version: string; score_version: string; completed_at: string }>();
  if (!published) return null;

  const clauses = ["universe_version = ?"];
  const bindings: Array<string | number> = [published.universe_version];
  if (query.minScore != null) { clauses.push("total >= ?"); bindings.push(query.minScore); }
  if (query.sector) { clauses.push("sector = ?"); bindings.push(query.sector); }
  bindings.push(limit + 1, offset);
  const statement = `SELECT * FROM screener_rows WHERE ${clauses.join(" AND ")} ORDER BY ${SORT_SQL[query.sort]} LIMIT ? OFFSET ?`;
  const result = await database.prepare(statement).bind(...bindings).all<D1ScreenerRecord>();
  const records = result.results.slice(0, limit);
  const rows: V1ScreenerRow[] = records.map((row) => ({
    ticker: row.ticker,
    name: row.company_name,
    sector: row.sector,
    currency: row.currency,
    fundamentalsAsOf: row.fundamentals_as_of,
    priceAsOf: row.price_as_of,
    score: { total: row.total, quality: row.quality, health: row.health, growth: row.growth, value: row.value, coverage: row.coverage, grade: row.grade, rank: row.rank },
    metrics: {
      marketCap: row.market_cap, revenueGrowth: row.revenue_growth, fcfGrowth: row.free_cash_flow_growth,
      roic: row.roic, operatingMargin: row.operating_margin, fcfMargin: row.free_cash_flow_margin,
      debt: row.total_debt, valuation: row.enterprise_to_free_cash_flow,
    },
    alerts: strings(row.alerts_json), strengths: strings(row.strengths_json), weaknesses: strings(row.weaknesses_json),
  }));
  return {
    universeVersion: published.universe_version,
    scoreVersion: published.score_version,
    publishedAt: published.completed_at,
    rows,
    units: V1_SCREENER_UNITS,
    nextCursor: result.results.length > limit ? `v1:${offset + limit}` : null,
  };
}
