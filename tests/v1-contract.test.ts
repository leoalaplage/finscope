import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { companyFundamentals, companySummary } from "../lib/api/v1/company";
import { entityTag, jsonResponse, v1Error } from "../lib/api/v1/http";
import { financialValue, parseV1Metrics } from "../lib/api/v1/metrics";
import { qsRow, qsStructuredInputFromRow, qsTable, type QsRow } from "../lib/qs-export";
import { screen, screenStructured } from "../lib/qs/screener";
import type { CompanyDataset, FinancialPeriod, MetricKey } from "../lib/types";

const realSummary = JSON.parse(readFileSync(new URL("../contracts/v1/company-summary-aapl.json", import.meta.url), "utf8"));
const realFundamentals = JSON.parse(readFileSync(new URL("../contracts/v1/fundamentals-aapl.json", import.meta.url), "utf8"));
const realScore = JSON.parse(readFileSync(new URL("../contracts/v1/quality-score-aapl.json", import.meta.url), "utf8"));

const shareMetrics = new Set<MetricKey>(["basicShares", "dilutedShares", "sharesOutstanding", "sharesIssued", "treasuryShares"]);

function period(
  periodEnd: string,
  facts: Partial<Record<MetricKey, number>>,
  options: { currency?: string; periodicity?: FinancialPeriod["periodicity"]; fiscalYear?: number; status?: "reported" | "restated" } = {},
): FinancialPeriod {
  const currency = options.currency ?? "USD";
  const periodicity = options.periodicity ?? "annual";
  const fiscalYear = options.fiscalYear ?? Number(periodEnd.slice(0, 4));
  return {
    label: `${periodicity === "annual" ? "FY" : periodicity.toUpperCase()} ${fiscalYear}`,
    fiscalYear, periodStart: `${fiscalYear - 1}-10-01`, periodEnd, periodicity,
    filingDate: `${fiscalYear + 1}-01-30`, accession: `accession-${fiscalYear}`, currency,
    facts: Object.fromEntries(Object.entries(facts).map(([metric, value]) => [metric, {
      metric, value, currency, unit: shareMetrics.has(metric as MetricKey) ? "shares" : "currency",
      periodStart: `${fiscalYear - 1}-10-01`, periodEnd, periodicity, fiscalYear,
      provenance: {
        provider: "SEC", sourceUrl: `https://www.sec.gov/Archives/${fiscalYear}`,
        accession: `accession-${fiscalYear}`, filingDate: `${fiscalYear + 1}-01-30`,
        retrievedAt: "2026-09-01T00:00:00.000Z", concept: metric,
        status: options.status ?? "reported",
      },
    }])) as FinancialPeriod["facts"],
  };
}

function dataset(ticker: string, periods: FinancialPeriod[], options: Partial<CompanyDataset["company"]> = {}): CompanyDataset {
  return {
    company: {
      ticker, name: `${ticker} Corporation`, cik: "0000000001", exchange: "NASDAQ", currency: periods[0]?.currency ?? "USD",
      sector: "Technology", description: "Golden contract test company.", resolutionStatus: "verified", businessType: "operating", ...options,
    },
    periods, retrievedAt: "2026-09-01T00:00:00.000Z", warnings: [],
  };
}

describe("v1 real AAPL golden fixtures", () => {
  it("locks the audited values, periods, units, statuses, and Quality Score", () => {
    const latest = Object.fromEntries(realFundamentals.data.series.map((series: { metric: string; values: unknown[] }) => [series.metric, series.values.at(-1)]));
    expect(latest).toMatchObject({
      revenue: { value: 416_161_000_000, periodEnd: "2025-09-27", unit: "currency", status: "reported" },
      eps: { value: 7.464995794316939, periodEnd: "2025-09-27", unit: "perShare", status: "calculated" },
      fcf: { value: 98_767_000_000, periodEnd: "2025-09-27", unit: "currency", status: "calculated" },
    });
    expect(realSummary.data).toMatchObject({ company: { ticker: "AAPL", currency: "USD" }, latestPeriod: { periodEnd: "2026-06-27", frequency: "ttm" } });
    expect(realScore.data).toMatchObject({ ticker: "AAPL", scoreVersion: "qs-v3", universeVersion: "watchlist-v1-v23", total: 53.40312506915342, coverage: 0.85, grade: "B+", rank: 11 });
  });

  it("keeps mobile projections compact and excludes full provenance by default", () => {
    const body = JSON.stringify(realSummary);
    expect(body.length).toBeLessThan(10_000);
    expect(body).not.toContain("sourceAccessions");
    expect(JSON.stringify(realFundamentals).length).toBeLessThan(30_000);
  });
});

describe("v1 financial edge-case goldens", () => {
  const complete = { revenue: 1_000, netIncome: 100, operatingIncome: 180, operatingCashFlow: 220, capitalExpenditures: 40, dilutedShares: 100, sharesOutstanding: 90, totalDebt: 300, totalEquity: 700, cashAndEquivalents: 100, incomeBeforeTax: 125, incomeTaxExpense: 25 } satisfies Partial<Record<MetricKey, number>>;

  it("preserves a loss and does not turn it into missing data", () => {
    const value = financialValue(period("2025-09-27", { ...complete, netIncome: -50 }), "eps");
    expect(value).toMatchObject({ value: -0.5, status: "calculated", unit: "perShare" });
  });

  it("suppresses industrial measures for a financial institution", () => {
    const bank = companySummary(dataset("JPM", [period("2025-12-31", complete)], { businessType: "bank", sector: "Banks" }))!;
    expect(bank.metrics.revenue.status).toBe("reported");
    for (const metric of ["fcf", "fcfMargin", "netDebt", "roic"]) {
      expect(bank.metrics[metric]).toMatchObject({ value: null, status: "unavailable" });
    }
  });

  it("carries a foreign issuer's statement currency without conversion", () => {
    const foreign = companyFundamentals(dataset("ASML", [period("2025-12-31", complete, { currency: "EUR" })], { currency: "EUR" }), ["revenue", "eps"], "annual");
    expect(foreign.series[0]).toMatchObject({ currency: "EUR", unit: "currency" });
    expect(foreign.series[1]).toMatchObject({ currency: "EUR", unit: "perShare" });
  });

  it("orders shifted fiscal years by actual period end", () => {
    const result = companyFundamentals(dataset("AAPL", [
      period("2025-09-27", complete, { fiscalYear: 2025 }),
      period("2024-09-28", { ...complete, revenue: 800 }, { fiscalYear: 2024 }),
    ]), ["revenue"], "annual");
    expect(result.series[0].values.map((value) => [value.fiscalYear, value.periodEnd, value.value])).toEqual([
      [2024, "2024-09-28", 800], [2025, "2025-09-27", 1_000],
    ]);
  });

  it("keeps missing dependencies unavailable and reported restatements explicit", () => {
    expect(financialValue(period("2025-12-31", { revenue: 1_000, operatingCashFlow: 200 }), "fcf")).toMatchObject({ value: null, status: "unavailable" });
    expect(financialValue(period("2025-12-31", { revenue: 1_000 }, { status: "restated" }), "revenue")).toMatchObject({ value: 1_000, status: "restated" });
  });
});

describe("structured Quality Score input", () => {
  const columns = (ticker: string, strength: number): QsRow => ({ ticker, values: {
    Ticker: ticker, Sector: "Technology", "Market Cap": 100 + strength,
    ROIC: 10 + strength, "ROIC 5Yr Avg": 9 + strength, "Operating Margin": 15 + strength,
    "FCF Margin 5Yr Avg": 12 + strength, "FCF / Net Income": 80 + strength, "Gross Margin 5Yr Avg": 40 + strength,
    "Shares Outstanding 5Y CAGR": 2 - strength / 10, "SBC to Revenue": 8 - strength / 10,
    "Net Debt / EBITDA": 3 - strength / 20, "EBIT / Interest Expense": 5 + strength, "Current Ratio": 1 + strength / 20,
    "Long-term Debt to Assets": 0.4 - strength / 100, "OCF/Capex": 2 + strength / 10,
    "Revenue 5Y CAGR": 5 + strength, "FCF 5Y CAGR": 4 + strength, "Net Income 5Y CAGR": 3 + strength,
    "EV/EBIT": 30 - strength / 2, "EV/FCF": 35 - strength / 2, "FCF Yield": 2 + strength / 10,
    OCF: 10 + strength, Capex: 3,
  } });
  const rows = [columns("AAPL", 20), columns("MSFT", 15), columns("LOSS", 0)];

  it("is exactly equivalent to the legacy generated CSV path", () => {
    const legacy = screen(qsTable(rows));
    const structured = screenStructured(rows.map(qsStructuredInputFromRow));
    expect(structured).toEqual(legacy);
  });

  it("keeps the existing dataset-to-CSV adapter available", () => {
    expect(qsRow(dataset("AAPL", [period("2025-09-27", { revenue: 1_000 })]), null).ticker).toBe("AAPL");
  });
});

describe("v1 HTTP contract", () => {
  it("returns stable ETags and 304 for a matching representation", async () => {
    const body = JSON.stringify({ data: { value: 1 } });
    const etag = entityTag(body);
    const first = jsonResponse(new Request("https://example.test/v1/test"), { data: { value: 1 } });
    expect(first.headers.get("ETag")).toBe(etag);
    const cached = jsonResponse(new Request("https://example.test/v1/test", { headers: { "If-None-Match": etag } }), { data: { value: 1 } });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
  });

  it("uses a typed error envelope and validates metric aliases", async () => {
    const response = v1Error(new Request("https://example.test/v1/test"), 400, "invalid_request", "Bad input", { retryable: false });
    expect(await response.json()).toMatchObject({ meta: { schemaVersion: "1.0.0", status: "unavailable" }, error: { code: "invalid_request", retryable: false } });
    expect(parseV1Metrics("revenue,eps,fcf")).toEqual({ metrics: ["revenue", "eps", "fcf"], invalid: [] });
    expect(parseV1Metrics("revenue,magic")).toEqual({ metrics: ["revenue"], invalid: ["magic"] });
  });
});
