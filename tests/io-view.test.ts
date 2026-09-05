import { describe, expect, it } from "vitest";
import { ABSENT, cagrOf, compact, datedCagrOf, delta, edgarUrl, formatUnit, money, percent, price, ratio } from "../components/io/format";
import { companyView } from "../lib/io/view";
import type { CompanyDataset, FinancialPeriod, MetricKey } from "../lib/types";

const SHARE_METRICS = new Set<MetricKey>(["basicShares", "dilutedShares", "sharesOutstanding"]);

function period(
  periodEnd: string,
  facts: Partial<Record<MetricKey, number>>,
  options: { periodicity?: FinancialPeriod["periodicity"]; label?: string; sharesOutstandingAt?: string } = {},
): FinancialPeriod {
  const periodicity = options.periodicity ?? "annual";
  const fiscalYear = Number(periodEnd.slice(0, 4));
  return {
    label: options.label ?? `FY ${fiscalYear}`,
    fiscalYear, periodStart: `${fiscalYear - 1}-10-01`, periodEnd, periodicity,
    filingDate: `${fiscalYear}-11-01`, accession: `0000320193-${String(fiscalYear).slice(2)}-000073`, currency: "USD",
    facts: Object.fromEntries(Object.entries(facts).map(([metric, value]) => [metric, {
      metric, value, currency: "USD",
      unit: SHARE_METRICS.has(metric as MetricKey) ? "shares" : "currency",
      periodStart: `${fiscalYear - 1}-10-01`,
      periodEnd: metric === "sharesOutstanding" ? options.sharesOutstandingAt ?? periodEnd : periodEnd,
      periodicity, fiscalYear,
      provenance: {
        provider: "SEC", sourceUrl: "https://www.sec.gov/Archives/x", accession: `0000320193-${String(fiscalYear).slice(2)}-000073`,
        filingDate: `${fiscalYear}-11-01`, retrievedAt: "2026-09-01T00:00:00.000Z", concept: metric, status: "reported",
      },
    }])) as FinancialPeriod["facts"],
  };
}

function dataset(periods: FinancialPeriod[]): CompanyDataset {
  return {
    company: {
      ticker: "TEST", name: "Test Corporation", cik: "0000320193", exchange: "NASDAQ", currency: "USD",
      sector: "Technology", description: "A company that exists only here.", resolutionStatus: "verified", businessType: "operating",
    },
    periods, retrievedAt: "2026-09-01T00:00:00.000Z", warnings: ["One warning."],
  };
}

const full = {
  revenue: 1_000, costOfRevenue: 400, operatingIncome: 250, netIncome: 200,
  operatingCashFlow: 300, capitalExpenditures: 50, cashAndEquivalents: 120, totalDebt: 500,
  dilutedShares: 100, sharesOutstanding: 98, totalAssets: 2_000, currentLiabilities: 300, totalEquity: 900,
} satisfies Partial<Record<MetricKey, number>>;

describe("the .io company projection", () => {
  it("projects every section metric for every period, and keeps an unfiled figure absent", () => {
    const view = companyView(dataset([period("2025-09-27", full)]));
    const latest = view.annual.at(-1)!;

    expect(view.company).toMatchObject({ ticker: "TEST", exchange: "NASDAQ", currency: "USD" });
    expect(latest.values.revenue).toBe(1_000);
    // Derived by the engine, not restated here: 1000 − 400 gross, 300 − 50 free cash flow.
    expect(latest.values.grossProfit).toBe(600);
    expect(latest.values.freeCashFlow).toBe(250);
    expect(latest.values.grossMargin).toBeCloseTo(0.6, 10);
    // Inventory is not filed by this company. An absent balance is never a zero.
    expect(latest.values.inventory).toBeNull();

    /*
     * The catalogue lists what this company has, not what the registry knows.
     *
     * Twenty-one registry measures cannot be computed from a filed period at
     * all — a market capitalisation, a price-to-earnings, every compound rate —
     * because they need a quote or a second period, and they used to be shipped
     * for every company as a column of nulls no chart could draw.
     */
    const catalogued = new Set(view.metrics.map((metric) => metric.key));
    expect(catalogued.has("revenue")).toBe(true);
    expect(catalogued.has("grossMargin")).toBe(true);
    // Not filed by this company, so not offered as a measure of it.
    expect(catalogued.has("inventory")).toBe(false);
    // Never computable from a period alone, so never offered at all.
    expect(catalogued.has("priceToEarnings")).toBe(false);
    expect(catalogued.has("marketCapitalization")).toBe(false);
    for (const key of catalogued) {
      expect(latest.values[key] != null || view.quarterly.some((period) => period.values[key] != null)).toBe(true);
    }
  });

  it("orders periods oldest first, caps the history, and leads the statements with TTM", () => {
    const annual = Array.from({ length: 24 }, (_, index) => period(`${2002 + index}-09-27`, full));
    const quarterly = Array.from({ length: 30 }, (_, index) =>
      period(`${2019 + Math.floor(index / 4)}-0${(index % 4) + 1}-30`, full, { periodicity: "quarterly", label: `Q${(index % 4) + 1}` }));
    const trailing = Array.from({ length: 22 }, (_, index) => period(`${2021 + Math.floor(index / 4)}-0${(index % 4) + 1}-27`, full, { periodicity: "ttm", label: `TTM ${index + 1}` }));
    const view = companyView(dataset([...annual, ...quarterly, ...trailing]));

    expect(view.annual).toHaveLength(20);
    expect(view.quarterly).toHaveLength(24);
    expect(view.annual[0].end < view.annual.at(-1)!.end).toBe(true);
    expect(view.annual.at(-1)!.end).toBe("2025-09-27");
    expect(view.trailing).toHaveLength(22);
    expect(view.ttm?.label).toBe("TTM 22");
    // The current period is the TTM, which is what a price is measured against.
    expect(view.current).toMatchObject({ frequency: "ttm" });
  });

  it("states the share count a price may be multiplied by, and how it was obtained", () => {
    const view = companyView(dataset([period("2025-09-27", full)]));
    expect(view.basis).toMatchObject({ currency: "USD", shares: 98, sharesBasis: "outstanding", netDebt: 380 });
    expect(view.annual.at(-1)?.valuationBasis).toMatchObject({ shares: 98, sharesBasis: "outstanding", netDebt: 380 });
    expect(view.basisReason).toBeNull();
  });

  it("falls back to the diluted average and says so when no point-in-time count is filed", () => {
    const withoutCount = { ...full, sharesOutstanding: undefined };
    const view = companyView(dataset([period("2025-09-27", withoutCount)]));
    expect(view.basis?.sharesBasis).toBe("diluted");
    expect(view.basis?.shares).toBe(100);
    expect(view.basis?.sharesNote).toContain("average over the period");
  });

  it("withholds the basis rather than inventing one when the filing carries no share count", () => {
    const bare = { ...full, sharesOutstanding: undefined, dilutedShares: undefined };
    const view = companyView(dataset([period("2025-09-27", bare)]));
    expect(view.basis).toBeNull();
    expect(view.basisReason).toContain("no share count");
  });
});

describe("how a figure is written", () => {
  it("scales to three significant figures and signs a negative with a minus, not a hyphen", () => {
    expect(compact(215_912_000_000)).toBe("216B");
    expect(compact(4_812_000_000)).toBe("4.81B");
    expect(compact(-293_000_000)).toBe("−293M");
    expect(money(4_690_000_000_000, "USD")).toBe("$4.69T");
    expect(money(-4_270_000_000, "USD")).toBe("−$4.27B");
    expect(price(320.9312, "USD")).toBe("$320.93");
    expect(percent(0.0292, 2)).toBe("2.92%");
    expect(ratio(36.42, 1)).toBe("36.4×");
    expect(delta(-0.0222)).toBe("−2.22%");
    expect(delta(0.0222)).toBe("+2.22%");
  });

  it("writes an unknown figure as an em dash in every unit", () => {
    for (const unit of ["currency", "perShare", "percent", "ratio", "shares"] as const) {
      expect(formatUnit(null, unit, "USD")).toBe(ABSENT);
    }
    expect(formatUnit(Number.NaN, "currency", "USD")).toBe(ABSENT);
    // Zero is a figure, not an absence, and must never be written as one.
    expect(formatUnit(0, "currency", "USD")).toBe("$0");
  });

  it("refuses a growth rate that a sign change would make meaningless", () => {
    expect(cagrOf([100, 110, 121], 5)).toBeCloseTo(0.1, 10);
    expect(cagrOf([-50, 10], 5)).toBeNull();
    expect(cagrOf([100, null], 5)).toBeNull();
    expect(cagrOf([100], 5)).toBeNull();
    expect(datedCagrOf([{ date: "2021-01-01", value: 100 }, { date: "2026-01-01", value: 161.05 }])).toBeCloseTo(.1, 3);
    /*
     * A window of exactly a year states its rate, because over one year the
     * compound rate simply is the change. This used to be refused along with
     * the fragments, and the refusal only became visible once the figures below
     * the chart were put on the page's own default range: every panel in the
     * grid lost its growth line at once.
     */
    expect(datedCagrOf([{ date: "2025-01-01", value: 100 }, { date: "2026-01-01", value: 110 }])).toBeCloseTo(.1, 3);
    // A fragment of a year has no annual rate: multiplying a quarter by four
    // and calling it a trend is exactly the estimate this application refuses.
    expect(datedCagrOf([{ date: "2025-10-01", value: 100 }, { date: "2026-01-01", value: 110 }])).toBeNull();
  });

  it("addresses the filing a figure came out of, or nothing", () => {
    expect(edgarUrl("0000320193", "0000320193-25-000073")).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019325000073/");
    expect(edgarUrl("", "0000320193-25-000073")).toBeNull();
    expect(edgarUrl("0000320193", "not-an-accession")).toBeNull();
  });
});
