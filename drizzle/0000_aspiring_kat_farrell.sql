CREATE TABLE `companies` (
	`ticker` text PRIMARY KEY NOT NULL,
	`cik` text NOT NULL,
	`name` text NOT NULL,
	`exchange` text NOT NULL,
	`sector` text NOT NULL,
	`country` text,
	`currency` text NOT NULL,
	`business_type` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `companies_cik_idx` ON `companies` (`cik`);--> statement-breakpoint
CREATE INDEX `companies_sector_idx` ON `companies` (`sector`);--> statement-breakpoint
CREATE TABLE `company_snapshots` (
	`ticker` text NOT NULL,
	`data_version` text NOT NULL,
	`universe_version` text NOT NULL,
	`as_of` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`kv_key` text NOT NULL,
	`status` text NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`published_at` text,
	PRIMARY KEY(`ticker`, `data_version`)
);
--> statement-breakpoint
CREATE INDEX `company_snapshots_universe_idx` ON `company_snapshots` (`universe_version`,`ticker`);--> statement-breakpoint
CREATE INDEX `company_snapshots_freshness_idx` ON `company_snapshots` (`as_of`,`retrieved_at`);--> statement-breakpoint
CREATE TABLE `ingestion_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`universe_version` text NOT NULL,
	`data_version` text NOT NULL,
	`score_version` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`company_count` integer DEFAULT 0 NOT NULL,
	`succeeded_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ingestion_runs_publication_idx` ON `ingestion_runs` (`status`,`completed_at`);--> statement-breakpoint
CREATE INDEX `ingestion_runs_universe_idx` ON `ingestion_runs` (`universe_version`);--> statement-breakpoint
CREATE TABLE `screener_rows` (
	`ticker` text NOT NULL,
	`universe_version` text NOT NULL,
	`score_version` text NOT NULL,
	`company_name` text NOT NULL,
	`sector` text NOT NULL,
	`currency` text NOT NULL,
	`fundamentals_as_of` text NOT NULL,
	`price_as_of` text,
	`total` real,
	`quality` real,
	`health` real,
	`growth` real,
	`value` real,
	`coverage` real NOT NULL,
	`grade` text NOT NULL,
	`rank` integer NOT NULL,
	`alerts_json` text DEFAULT '[]' NOT NULL,
	`strengths_json` text DEFAULT '[]' NOT NULL,
	`weaknesses_json` text DEFAULT '[]' NOT NULL,
	`market_cap` real,
	`revenue_growth` real,
	`free_cash_flow_growth` real,
	`roic` real,
	`operating_margin` real,
	`free_cash_flow_margin` real,
	`total_debt` real,
	`enterprise_to_free_cash_flow` real,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`ticker`, `universe_version`)
);
--> statement-breakpoint
CREATE INDEX `screener_rows_score_idx` ON `screener_rows` (`universe_version`,`total`,`ticker`);--> statement-breakpoint
CREATE INDEX `screener_rows_sector_score_idx` ON `screener_rows` (`universe_version`,`sector`,`total`,`ticker`);--> statement-breakpoint
CREATE INDEX `screener_rows_market_cap_idx` ON `screener_rows` (`universe_version`,`market_cap`,`ticker`);--> statement-breakpoint
CREATE INDEX `screener_rows_rank_idx` ON `screener_rows` (`universe_version`,`rank`);