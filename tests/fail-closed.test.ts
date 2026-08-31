import { describe, expect, it } from "vitest";
import { companyStatistics } from "../lib/company-statistics";
import { derivedValue, investedCapital, netDebt } from "../lib/finance";
import { marketBasis, multipleOf, shareCount } from "../lib/market-basis";
import { valuationSnapshot } from "../lib/valuation-history";
import type { CompanyDataset, FinancialPeriod, MetricKey, PricePoint } from "../lib/types";
import { dcfBaseFromPeriods } from "../components/DcfValuation";

/*
 * What an absent fact is allowed to become.
 *
 * Every case here is one the data audit of 30 August found published as a
 * figure: a bank with no debt, a market capitalisation on the wrong share
 * base, a euro income statement priced in dollars, a negative multiple stated
 * on one screen and withheld on the next. The rule they all test is the same —
 * a figure that needs a balance, a share count or a currency is unavailable,
 * with a reason, the moment one of them is missing or incompatible.
 */

const provenance = { provider: "SEC" as const, sourceUrl: "sec", retrievedAt: "now", concept: "Test", status: "reported" as const };
const SHARE_METRICS = new Set<MetricKey>(["dilutedShares", "basicShares", "sharesOutstanding", "sharesIssued", "treasuryShares"]);

function period(facts: Partial<Record<MetricKey, number>>, currency = "USD", periodicity: FinancialPeriod["periodicity"] = "ttm"): FinancialPeriod {
  const end = "2025-12-31";
  return {
    label: "TTM Q4 FY2025", fiscalYear: 2025, periodEnd: end, periodicity, filingDate: "2026-02-10", accession: "acc", currency,
    facts: Object.fromEntries(Object.entries(facts).map(([metric, value]) => [metric, {
      metric, value, currency, unit: SHARE_METRICS.has(metric as MetricKey) ? "shares" : "currency",
      periodEnd: end, periodicity, fiscalYear: 2025, provenance,
    }])) as FinancialPeriod["facts"],
  };
}

const priceIn = (currency: string, close = 20): PricePoint => ({
  close, priceClose: close, totalReturnClose: close, adjustedClose: close, date: "2026-02-10", requestedDate: "2026-02-10",
  currency, ticker: "TEST", type: "split-adjusted close", fallback: "exact date", distanceDays: 0, sourceUrl: "yahoo",
});

/** A whole company, for the paths that read a dataset rather than a period. */
function dataset(facts: Partial<Record<MetricKey, number>>, currency = "USD"): CompanyDataset {
  return {
    company: { name: "Test Co", ticker: "TEST", cik: "0000000000", exchange: "XETRA", currency, sector: "Test", description: "A fixture." },
    periods: [period(facts, currency, "annual")], retrievedAt: "2026-02-11T00:00:00.000Z", warnings: [],
  };
}

/** The same company, with one balance the filer never tagged. */
const without = (facts: Partial<Record<MetricKey, number>>, ...missing: MetricKey[]): Partial<Record<MetricKey, number>> =>
  Object.fromEntries(Object.entries(facts).filter(([metric]) => !missing.includes(metric as MetricKey)));

const complete = { revenue: 1_000, netIncome: 100, operatingIncome: 200, operatingCashFlow: 250, capitalExpenditures: 50, incomeBeforeTax: 125, incomeTaxExpense: 25, totalEquity: 800, totalDebt: 300, cashAndEquivalents: 100, dilutedShares: 100, sharesOutstanding: 90 };

describe("a missing balance is unknown, not zero", () => {
  it("withholds net debt when either side of it is unreported", () => {
    const noDebt = without(complete, "totalDebt");
    const noCash = without(complete, "cashAndEquivalents");
    expect(netDebt(period(complete))).toBe(200);
    expect(netDebt(period(noDebt))).toBeNull();
    expect(netDebt(period(noCash))).toBeNull();
    expect(derivedValue(period(noDebt), "netDebt")).toBeNull();
    // A filed zero is a fact and stays one: only absence is unknown.
    expect(netDebt(period({ ...complete, totalDebt: 0 }))).toBe(-100);
  });

  it("withholds invested capital, and the returns on it, when debt is unreported", () => {
    const noDebt = without(complete, "totalDebt");
    expect(investedCapital(period(complete))).toBe(1_000);
    expect(investedCapital(period(noDebt))).toBeNull();
    // Understating the capital base overstates every return computed on it,
    // which is how a company with 90bn of borrowings once showed 247% ROIC.
    expect(derivedValue(period(noDebt), "roic")).toBeNull();
    expect(derivedValue(period(noDebt), "cashReturnOnCapital")).toBeNull();
  });

  it("does not let the FCFF equity bridge replace an absent cash or debt balance with zero", () => {
    expect(dcfBaseFromPeriods([period(complete, "USD", "annual")])).not.toBeNull();
    expect(dcfBaseFromPeriods([period(without(complete, "totalDebt"), "USD", "annual")])).toBeNull();
    expect(dcfBaseFromPeriods([period(without(complete, "cashAndEquivalents"), "USD", "annual")])).toBeNull();
  });

  it("withholds working capital when the cash it excludes is unreported", () => {
    const withCash = period({ ...complete, currentAssets: 500, currentLiabilities: 200 });
    const withoutCash = period({ revenue: 1_000, currentAssets: 500, currentLiabilities: 200 });
    expect(derivedValue(withCash, "netWorkingCapital")).toBe(200);
    expect(derivedValue(withoutCash, "netWorkingCapital")).toBeNull();
  });

  it("returns nothing rather than NaN when capital expenditure is unreported", () => {
    const value = derivedValue(period({ revenue: 1_000 }), "capitalIntensity");
    expect(value).toBeNull();
    expect(Number.isNaN(value as number)).toBe(false);
  });
});

describe("a ratio over a base that cannot carry it", () => {
  it("withholds return on equity and debt to equity when equity is negative", () => {
    const negative = period({ ...complete, totalEquity: -400 });
    expect(derivedValue(negative, "returnOnEquity")).toBeNull();
    expect(derivedValue(negative, "debtToEquity")).toBeNull();
    // The same company with positive equity still reports both.
    expect(derivedValue(period(complete), "returnOnEquity")).toBeCloseTo(.125, 10);
  });

  it("applies one multiple rule everywhere, so a loss is never a cheap multiple", () => {
    expect(multipleOf(4_000, -50)).toBeNull();
    expect(multipleOf(4_000, 0)).toBeNull();
    expect(multipleOf(4_000, 200)).toBe(20);
  });
});

describe("a price meeting a filed statement", () => {
  it("refuses a price quoted in a currency the statements are not kept in", () => {
    const euros = period(complete, "EUR");
    const result = marketBasis(euros, priceIn("USD"));
    expect(result.basis).toBeNull();
    expect(result.reason).toContain("USD");
    expect(result.reason).toContain("EUR");
    // And the same period priced in its own currency works normally.
    expect(marketBasis(euros, priceIn("EUR")).basis?.marketCap).toBe(1_800);
  });

  it("prefers the period-end share count and says so when it cannot have it", () => {
    expect(shareCount(period(complete))).toMatchObject({ shares: 90, basis: "outstanding" });
    const noCount = without(complete, "sharesOutstanding");
    const fallback = shareCount(period(noCount))!;
    expect(fallback).toMatchObject({ shares: 100, basis: "diluted" });
    expect(fallback.note).toBeTruthy();
    // The note travels to the caller rather than the substitution being silent.
    expect(marketBasis(period(noCount), priceIn("USD")).basis?.sharesNote).toBeTruthy();
  });

  it("withholds enterprise value, with a reason, when debt cannot be read", () => {
    const noDebt = without(complete, "totalDebt");
    const basis = marketBasis(period(noDebt), priceIn("USD")).basis!;
    expect(basis.marketCap).toBe(1_800);
    expect(basis.enterpriseValue).toBeNull();
    expect(basis.enterpriseValueReason).toContain("debt");
  });

  it("gives no valuation snapshot at all across a currency boundary", () => {
    expect(valuationSnapshot(period(complete, "EUR"), priceIn("USD"))).toBeNull();
    expect(valuationSnapshot(period(complete), priceIn("USD"))).not.toBeNull();
  });

  it("drops every enterprise multiple with the enterprise value", () => {
    const noDebt = without(complete, "totalDebt");
    const snapshot = valuationSnapshot(period(noDebt), priceIn("USD"))!;
    expect(snapshot.metrics.priceToSales).toBeCloseTo(1.8, 10);
    expect(snapshot.metrics.enterpriseToSales).toBeNull();
    expect(snapshot.metrics.enterpriseToEbit).toBeNull();
    // The identity is untestable rather than confirmed against zeroes.
    expect(snapshot.invariants.find((item) => item.metric === "enterpriseValue")?.status).toBe("not-applicable");
  });
});

describe("the statistics panel says why, not just nothing", () => {
  const foreign = companyStatistics(dataset(complete, "EUR"), priceIn("USD"));
  const profile = foreign.find((group) => group.title === "Profile")!;
  const row = (group: string, label: string) => foreign.find((item) => item.title === group)!.stats.find((item) => item.label === label)!;

  it("withholds every priced figure together, for the one stated reason", () => {
    for (const [group, label] of [["Profile", "Market Cap"], ["Profile", "EV"], ["Valuation (TTM)", "P/E"], ["Valuation (TTM)", "EV/Sales"], ["Dividends", "Yield"]] as const) {
      expect(row(group, label).value).toBeNull();
    }
    expect(row("Profile", "Market Cap").reason).toContain("does not convert");
    // The share count itself is a filed fact and survives.
    expect(row("Profile", "Shares Out").value).toBe(90);
    expect(profile.stats.length).toBeGreaterThan(0);
  });

  it("explains an unavailable net debt instead of printing a dash", () => {
    const noDebt = without(complete, "totalDebt");
    const groups = companyStatistics(dataset(noDebt), priceIn("USD"));
    const health = groups.find((group) => group.title === "Financial Health")!.stats.find((item) => item.label === "Net Debt")!;
    expect(health.value).toBeNull();
    expect(health.reason).toContain("absent balance");
  });

  it("marks a return built on an assumed tax rate as assumed", () => {
    // No pre-tax income and no tax line: NOPAT falls back to 21%, and the row
    // has to carry that rather than presenting it as the company's own rate.
    const untaxed = without(complete, "incomeBeforeTax", "incomeTaxExpense");
    const groups = companyStatistics(dataset(untaxed), priceIn("USD"));
    const roic = groups.find((group) => group.title === "Returns on Capital")!.stats.find((item) => item.label === "ROIC")!;
    expect(roic.value).not.toBeNull();
    expect(roic.formula).toContain("assumed 21%");
    const reported = companyStatistics(dataset(complete), priceIn("USD"))
      .find((group) => group.title === "Returns on Capital")!.stats.find((item) => item.label === "ROIC")!;
    expect(reported.formula).not.toContain("assumed");
  });
});
