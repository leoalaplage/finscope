import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const companies = sqliteTable("companies", {
  ticker: text("ticker").primaryKey(),
  cik: text("cik").notNull(),
  name: text("name").notNull(),
  exchange: text("exchange").notNull(),
  sector: text("sector").notNull(),
  country: text("country"),
  currency: text("currency").notNull(),
  businessType: text("business_type"),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  cikIndex: index("companies_cik_idx").on(table.cik),
  sectorIndex: index("companies_sector_idx").on(table.sector),
}));

export const companySnapshots = sqliteTable("company_snapshots", {
  ticker: text("ticker").notNull(),
  dataVersion: text("data_version").notNull(),
  universeVersion: text("universe_version").notNull(),
  asOf: text("as_of").notNull(),
  retrievedAt: text("retrieved_at").notNull(),
  kvKey: text("kv_key").notNull(),
  status: text("status").notNull(),
  warningsJson: text("warnings_json").notNull().default("[]"),
  publishedAt: text("published_at"),
}, (table) => ({
  key: primaryKey({ columns: [table.ticker, table.dataVersion] }),
  universeIndex: index("company_snapshots_universe_idx").on(table.universeVersion, table.ticker),
  freshnessIndex: index("company_snapshots_freshness_idx").on(table.asOf, table.retrievedAt),
}));

export const screenerRows = sqliteTable("screener_rows", {
  ticker: text("ticker").notNull(),
  universeVersion: text("universe_version").notNull(),
  scoreVersion: text("score_version").notNull(),
  companyName: text("company_name").notNull(),
  sector: text("sector").notNull(),
  currency: text("currency").notNull(),
  fundamentalsAsOf: text("fundamentals_as_of").notNull(),
  priceAsOf: text("price_as_of"),
  total: real("total"),
  quality: real("quality"),
  health: real("health"),
  growth: real("growth"),
  value: real("value"),
  coverage: real("coverage").notNull(),
  grade: text("grade").notNull(),
  rank: integer("rank").notNull(),
  alertsJson: text("alerts_json").notNull().default("[]"),
  strengthsJson: text("strengths_json").notNull().default("[]"),
  weaknessesJson: text("weaknesses_json").notNull().default("[]"),
  marketCap: real("market_cap"),
  revenueGrowth: real("revenue_growth"),
  freeCashFlowGrowth: real("free_cash_flow_growth"),
  roic: real("roic"),
  operatingMargin: real("operating_margin"),
  freeCashFlowMargin: real("free_cash_flow_margin"),
  totalDebt: real("total_debt"),
  enterpriseToFreeCashFlow: real("enterprise_to_free_cash_flow"),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  key: primaryKey({ columns: [table.ticker, table.universeVersion] }),
  scoreIndex: index("screener_rows_score_idx").on(table.universeVersion, table.total, table.ticker),
  sectorScoreIndex: index("screener_rows_sector_score_idx").on(table.universeVersion, table.sector, table.total, table.ticker),
  marketCapIndex: index("screener_rows_market_cap_idx").on(table.universeVersion, table.marketCap, table.ticker),
  rankIndex: index("screener_rows_rank_idx").on(table.universeVersion, table.rank),
}));

export const ingestionRuns = sqliteTable("ingestion_runs", {
  id: text("id").primaryKey(),
  universeVersion: text("universe_version").notNull(),
  dataVersion: text("data_version").notNull(),
  scoreVersion: text("score_version").notNull(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  companyCount: integer("company_count").notNull().default(0),
  succeededCount: integer("succeeded_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  errorsJson: text("errors_json").notNull().default("[]"),
}, (table) => ({
  publicationIndex: index("ingestion_runs_publication_idx").on(table.status, table.completedAt),
  universeIndex: index("ingestion_runs_universe_idx").on(table.universeVersion),
}));
