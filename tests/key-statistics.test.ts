import { describe, expect, it } from "vitest";
import { keyStatistics } from "../lib/io/key-statistics";
import type { IoCompanyView, IoPeriod } from "../lib/io/view";
import type { Estimates } from "../lib/estimates";

const period = (fiscalYear: number, values: Record<string, number | null>): IoPeriod => ({
  label: `FY${fiscalYear}`, end: `${fiscalYear}-12-31`, start: `${fiscalYear}-01-01`, fiscalYear, fiscalQuarter: null,
  filingDate: `${fiscalYear + 1}-02-01`, publishedAt: `${fiscalYear + 1}-02-01`, accession: "x", currency: "USD", values,
} as IoPeriod);

// Ten years: revenue up 10% a year, EPS up 20%, a dividend doubling over five years, returns around 20%.
const annual = Array.from({ length: 11 }, (_, at) => period(2015 + at, {
  revenue: 100 * 1.1 ** at, grossProfit: 60 * 1.1 ** at, netIncome: 20 * 1.1 ** at, freeCashFlow: at === 5 ? -5 : 25 * 1.1 ** at,
  netIncomePerShare: 2 * 1.2 ** at, dilutedShares: 10, dividendsPerShare: at >= 5 ? 1 * 2 ** ((at - 5) / 5) : null,
  returnOnEquity: at >= 8 ? 0.2 : null, returnOnAssets: 0.1, grossMargin: 0.6, ebitda: 40 * 1.1 ** at, totalEquity: 50, dividendsPaid: -10,
}));
const view = { company: { ticker: "TEST", name: "Test", cik: "1", exchange: "NYSE", sector: "Tech", currency: "USD", description: "", businessType: null, resolution: "" },
  retrievedAt: "", current: null, metrics: [], annual, quarterly: [], trailing: [], ttm: null,
  basis: { currency: "USD", shares: 10, sharesBasis: "outstanding", sharesNote: null, netDebt: 20, debtFrom: null, minorityInterest: null, periodLabel: "FY2025" },
  basisReason: null, withheldReason: null, fcfNote: null, warnings: [] } as unknown as IoCompanyView;

const find = (blocks: ReturnType<typeof keyStatistics>, title: string, label: string) => blocks.find((block) => block.title === title)?.rows.find((row) => row.label === label)?.value;

describe("DES key statistics", () => {
  const estimates = { yearly: [{ fiscalEnd: "Dec 2026", consensus: 10 }, { fiscalEnd: "Dec 2027", consensus: 11 }, { fiscalEnd: "Dec 2028", consensus: 12.1 }], quarterly: [], target: { low: 90, mean: 120, high: 150 }, ratings: null } as unknown as Estimates;
  const blocks = keyStatistics({ view, price: 100, marketCap: 1000, enterpriseValue: 1020, shares: 10, estimates });

  it("strikes the growth rates over exactly their years, and none across a loss", () => {
    expect(find(blocks, "Growth · CAGR", "Revenue 3Y")).toBeCloseTo(0.1, 6);
    expect(find(blocks, "Growth · CAGR", "Revenue 10Y")).toBeCloseTo(0.1, 6);
    expect(find(blocks, "Growth · CAGR", "Dil. EPS 5Y")).toBeCloseTo(0.2, 6);
    // Free cash flow was negative five years back: no rate.
    expect(find(blocks, "Growth · CAGR", "FCF 5Y")).toBeUndefined();
    expect(find(blocks, "Dividends", "DPS growth 5Y")).toBeCloseTo(2 ** 0.2 - 1, 6);
    // No dividend ten years back: no ten-year rate.
    expect(find(blocks, "Dividends", "DPS growth 10Y")).toBeUndefined();
    expect(find(blocks, "Growth · CAGR", "EPS fwd 2Y")).toBeCloseTo(0.1, 6);
  });

  it("averages returns over five years from three at least, and values on the price", () => {
    expect(find(blocks, "Returns · 5Y avg", "ROA")).toBeCloseTo(0.1, 6);
    expect(find(blocks, "Returns · 5Y avg", "ROE")).toBeCloseTo(0.2, 6);
    expect(find(blocks, "Valuation · TTM", "P/E")).toBeCloseTo(1000 / (20 * 1.1 ** 10), 6);
    expect(find(blocks, "Valuation · TTM", "EV/Gross profit")).toBeCloseTo(1020 / (60 * 1.1 ** 10), 6);
    expect(find(blocks, "Valuation · NTM", "Price target")).toBe(120);
    expect(find(blocks, "Dividends", "Yield")).toBeCloseTo(0.01, 6);
  });

  it("leaves out what it cannot strike, and a block with nothing in it", () => {
    const bare = keyStatistics({ view, price: null, marketCap: null, enterpriseValue: null, shares: null, estimates: null });
    expect(bare.find((block) => block.title === "Valuation · NTM")).toBeUndefined();
    expect(find(bare, "Valuation · TTM", "P/E")).toBeUndefined();
    expect(find(bare, "Profile", "Revenue")).toBeCloseTo(100 * 1.1 ** 10, 6);
  });
});

import { leadText } from "../lib/description";
describe("a Wikipedia lead as a description", () => {
  it("keeps whole paragraphs up to the limit, and the first whatever its length", () => {
    expect(leadText("One.\nTwo.\n\nThree.", 12)).toBe("One.\n\nTwo.");
    expect(leadText("A long first paragraph.\nMore.", 5)).toBe("A long first paragraph.");
  });
});
