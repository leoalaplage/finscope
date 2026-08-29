import { describe, expect, it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { bestIn, companyStatistics, formatStat } from "../lib/company-statistics";
import { derivedValue } from "../lib/finance";
import type { CompanyDataset, FinancialPeriod, MetricKey, PricePoint } from "../lib/types";

const provenance = { provider: "SEC" as const, sourceUrl: "sec", retrievedAt: "now", concept: "Test", status: "reported" as const };

function period(fiscalYear: number, facts: Partial<Record<MetricKey, number>>, periodicity: FinancialPeriod["periodicity"] = "annual"): FinancialPeriod {
  const end = `${fiscalYear}-12-31`;
  return {
    label: `FY ${fiscalYear}`, fiscalYear, periodEnd: end, periodicity,
    filingDate: `${fiscalYear + 1}-02-01`, accession: `a-${fiscalYear}`, currency: "USD",
    facts: Object.fromEntries(Object.entries(facts).map(([metric, value]) => [metric, {
      metric, value, currency: "USD", unit: metric.toLowerCase().includes("share") && metric !== "dividendsPerShare" ? "shares" : "currency",
      periodEnd: end, periodicity, fiscalYear, provenance,
    }])) as FinancialPeriod["facts"],
  };
}

/** A steady compounder with a clean balance sheet and a dividend. */
function dataset(): CompanyDataset {
  // Eleven year-ends, so a ten-year CAGR has ten full years between its
  // endpoints rather than nine — which the CAGR rule would rightly refuse.
  const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const periods = years.map((year, index) => period(year, {
    revenue: 1_000 * 1.1 ** index,
    grossProfit: 600 * 1.1 ** index,
    operatingIncome: 300 * 1.1 ** index,
    netIncome: 200 * 1.1 ** index,
    incomeBeforeTax: 250 * 1.1 ** index,
    incomeTaxExpense: 50 * 1.1 ** index,
    operatingCashFlow: 320 * 1.1 ** index,
    capitalExpenditures: 40,
    depreciationAndAmortization: 60,
    totalAssets: 2_000,
    goodwill: 400,
    intangibleAssets: 100,
    totalEquity: 1_000,
    totalDebt: 200,
    cashAndEquivalents: 300,
    currentLiabilities: 500,
    interestExpense: 10,
    dilutedShares: 100,
    sharesOutstanding: 100,
    dividendsPaid: 50,
    dividendsPerShare: 0.5 * 1.05 ** index,
  }));
  return {
    company: { name: "Test Co", ticker: "TEST", cik: "0000000000", exchange: "NASDAQ", currency: "USD", sector: "Test", description: "A fixture." },
    periods, retrievedAt: "2026-01-01T00:00:00.000Z", warnings: [],
  };
}

const price: PricePoint = { close: 40, adjustedClose: 40, date: "2025-12-31", requestedDate: "2025-12-31", currency: "USD", ticker: "TEST", type: "adjusted close", fallback: "exact date", distanceDays: 0, sourceUrl: "https://finance.yahoo.com" };

const find = (groups: ReturnType<typeof companyStatistics>, group: string, label: string) =>
  groups.find((item) => item.title === group)!.stats.find((item) => item.label === label)!;

describe("company statistics", () => {
  const groups = companyStatistics(dataset(), price);

  it("states enterprise value as market capitalisation plus net debt", () => {
    // 100 shares at 40 is 4,000; debt 200 less cash 300 is net cash of 100.
    expect(find(groups, "Profile", "Market Cap").value).toBe(4_000);
    expect(find(groups, "Profile", "EV").value).toBe(3_900);
  });

  it("removes goodwill and acquired intangibles from the tangible base", () => {
    const latest = dataset().periods.at(-1)!;
    expect(derivedValue(latest, "tangibleAssets")).toBe(1_500);
    // Return on tangible assets must therefore exceed return on total assets.
    expect(find(groups, "Returns on Capital", "ROTA · 5Yr Avg").value!).toBeGreaterThan(find(groups, "Returns on Capital", "ROA · 5Yr Avg").value!);
  });

  it("averages returns over five years rather than reporting the latest one", () => {
    const roe = find(groups, "Returns on Capital", "ROE · 5Yr Avg").value!;
    const latest = dataset().periods.at(-1)!;
    // Profit compounds against a fixed equity base, so the average of the last
    // five years sits below the final year by construction.
    expect(roe).toBeLessThan(derivedValue(latest, "returnOnEquity")!);
  });

  it("computes coverage from interest expense alone, not a net figure", () => {
    expect(find(groups, "Financial Health", "EBIT/Interest").value).toBeCloseTo(300 * 1.1 ** 10 / 10, 5);
  });

  it("recovers a ten-year revenue CAGR equal to the rate it was built with", () => {
    expect(find(groups, "Growth (CAGR)", "Rev 10Yr").value!).toBeCloseTo(.1, 3);
  });

  it("marks a rising share count as the worse direction", () => {
    expect(find(groups, "Growth (CAGR)", "Shares 5Yr").polarity).toBe(-1);
    expect(find(groups, "Growth (CAGR)", "Rev 5Yr").polarity).toBe(1);
  });

  it("reports a dividend yield against the matched price", () => {
    expect(find(groups, "Dividends", "Yield").value!).toBeCloseTo(0.5 * 1.05 ** 10 / 40, 6);
  });

  it("publishes no forward-looking group, because it has no estimates source", () => {
    expect(groups.map((group) => group.title)).not.toContain("Valuation (NTM)");
    expect(groups.flatMap((group) => group.stats.map((stat) => stat.label))).not.toContain("Price Target");
  });

  it("explains an unavailable value instead of leaving it blank", () => {
    const withoutPrice = companyStatistics(dataset(), null);
    const pe = find(withoutPrice, "Valuation (TTM)", "P/E");
    expect(pe.value).toBeNull();
    expect(pe.reason).toBe("No matched market price");
  });

  it("refuses a multiple over a negative denominator", () => {
    const losing = dataset();
    losing.periods = losing.periods.map((item) => ({ ...item, facts: { ...item.facts, netIncome: { ...item.facts.netIncome!, value: -100 } } }));
    expect(find(companyStatistics(losing, price), "Valuation (TTM)", "P/E").value).toBeNull();
  });

  it("says a company pays no dividend rather than showing a zero yield", () => {
    const none = dataset();
    none.periods = none.periods.map((item) => { const facts = { ...item.facts }; delete facts.dividendsPerShare; return { ...item, facts }; });
    const yieldStat = find(companyStatistics(none, price), "Dividends", "Yield");
    expect(yieldStat.value).toBeNull();
    expect(yieldStat.reason).toBe("Pays no dividend");
  });
});

describe("comparison highlighting", () => {
  it("picks the highest when higher is better and the lowest when it is not", () => {
    const values = [{ ticker: "A", value: 3 }, { ticker: "B", value: 9 }, { ticker: "C", value: 1 }];
    expect([...bestIn(values, 1)]).toEqual(["B"]);
    expect([...bestIn(values, -1)]).toEqual(["C"]);
  });

  it("highlights nothing for a measure with no better direction", () => {
    expect(bestIn([{ ticker: "A", value: 3 }, { ticker: "B", value: 9 }], 0).size).toBe(0);
  });

  it("highlights nothing when only one company reported the figure", () => {
    expect(bestIn([{ ticker: "A", value: 3 }, { ticker: "B", value: null }], 1).size).toBe(0);
  });

  it("highlights every company tied for the best value", () => {
    expect([...bestIn([{ ticker: "A", value: 5 }, { ticker: "B", value: 5 }, { ticker: "C", value: 2 }], 1)].sort()).toEqual(["A", "B"]);
  });
});

describe("statistic formatting", () => {
  it("abbreviates money and keeps the sign of a negative balance", () => {
    expect(formatStat(4_640_000_000, "currency")).toBe("$4.64B");
    expect(formatStat(-4_110_000_000, "currency")).toBe("-$4.11B");
  });

  it("drops the decimal on a large percentage but keeps it on a small one", () => {
    expect(formatStat(.466, "percent")).toBe("46.6%");
    expect(formatStat(12.5, "percent")).toBe("1250%");
  });

  it("marks multiples and ratios differently", () => {
    expect(formatStat(19.6, "multiple")).toBe("19.6×");
    expect(formatStat(0, "ratio")).toBe("0.00");
  });

  it("shows an unavailable value as a dash rather than zero", () => {
    expect(formatStat(null, "currency")).toBe("—");
    expect(formatStat(Number.NaN, "percent")).toBe("—");
  });
});

describe("balance-sheet facts the statistics depend on", () => {
  const company = { name: "Split Debt Co", ticker: "SPLIT", cik: "0000000001", exchange: "NASDAQ", currency: "USD", sector: "Test", description: "A fixture." };
  const unit = (val: number, start: string | undefined, end: string) => ({ ...(start ? { start } : {}), end, val, accn: `acc-${end}`, fy: Number(end.slice(0, 4)), fp: "FY", form: "10-K", filed: `${Number(end.slice(0, 4)) + 1}-02-01` });
  const facts = (tags: Record<string, Array<ReturnType<typeof unit>>>) => ({
    entityName: "Split Debt Co",
    facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, values]) => [tag, { units: { USD: values } }])) },
  });

  it("sums the two halves of long-term debt when the filer tags no total", () => {
    const payload = facts({
      LongTermDebtCurrent: [unit(12_350_000_000, undefined, "2025-09-27")],
      LongTermDebtNoncurrent: [unit(78_328_000_000, undefined, "2025-09-27")],
      Assets: [unit(359_241_000_000, undefined, "2025-09-27")],
      Revenues: [unit(416_161_000_000, "2024-09-29", "2025-09-27")],
    });
    const period = normalizeSecPayload(payload, "SPLIT", "2026-01-01", company).periods.find((item) => item.periodicity === "annual")!;
    // Apple's real 2025 balance: choosing between the halves reported 12.35bn
    // of borrowings instead of 90.68bn, and everything downstream inherited it.
    expect(period.facts.totalDebt?.value).toBe(90_678_000_000);
    expect(period.facts.totalDebt?.provenance.status).toBe("calculated");
    expect(period.facts.totalDebt?.provenance.sourceAccessions).toHaveLength(1);
  });

  it("leaves a filer's own combined debt total untouched", () => {
    const payload = facts({
      LongTermDebtAndFinanceLeaseObligationsCurrentAndNoncurrent: [unit(50_000_000_000, undefined, "2025-12-31")],
      LongTermDebtCurrent: [unit(5_000_000_000, undefined, "2025-12-31")],
      Revenues: [unit(100_000_000_000, "2025-01-01", "2025-12-31")],
    });
    const period = normalizeSecPayload(payload, "SPLIT", "2026-01-01", company).periods.find((item) => item.periodicity === "annual")!;
    expect(period.facts.totalDebt?.value).toBe(50_000_000_000);
    expect(period.facts.totalDebt?.provenance.status).toBe("reported");
  });

  it("withholds a tangible return when neither goodwill nor intangibles is reported", () => {
    const opaque = dataset();
    opaque.periods = opaque.periods.map((item) => {
      const facts = { ...item.facts }; delete facts.goodwill; delete facts.intangibleAssets;
      return { ...item, facts };
    });
    expect(derivedValue(opaque.periods.at(-1)!, "tangibleAssets")).toBeNull();
    const rota = find(companyStatistics(opaque, price), "Returns on Capital", "ROTA · 5Yr Avg");
    // Publishing total assets under a tangible label would restate ROA twice.
    expect(rota.value).toBeNull();
    expect(rota.reason).toMatch(/tangible base cannot be identified/);
  });
});

describe("cash return on capital", () => {
  const groups = companyStatistics(dataset(), price);

  it("divides free cash flow by the same capital base ROIC uses", () => {
    const latest = dataset().periods.at(-1)!;
    const fcf = derivedValue(latest, "freeCashFlow")!;
    const capital = derivedValue(latest, "investedCapital")!;
    expect(derivedValue(latest, "cashReturnOnCapital")).toBeCloseTo(fcf / capital, 10);
    expect(find(groups, "Returns on Capital", "Cash RoC").value).toBeCloseTo(fcf / capital, 10);
  });

  it("differs from ROIC, because one applies a tax rate and the other does not", () => {
    const latest = dataset().periods.at(-1)!;
    expect(derivedValue(latest, "cashReturnOnCapital")).not.toBeCloseTo(derivedValue(latest, "roic")!, 4);
  });

  it("states the current reading, the five-year average and the gap between them", () => {
    const current = find(groups, "Returns on Capital", "Cash RoC").value!;
    const average = find(groups, "Returns on Capital", "Cash RoC · 5Yr Avg").value!;
    const gap = find(groups, "Returns on Capital", "Cash RoC · vs 5Yr");
    expect(gap.value).toBeCloseTo(current - average, 10);
    expect(gap.format).toBe("points");
    // Cash flow compounds against a fixed capital base in this fixture, so the
    // latest year must sit above the average of the last five.
    expect(current).toBeGreaterThan(average);
  });

  it("has no value when invested capital is not reportable", () => {
    const noEquity = dataset();
    noEquity.periods = noEquity.periods.map((item) => { const facts = { ...item.facts }; delete facts.totalEquity; return { ...item, facts }; });
    expect(derivedValue(noEquity.periods.at(-1)!, "cashReturnOnCapital")).toBeNull();
  });

  it("shows a gap in points, signed, rather than as a percentage of a percentage", () => {
    expect(formatStat(.032, "points")).toBe("+3.2 pp");
    expect(formatStat(-.045, "points")).toBe("-4.5 pp");
  });
});

describe("a financial institution", () => {
  it("withholds every free-cash-flow measure, and says why once", () => {
    /*
     * Interactive Brokers stated a 394.9% free-cash-flow margin and a 1773.5%
     * cash return on capital on the front page. Cash flow at a broker moves
     * with customer and clearing balances, so those ratios are arithmetically
     * correct and describe nothing.
     */
    const base = dataset();
    const broker = { ...base, company: { ...base.company, businessType: "financial" as const } };
    const groups = companyStatistics(broker, null);
    const withheld = groups.flatMap((group) => group.stats).filter((stat) => stat.reason === "Not meaningful at a financial institution");
    expect(withheld.map((stat) => stat.label).sort()).toEqual(
      ["Capex/Sales", "Cash RoC", "Cash RoC · 5Yr Avg", "Cash RoC · vs 5Yr", "FCF", "FCF 5Yr", "FCF after SBC", "FCF/share 5Yr", "P/FCF"],
    );
    for (const stat of withheld) expect(stat.value).toBeNull();

    // The long explanation is stated once, at the top of the first group it
    // applies to. Repeating it on nine rows is the same information served
    // badly enough that nobody reads any of it.
    const explanations = groups.filter((group) => group.note?.includes("customer and clearing balances"));
    expect(explanations).toHaveLength(1);
    expect(explanations[0].title).toBe("Margins (TTM)");
  });

  it("leaves an operating company's cash measures alone", () => {
    const groups = companyStatistics(dataset(), null);
    const margin = groups.find((group) => group.title === "Margins (TTM)")!.stats.find((stat) => stat.label === "FCF")!;
    expect(margin.value).not.toBeNull();
    expect(groups.some((group) => group.note?.includes("customer and clearing balances"))).toBe(false);
  });
});
