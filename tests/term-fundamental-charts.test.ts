import { describe, expect, it } from "vitest";
import { latestByDate } from "@/lib/adapters/backlog";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { PRESETS, axisFor, buildPreset, niceStep, pointsIn, shortLabel } from "@/lib/term/fundamental-charts";

function period(end: string, fiscalYear: number, fiscalQuarter: string | null, values: Record<string, number | null>, label = fiscalQuarter ? `${fiscalQuarter} FY${fiscalYear}` : `FY ${fiscalYear}`): IoPeriod {
  return {
    label, end, start: null, fiscalYear, fiscalQuarter, filingDate: end, publishedAt: end, accession: "x",
    currency: "USD", values, valuationBasis: null,
  };
}

const quarters = [
  period("2025-03-31", 2025, "Q1", { revenue: 100, capitalExpenditures: 10, operatingCashFlow: 30, freeCashFlow: 20, cashAndEquivalents: 50, shortTermInvestments: 25, totalDebt: 40, roic: 0.05 }),
  period("2025-06-30", 2025, "Q2", { revenue: 110, capitalExpenditures: 20, operatingCashFlow: 25, freeCashFlow: 5, cashAndEquivalents: 40, shortTermInvestments: null, totalDebt: 60, roic: 0.04 }),
  period("2025-09-30", 2025, "Q3", { revenue: 120, capitalExpenditures: 40, operatingCashFlow: 30, freeCashFlow: -10, cashAndEquivalents: null, totalDebt: 70 }),
  period("2025-12-31", 2025, "Q4", { revenue: 130, capitalExpenditures: 30, operatingCashFlow: 50, freeCashFlow: 20, cashAndEquivalents: 60, totalDebt: 70 }),
  period("2026-03-31", 2026, "Q1", { revenue: 150, capitalExpenditures: 30, operatingCashFlow: 50, freeCashFlow: 20, cashAndEquivalents: 60, totalDebt: 70 }),
];
const trailing = [
  period("2025-12-31", 2025, "Q4", { revenue: 460, roic: 0.2 }, "TTM Q4 FY2025"),
  period("2026-03-31", 2026, "Q1", { revenue: 510, roic: 0.22 }, "TTM Q1 FY2026"),
];

const view = {
  company: { ticker: "TEST", name: "Test", cik: "1", exchange: "", sector: "", currency: "USD", description: "", businessType: null, resolution: "full" },
  retrievedAt: "2026-04-30", current: null, metrics: [], annual: [], quarterly: quarters, trailing, ttm: trailing[1],
  basis: null, basisReason: null, withheldReason: null, fcfNote: null, warnings: [],
} as unknown as IoCompanyView;

const preset = (id: string) => PRESETS.find((entry) => entry.id === id)!;

describe("fundamental chart presets", () => {
  it("labels quarters and years the short way", () => {
    expect(shortLabel(quarters[0], "quarterly")).toBe("Q1'25");
    expect(shortLabel(period("2025-12-31", 2025, null, {}), "annual")).toBe("FY25");
  });

  it("draws capex as a positive bar beside the cash flows", () => {
    const data = buildPreset(preset("cash-flow"), view, "quarterly", "MAX", new Map())!;
    expect(data.labels).toEqual(["Q1'25", "Q2'25", "Q3'25", "Q4'25", "Q1'26"]);
    expect(data.series.map((entry) => entry.spec.id)).toEqual(["capex", "ocf", "fcf"]);
    expect(data.series[2].values[2]).toBe(-10);
  });

  it("counts short-term investments as cash, and has no net cash without a cash balance", () => {
    const data = buildPreset(preset("cash-debt"), view, "quarterly", "MAX", new Map())!;
    const net = data.series.find((entry) => entry.spec.id === "net")!;
    expect(net.values.slice(0, 3)).toEqual([35, -20, null]);
  });

  it("reads revenue growth against the period a year earlier", () => {
    const data = buildPreset(preset("revenue"), view, "quarterly", "MAX", new Map())!;
    const growth = data.series.find((entry) => entry.spec.id === "growth")!;
    expect(growth.values.at(-1)).toBeCloseTo(0.5);
    expect(growth.values[0]).toBeNull();
  });

  it("reads returns on capital over the trailing year on a quarterly chart", () => {
    const data = buildPreset(preset("returns"), view, "quarterly", "MAX", new Map())!;
    // Quarters with no trailing period are trimmed from the front.
    expect(data.labels).toEqual(["Q4'25", "Q1'26"]);
    expect(data.series[0].values).toEqual([0.2, 0.22]);
  });

  it("offers the backlog only where the filer states one, with coverage on trailing revenue", () => {
    expect(buildPreset(preset("backlog"), view, "quarterly", "MAX", new Map())).toBeNull();
    const data = buildPreset(preset("backlog"), view, "quarterly", "MAX", new Map([["2025-12-31", 920], ["2026-03-31", 1530]]))!;
    expect(data.series[0].values).toEqual([920, 1530]);
    expect(data.series[1].values).toEqual([2, 3]);
  });

  it("leaves out a series the company never files, and the chart when nothing is left", () => {
    const data = buildPreset(preset("shareholder"), view, "quarterly", "MAX", new Map())!;
    expect(data.series.map((entry) => entry.spec.id)).toEqual(["fcf"]);
    expect(buildPreset(preset("balance"), view, "quarterly", "MAX", new Map())).toBeNull();
  });

  it("withholds from a bank the charts the site withholds from it", () => {
    const bank = { ...view, company: { ...view.company, businessType: "bank" } } as IoCompanyView;
    expect(buildPreset(preset("cash-flow"), bank, "quarterly", "MAX", new Map())).toBeNull();
    expect(buildPreset(preset("cash-debt"), bank, "quarterly", "MAX", new Map())).toBeNull();
    expect(buildPreset(preset("revenue"), bank, "quarterly", "MAX", new Map())).not.toBeNull();
  });

  it("cuts the window to the range asked for", () => {
    expect(pointsIn("5Y", "quarterly")).toBe(20);
    expect(pointsIn("10Y", "annual")).toBe(10);
    expect(pointsIn("MAX", "ttm")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("chart axes", () => {
  it("steps on round numbers", () => {
    expect(niceStep(600, 4)).toBe(200);
    expect(niceStep(9, 4)).toBe(2.5);
    expect(niceStep(0.37, 4)).toBe(0.1);
  });

  it("includes zero under bars and crops a line-only axis to its band", () => {
    expect(axisFor([30, 520], true)).toEqual({ min: 0, max: 600, ticks: [0, 200, 400, 600] });
    const band = axisFor([2.1, 7.1], false)!;
    expect(band.min).toBeGreaterThan(0);
    expect(band.ticks[0]).toBe(band.min);
    expect(axisFor([-6, 52], true)!.min).toBeLessThan(0);
    expect(axisFor([null, null], true)).toBeNull();
  });
});

describe("backlog from the SEC", () => {
  it("keeps the latest filing's value for every date", () => {
    expect(latestByDate([
      { end: "2025-12-31", val: 100, filed: "2026-02-01", form: "10-K" },
      { end: "2025-12-31", val: 105, filed: "2027-02-01", form: "10-K" },
      { end: "2025-09-30", val: 90, filed: "2025-10-30", form: "10-Q" },
      { end: "2025-06-30", val: undefined, filed: "2025-07-30" },
    ])).toEqual([
      { end: "2025-09-30", value: 90, filed: "2025-10-30", form: "10-Q" },
      { end: "2025-12-31", value: 105, filed: "2027-02-01", form: "10-K" },
    ]);
  });
});
