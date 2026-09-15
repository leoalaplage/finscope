import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { companyView, type IoCompanyView } from "../lib/io/view";
import type { BusinessType } from "../lib/types";

/**
 * Thirty real companies, held to the figures their own annual reports state.
 *
 * Every repair to the normalizer so far was made for one company and checked
 * on that one company; the next repair could quietly undo it somewhere else,
 * and twice nearly did — copying capital expenditure across two names mended
 * Arista and broke Fortive. These are the hard cases in one place: a bank, an
 * insurer, a holding company, an IFRS filer, a 52-week year, three stock
 * splits, a fiscal year ending in January, and every company whose figures
 * were corrected this month.
 *
 * The expected figures are not this engine's output written down. Each 2024
 * figure below is the value filed in that company's 10-K (or 20-F) for the
 * year, checked against the filing's own facts when the fixture was cut; the
 * repairs are asserted by what the filer itself published. The fixtures are
 * the companies' SEC company-facts documents cut to the concepts this adapter
 * reads, refreshed with scripts/fetch-golden.mjs.
 */

type Case = {
  cik: string; type?: BusinessType; currency?: string; year: string;
  revenue: number; netIncome: number; operatingCashFlow: number; capex: number | null; fcf: number | null;
  latest: string; maxTtmGaps: number;
};

// Billions, as filed for the fiscal year. `latest` is the newest period in the fixture.
const GOLDEN: Record<string, Case> = {
  AAPL: { cik: "0000320193", year: "FY 2024", revenue: 391.035, netIncome: 93.736, operatingCashFlow: 118.254, capex: 9.447, fcf: 108.807, latest: "TTM Q3 FY2026", maxTtmGaps: 1 },
  NVDA: { cik: "0001045810", year: "FY 2024", revenue: 60.922, netIncome: 29.760, operatingCashFlow: 28.090, capex: 1.069, fcf: 27.021, latest: "TTM Q2 FY2027", maxTtmGaps: 45 },
  MSFT: { cik: "0000789019", year: "FY 2024", revenue: 245.122, netIncome: 88.136, operatingCashFlow: 118.548, capex: 44.477, fcf: 74.071, latest: "TTM Q4 FY2026", maxTtmGaps: 0 },
  AMZN: { cik: "0001018724", year: "FY 2024", revenue: 637.959, netIncome: 59.248, operatingCashFlow: 115.877, capex: 82.999, fcf: 32.878, latest: "TTM Q2 FY2026", maxTtmGaps: 0 },
  MA: { cik: "0001141391", year: "FY 2024", revenue: 28.167, netIncome: 12.874, operatingCashFlow: 14.780, capex: 0.474, fcf: 14.306, latest: "TTM Q2 FY2026", maxTtmGaps: 0 },
  INTU: { cik: "0000896878", year: "FY 2024", revenue: 16.285, netIncome: 2.963, operatingCashFlow: 4.884, capex: 0.191, fcf: 4.693, latest: "TTM Q4 FY2026", maxTtmGaps: 3 },
  HIMS: { cik: "0001773751", year: "FY 2024", revenue: 1.477, netIncome: 0.126, operatingCashFlow: 0.251, capex: 0.053, fcf: 0.198, latest: "TTM Q2 FY2026", maxTtmGaps: 0 },
  ECL: { cik: "0000031462", year: "FY 2024", revenue: 15.741, netIncome: 2.112, operatingCashFlow: 2.814, capex: 0.995, fcf: 1.819, latest: "TTM Q2 FY2026", maxTtmGaps: 0 },
  VLO: { cik: "0001035002", year: "FY 2024", revenue: 129.881, netIncome: 2.770, operatingCashFlow: 6.683, capex: 2.057, fcf: 4.626, latest: "TTM Q2 FY2026", maxTtmGaps: 30 },
  URI: { cik: "0001067701", year: "FY 2024", revenue: 15.345, netIncome: 2.575, operatingCashFlow: 4.546, capex: 4.130, fcf: 0.416, latest: "TTM Q1 FY2026", maxTtmGaps: 9 },
  ANET: { cik: "0001596532", year: "FY 2024", revenue: 7.003, netIncome: 2.852, operatingCashFlow: 3.708, capex: 0.032, fcf: 3.676, latest: "TTM Q2 FY2026", maxTtmGaps: 1 },
  VZ: { cik: "0000732712", year: "FY 2024", revenue: 134.788, netIncome: 17.506, operatingCashFlow: 36.912, capex: 17.090, fcf: 19.822, latest: "TTM Q2 FY2026", maxTtmGaps: 6 },
  DAL: { cik: "0000027904", year: "FY 2024", revenue: 61.643, netIncome: 3.457, operatingCashFlow: 8.025, capex: 5.140, fcf: 2.885, latest: "TTM Q2 FY2026", maxTtmGaps: 12 },
  FTV: { cik: "0001659166", year: "FY 2024", revenue: 4.081, netIncome: 0.833, operatingCashFlow: 1.527, capex: 0.086, fcf: 1.441, latest: "TTM Q1 FY2026", maxTtmGaps: 0 },
  RSG: { cik: "0001060391", year: "FY 2024", revenue: 18.418, netIncome: 2.043, operatingCashFlow: 3.936, capex: 1.855, fcf: 2.081, latest: "TTM Q2 FY2026", maxTtmGaps: 0 },
  JPM: { cik: "0000019617", type: "bank", year: "FY 2024", revenue: 177.556, netIncome: 58.471, operatingCashFlow: -42.012, capex: null, fcf: null, latest: "TTM Q2 FY2026", maxTtmGaps: 63 },
  TRV: { cik: "0000086312", type: "insurer", year: "FY 2024", revenue: 46.423, netIncome: 4.999, operatingCashFlow: 9.074, capex: null, fcf: 9.074, latest: "TTM Q2 FY2026", maxTtmGaps: 0 },
  UNH: { cik: "0000731766", year: "FY 2024", revenue: 400.278, netIncome: 14.405, operatingCashFlow: 24.204, capex: 3.499, fcf: 20.705, latest: "TTM Q2 FY2026", maxTtmGaps: 0 },
  "BRK-B": { cik: "0001067983", type: "holding", year: "FY 2024", revenue: 371.433, netIncome: 88.995, operatingCashFlow: 30.592, capex: 18.976, fcf: 11.616, latest: "TTM Q2 FY2026", maxTtmGaps: 0 },
  IVZ: { cik: "0000914208", year: "FY 2024", revenue: 6.067, netIncome: 0.538, operatingCashFlow: 1.190, capex: 0.069, fcf: 1.121, latest: "TTM Q2 FY2026", maxTtmGaps: 0 },
  PLD: { cik: "0001045609", year: "FY 2024", revenue: 8.202, netIncome: 3.732, operatingCashFlow: 4.912, capex: 3.206, fcf: 1.706, latest: "TTM Q1 FY2026", maxTtmGaps: 2 },
  ASML: { cik: "0000937966", currency: "EUR", year: "FY 2024", revenue: 28.263, netIncome: 7.572, operatingCashFlow: 11.166, capex: 2.067, fcf: 9.099, latest: "FY 2025", maxTtmGaps: 0 },
  TSM: { cik: "0001046179", currency: "TWD", year: "FY 2024", revenue: 2894.308, netIncome: 1158.380, operatingCashFlow: 1826.177, capex: 956.006, fcf: 870.171, latest: "FY 2024", maxTtmGaps: 0 },
  COST: { cik: "0000909832", year: "FY 2024", revenue: 254.453, netIncome: 7.367, operatingCashFlow: 11.339, capex: 4.710, fcf: 6.629, latest: "TTM Q3 FY2026", maxTtmGaps: 1 },
  CPRT: { cik: "0000900075", year: "FY 2024", revenue: 4.237, netIncome: 1.363, operatingCashFlow: 1.473, capex: 0.511, fcf: 0.962, latest: "TTM Q3 FY2026", maxTtmGaps: 3 },
  KO: { cik: "0000021344", year: "FY 2024", revenue: 47.061, netIncome: 10.631, operatingCashFlow: 6.805, capex: 2.064, fcf: 4.741, latest: "TTM Q1 FY2026", maxTtmGaps: 5 },
  BKNG: { cik: "0001075531", year: "FY 2024", revenue: 23.739, netIncome: 5.882, operatingCashFlow: 8.323, capex: 0.429, fcf: 7.894, latest: "TTM Q2 FY2026", maxTtmGaps: 0 },
  ADBE: { cik: "0000796343", year: "FY 2024", revenue: 21.505, netIncome: 5.560, operatingCashFlow: 8.056, capex: 0.183, fcf: 7.873, latest: "TTM Q2 FY2026", maxTtmGaps: 0 },
  LLY: { cik: "0000059478", year: "FY 2024", revenue: 45.043, netIncome: 10.590, operatingCashFlow: 8.818, capex: 5.058, fcf: 3.760, latest: "TTM Q2 FY2026", maxTtmGaps: 36 },
  CELH: { cik: "0001341766", year: "FY 2024", revenue: 1.356, netIncome: 0.145, operatingCashFlow: 0.263, capex: 0.023, fcf: 0.240, latest: "TTM Q2 FY2026", maxTtmGaps: 10 },
};

const fixture = (ticker: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/golden/${ticker.toLowerCase()}.json.gz`, import.meta.url))).toString("utf8"));

const views = new Map<string, IoCompanyView>();
const viewOf = (ticker: string): IoCompanyView => {
  const cached = views.get(ticker);
  if (cached) return cached;
  const golden = GOLDEN[ticker];
  const payload = fixture(ticker);
  const view = companyView(normalizeSecPayload(payload, ticker, "2026-09-15T00:00:00Z", {
    name: payload.entityName, ticker, yahooTicker: ticker, cik: golden.cik, regulatoryId: `CIK ${golden.cik}`,
    exchange: "NYSE", currency: golden.currency ?? "USD", sector: "", description: "",
    businessType: golden.type ?? "operating", resolutionStatus: "verified",
  }));
  views.set(ticker, view);
  return view;
};
const billions = (value: number | null | undefined) => (value == null ? null : value / 1e9);
const period = (view: IoCompanyView, label: string, kind: "annual" | "trailing" = "annual") => view[kind].find((each) => each.label === label);

describe("thirty companies against their own annual reports", () => {
  for (const [ticker, golden] of Object.entries(GOLDEN)) {
    it(`${ticker}: ${golden.year} as filed, and its newest period`, () => {
      const view = viewOf(ticker);
      const year = period(view, golden.year);
      expect(year, `${ticker} ${golden.year}`).toBeDefined();
      expect(billions(year!.values.revenue)).toBeCloseTo(golden.revenue, 2);
      expect(billions(year!.values.netIncome)).toBeCloseTo(golden.netIncome, 2);
      expect(billions(year!.values.operatingCashFlow)).toBeCloseTo(golden.operatingCashFlow, 2);
      if (golden.capex == null) expect(year!.values.capitalExpenditures).toBeNull();
      else expect(billions(year!.values.capitalExpenditures)).toBeCloseTo(golden.capex, 2);
      if (golden.fcf == null) expect(year!.values.freeCashFlow).toBeNull();
      else expect(billions(year!.values.freeCashFlow)).toBeCloseTo(golden.fcf, 2);
      expect(view.company.currency).toBe(golden.currency ?? "USD");
      expect(view.ttm?.label ?? view.annual.at(-1)?.label).toBe(golden.latest);
      /*
       * A ratchet, not a target: how many trailing periods lack free cash flow
       * today. A change that fills one is welcome and lowers the number here; a
       * change that empties one fails.
       */
      const gaps = view.trailing.filter((each) => each.values.freeCashFlow == null).length;
      expect(gaps, `${ticker} trailing periods without free cash flow`).toBeLessThanOrEqual(golden.maxTtmGaps);
    });
  }
});

describe("the repairs, held on the companies they were made for", () => {
  it("sums Hims's capital expenditure from the parts it tagged, leaving no trailing period without free cash flow", () => {
    expect(viewOf("HIMS").trailing.every((each) => each.values.freeCashFlow != null)).toBe(true);
  });

  it("reads Valero's and Ecolab's capital expenditure under one definition, the one each uses today", () => {
    /*
     * Both file two capital-expenditure lines for many years. The normalizer
     * used to take whichever was filed last, so Valero left out turnarounds for
     * 2011–2015 and included them after. Each company is now read under the
     * name its latest annual figure uses, wherever it filed that name.
     */
    // Valero today reports payments for productive assets, turnarounds included.
    expect(billions(period(viewOf("VLO"), "FY 2013")?.values.capitalExpenditures)).toBeCloseTo(2.755, 2);
    expect(billions(period(viewOf("VLO"), "FY 2015")?.values.capitalExpenditures)).toBeCloseTo(2.350, 2);
    expect(billions(period(viewOf("VLO"), "FY 2017")?.values.capitalExpenditures)).toBeCloseTo(1.948, 2);
    // Ecolab today reports payments for property, plant and equipment, software apart.
    expect(billions(period(viewOf("ECL"), "FY 2012")?.values.capitalExpenditures)).toBeCloseTo(0.575, 2);
    expect(billions(period(viewOf("ECL"), "FY 2015")?.values.capitalExpenditures)).toBeCloseTo(0.771, 2);
    expect(billions(period(viewOf("ECL"), "FY 2017")?.values.capitalExpenditures)).toBeCloseTo(0.869, 2);
  });

  it("reads Verizon's capital expenditure, filed only as other productive assets", () => {
    expect(billions(period(viewOf("VZ"), "FY 2024")?.values.capitalExpenditures)).toBeCloseTo(17.09, 2);
    expect(viewOf("VZ").ttm?.values.freeCashFlow).not.toBeNull();
  });

  it("does not read Delta's other productive assets, a part of its total, as its capital expenditure", () => {
    expect(billions(period(viewOf("DAL"), "FY 2024")?.values.capitalExpenditures)).toBeCloseTo(5.14, 2);
  });

  it("gives Arista's latest trailing period its capital expenditure though its quarters and year use different names", () => {
    expect(viewOf("ANET").ttm?.values.capitalExpenditures).not.toBeNull();
    expect(viewOf("ANET").ttm?.values.freeCashFlow).not.toBeNull();
  });

  it("keeps Fortive's and Republic Services' fourth-quarter trailing capital expenditure equal to the year they filed", () => {
    for (const ticker of ["FTV", "RSG"]) {
      const view = viewOf(ticker);
      const year = period(view, "FY 2024")!.values.capitalExpenditures!;
      const trailing = period(view, "TTM Q4 FY2024", "trailing")?.values.capitalExpenditures;
      expect(trailing, ticker).not.toBeNull();
      expect(Math.abs(trailing! - year) / year, ticker).toBeLessThan(0.01);
    }
  });

  it("shows Travelers' free cash flow as its operating cash flow, and says so; withholds JPMorgan's", () => {
    expect(viewOf("TRV").fcfNote).toContain("files no capital-expenditure line");
    expect(viewOf("TRV").withheldReason).toContain("insurer");
    expect(viewOf("JPM").ttm?.values.freeCashFlow).toBeNull();
    expect(viewOf("JPM").withheldReason).toContain("raw material");
  });

  it("restates per-share figures across NVIDIA's, Apple's and Amazon's stock splits", () => {
    // Diluted earnings per share for the fiscal year, on today's share basis.
    expect(period(viewOf("NVDA"), "FY 2024")?.values.netIncomePerShare).toBeCloseTo(1.19, 2);
    expect(period(viewOf("AAPL"), "FY 2024")?.values.netIncomePerShare).toBeCloseTo(6.08, 2);
    expect(period(viewOf("AMZN"), "FY 2024")?.values.netIncomePerShare).toBeCloseTo(5.53, 2);
  });

  it("reads annual-only foreign issuers in their own currency, with no trailing period", () => {
    for (const ticker of ["ASML", "TSM"]) {
      expect(viewOf(ticker).trailing, ticker).toHaveLength(0);
      expect(viewOf(ticker).quarterly, ticker).toHaveLength(0);
    }
  });

  it("reads Costco's 53-week fiscal 2024 and Copart's July year on their own calendars", () => {
    expect(period(viewOf("COST"), "FY 2024")?.end).toBe("2024-09-01");
    expect(period(viewOf("CPRT"), "FY 2024")?.end).toBe("2024-07-31");
  });
});
