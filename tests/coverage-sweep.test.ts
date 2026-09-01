import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { businessTypeFromSic, verifiedBusinessType } from "../lib/business-type";
import { currentPeriod } from "../lib/current-period";
import { derivedValue, valueOf } from "../lib/finance";
import { shareCount } from "../lib/market-basis";
import type { CompanyDataset, CompanyProfile } from "../lib/types";



interface Row { ticker: string; type: string; error?: string; annual: number; end?: string; has: Record<string, boolean>; gaps?: Record<string, number> }
const gapCount = (periods: CompanyDataset["periods"], metric: string) => {
  const values = periods.map((period) => derivedValue(period, metric));
  const first = values.findIndex((value) => value != null);
  const fromEnd = [...values].reverse().findIndex((value) => value != null);
  if (first < 0 || fromEnd < 0) return 0;
  return values.slice(first, values.length - fromEnd).filter((value) => value == null).length;
};

/*
 * What a reader gets when they search an arbitrary US ticker.
 *
 * Every other test here fixes one company or one rule. This one asks the
 * product question instead: of the stocks somebody might type into the search
 * box, how many come back with figures on them, and where do the rest fail?
 * Run on 1 September 2026 over 110 filers sampled across the SEC registry — the
 * sixty largest, then a spread down to the long tail — it put a number on
 * things that had only been anecdotes: 27% of companies had no debt total at
 * all, 28% no readable point-in-time share count under the original mapping,
 * and 10% file under IFRS and normalize to nothing. The cover-date rule later
 * moves the share-count metric from 62/86 to 77/86 normalized filers.
 *
 * It needs the raw Company Facts payloads, which are far too large to commit,
 * so it skips itself when they are absent. To run it:
 *
 *   node scripts/fetch-coverage-sample.mjs   (writes sample.json, facts/, sic.json)
 *   COVERAGE_FIXTURES=<that directory> npx vitest run tests/coverage-sweep.test.ts
 */
const FIXTURES = process.env.COVERAGE_FIXTURES ?? "";
const available = FIXTURES !== "" && existsSync(`${FIXTURES}/sample.json`);

describe.skipIf(!available)("coverage sweep", () => {
  it("reports what a reader gets for an arbitrary US ticker", () => {
    const sample = JSON.parse(readFileSync(`${FIXTURES}/sample.json`, "utf8")) as Array<{ ticker: string; cik: string; name: string }>;
    const sic = existsSync(`${FIXTURES}/sic.json`) ? JSON.parse(readFileSync(`${FIXTURES}/sic.json`, "utf8")) as Record<string, { sic: number | null; sicDescription?: string; forms?: string[] }> : {};
    const rows: Row[] = [];
    for (const entry of sample) {
      const file = `${FIXTURES}/facts/${entry.ticker}.json`;
      if (!existsSync(file)) {
        const missing = existsSync(`${FIXTURES}/facts/${entry.ticker}.missing`) ? readFileSync(`${FIXTURES}/facts/${entry.ticker}.missing`, "utf8") : "not downloaded";
        rows.push({ ticker: entry.ticker, type: "-", error: `no companyfacts (${missing})`, annual: 0, has: {} });
        continue;
      }
      const meta = sic[entry.ticker];
      const businessType = verifiedBusinessType(entry.cik) ?? businessTypeFromSic(meta?.sic) ?? "operating";
      const profile: CompanyProfile = {
        name: entry.name, ticker: entry.ticker, cik: entry.cik, exchange: "US listing", currency: "USD",
        sector: "Unclassified", description: "Dynamically resolved.", resolutionStatus: "partial",
        businessType, sic: meta?.sic ?? undefined,
      };
      try {
        const payload = JSON.parse(readFileSync(file, "utf8"));
        const dataset = normalizeSecPayload(payload, entry.ticker, "2026-09-01T00:00:00.000Z", profile);
        const annual = dataset.periods.filter((p) => p.periodicity === "annual");
        const ttm = dataset.periods.filter((p) => p.periodicity === "ttm");
        const current = currentPeriod(dataset.periods);
        const has: Record<string, boolean> = current ? {
          revenue: derivedValue(current, "revenue") != null,
          netIncome: valueOf(current, "netIncome") != null,
          fcf: derivedValue(current, "freeCashFlow") != null,
          shares: shareCount(current) != null,
          sharesOut: valueOf(current, "sharesOutstanding") != null,
          debt: valueOf(current, "totalDebt") != null,
          cash: valueOf(current, "cashAndEquivalents") != null,
          equity: valueOf(current, "totalEquity") != null,
          netDebt: derivedValue(current, "netDebt") != null,
          roic: derivedValue(current, "roic") != null,
        } : {};
        rows.push({ ticker: entry.ticker, type: dataset.company.businessType ?? "operating", annual: annual.length, end: current?.periodEnd, has, gaps: {
          annualRevenue: gapCount(annual, "revenue"), annualNetIncome: gapCount(annual, "netIncome"),
          annualFreeCashFlow: gapCount(annual, "freeCashFlow"), ttmRevenue: gapCount(ttm, "revenue"),
          ttmNetIncome: gapCount(ttm, "netIncome"), ttmFreeCashFlow: gapCount(ttm, "freeCashFlow"),
        } });
      } catch (error) {
        rows.push({ ticker: entry.ticker, type: businessType, error: error instanceof Error ? error.message : String(error), annual: 0, has: {} });
      }
    }
    const log = (line: string) => console.log(line);
    const classify = (row: Row): string => {
      if (row.error?.includes("IFRS")) return "IFRS filer";
      if (row.error?.includes("no companyfacts")) return "no filer record at all";
      if (row.error?.includes("No standardized US GAAP")) return "no US GAAP facts";
      if (row.error) return "other error";
      if (row.annual === 0) return "no annual period built";
      if (row.end != null && row.end < "2025-06-30") return "stale: latest period " + row.end.slice(0, 4);
      const missing = Object.entries(row.has).filter(([, v]) => !v).map(([k]) => k);
      if (!missing.length) return "complete";
      if (missing.includes("revenue")) return "no revenue";
      if (missing.includes("debt")) return "no debt total";
      if (missing.includes("sharesOut")) return "no reported point-in-time share count";
      if (missing.includes("fcf")) return "no free cash flow";
      return "missing: " + missing.join(",");
    };
    const groups = new Map<string, string[]>();
    for (const row of rows) {
      const key = classify(row);
      groups.set(key, [...(groups.get(key) ?? []), row.ticker]);
    }
    log(`SWEPT ${rows.length}`);
    // Per metric, across every filer that produced a period at all: the shape
    // of the gaps rather than one label per company.
    const usable = rows.filter((row) => Object.keys(row.has).length > 0);
    const metrics = [...new Set(usable.flatMap((row) => Object.keys(row.has)))];
    for (const metric of metrics) {
      const missing = usable.filter((row) => !row.has[metric]);
      log(`METRIC ${metric.padEnd(12)} ${String(usable.length - missing.length).padStart(3)}/${usable.length} (${Math.round((usable.length - missing.length) / usable.length * 100)}%) missing: ${missing.map((row) => row.ticker).join(" ")}`);
    }
    for (const [key, tickers] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      log(`CLASS ${String(tickers.length).padStart(3)} (${Math.round(tickers.length / rows.length * 100)}%) ${key}: ${tickers.join(" ")}`);
    }
    const gapRows = rows.filter((row) => row.gaps);
    for (const metric of ["annualRevenue", "annualNetIncome", "annualFreeCashFlow", "ttmRevenue", "ttmNetIncome", "ttmFreeCashFlow"]) {
      const affected = gapRows.filter((row) => (row.gaps?.[metric] ?? 0) > 0);
      log(`GAPS ${metric} ${affected.length}/${gapRows.length}: ${affected.map((row) => `${row.ticker}:${row.gaps![metric]}`).join(" ") || "none"}`);
    }
    // Static raw fixtures turn the sweep into a regression gate, not only a
    // report. Annual revenue should be effectively continuous; TTM is allowed
    // a small residual for genuinely unpublished standardized quarters.
    expect(gapRows.filter((row) => (row.gaps?.annualRevenue ?? 0) > 0).length).toBeLessThanOrEqual(2);
    expect(gapRows.filter((row) => (row.gaps?.ttmRevenue ?? 0) > 0).length).toBeLessThanOrEqual(8);
  }, 600_000);
});
