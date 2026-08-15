import { describe, expect, it } from "vitest";
import { calculateDcf, calculateWacc, type DcfAssumptions, type DcfBase } from "../lib/dcf";

/**
 * An audit of the DCF engine, written by probing it rather than by reading it.
 *
 * Four defects were found this way and are fixed; each has a test here that
 * fails against the old behaviour. The rest of the file pins the identities the
 * model must satisfy, so a future change to the projection loop cannot quietly
 * break one of them.
 */

const base: DcfBase = { revenue: 1_000, operatingMargin: .3, freeCashFlow: 200, dilutedShares: 100, cash: 300, debt: 200 };
const fill = (value: number, n = 10) => Array.from({ length: n }, () => value);
const assumptions = (over: Partial<DcfAssumptions> = {}): DcfAssumptions => ({
  method: "fcff", terminalMethod: "perpetual-growth", forecastYears: 10,
  revenueGrowth: fill(.05), operatingMargin: fill(.3), taxRate: fill(.21),
  depreciationPercentRevenue: fill(.05), capexPercentRevenue: fill(.05),
  workingCapitalPercentRevenue: fill(.01), directFcfMargin: fill(.2),
  shareChange: fill(0), wacc: .09, terminalGrowth: .025, exitMultiple: 15, otherClaims: 0, ...over,
});

describe("defects found by audit", () => {
  it("does not let a buyback raise value per share, because the cash is already counted", () => {
    // Free cash flow to the firm contains the cash a repurchase spends. Also
    // shrinking the divisor credits it twice: this used to lift value per
    // share from 44.22 to 54.12, a 22% gain out of nothing.
    const flat = calculateDcf(base, assumptions());
    const buybacks = calculateDcf(base, assumptions({ shareChange: fill(-.02) }));
    expect(buybacks.intrinsicValuePerShare).toBeCloseTo(flat.intrinsicValuePerShare!, 6);
    expect(buybacks.warnings.join(" ")).toMatch(/count it twice/);
    // The projected share count still falls — that projection is honest, it is
    // only the valuation divisor that must not use it.
    expect(buybacks.projections.at(-1)!.dilutedShares).toBeLessThan(base.dilutedShares);
  });

  it("still lets issuance dilute, because shares given away never pass through cash flow", () => {
    const flat = calculateDcf(base, assumptions());
    const diluted = calculateDcf(base, assumptions({ shareChange: fill(.02) }));
    expect(diluted.intrinsicValuePerShare!).toBeLessThan(flat.intrinsicValuePerShare!);
    expect(diluted.warnings).toEqual([]);
  });

  it("stops on a non-finite intermediate instead of returning NaN", () => {
    // This used to return enterpriseValue NaN with no warning at all.
    const result = calculateDcf(base, assumptions({ revenueGrowth: fill(Number.NaN) }));
    expect(result.enterpriseValue).toBeNull();
    expect(result.intrinsicValuePerShare).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/revenue growth is not a finite number/);
  });

  it("stops on an infinite intermediate and names it", () => {
    const result = calculateDcf(base, assumptions({ operatingMargin: fill(Infinity) }));
    expect(result.enterpriseValue).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/operating margin is not a finite number/);
  });

  it("never puts a NaN in the projection table", () => {
    const result = calculateDcf({ ...base, dilutedShares: 0 }, assumptions());
    for (const projection of result.projections) {
      expect(projection.freeCashFlowPerShare === null || Number.isFinite(projection.freeCashFlowPerShare)).toBe(true);
      for (const value of [projection.revenue, projection.nopat, projection.freeCashFlow, projection.presentValue]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe("conditions that must stop the model", () => {
  it("refuses a terminal growth at or above the discount rate", () => {
    for (const terminalGrowth of [.09, .12]) {
      const result = calculateDcf(base, assumptions({ terminalGrowth }));
      expect(result.enterpriseValue).toBeNull();
      expect(result.warnings.join(" ")).toMatch(/lower than WACC/);
    }
  });

  it("refuses a discount rate that is zero or negative", () => {
    for (const wacc of [0, -.05]) {
      expect(calculateDcf(base, assumptions({ wacc })).enterpriseValue).toBeNull();
    }
  });

  it("gives no value per share without a share count", () => {
    expect(calculateDcf({ ...base, dilutedShares: 0 }, assumptions()).intrinsicValuePerShare).toBeNull();
  });

  it("refuses a perpetual terminal value on negative final cash flow", () => {
    const result = calculateDcf(base, assumptions({ operatingMargin: fill(-.5) }));
    expect(result.terminalValue).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/not positive/);
  });
});

describe("identities the model must satisfy", () => {
  const result = calculateDcf(base, assumptions());

  it("discounts each year by exactly one more period", () => {
    for (const [index, projection] of result.projections.entries()) {
      expect(projection.discountFactor).toBeCloseTo(1 / 1.09 ** (index + 1), 12);
    }
    expect(result.projections).toHaveLength(10);
  });

  it("builds free cash flow to the firm from NOPAT, not from net income", () => {
    for (const projection of result.projections) {
      expect(projection.nopat).toBeCloseTo(projection.operatingIncome * (1 - projection.taxRate), 10);
      expect(projection.freeCashFlow).toBeCloseTo(
        projection.nopat + projection.depreciation - projection.capex - projection.changeInWorkingCapital, 10);
    }
  });

  it("sums the present values it reports", () => {
    const sum = result.projections.reduce((total, projection) => total + projection.presentValue, 0);
    expect(result.presentValueForecast).toBeCloseTo(sum, 8);
    expect(result.enterpriseValue!).toBeCloseTo(result.presentValueForecast + result.presentValueTerminal!, 8);
  });

  it("bridges enterprise value to equity value with cash, debt and other claims", () => {
    const withClaims = calculateDcf(base, assumptions({ otherClaims: 150 }));
    expect(withClaims.equityValue!).toBeCloseTo(withClaims.enterpriseValue! + base.cash - base.debt - 150, 8);
  });

  it("divides equity value by the share count it says it used", () => {
    expect(result.intrinsicValuePerShare!).toBeCloseTo(result.equityValue! / base.dilutedShares, 8);
  });

  it("discounts the terminal value by the final year's factor, not one beyond it", () => {
    const last = result.projections.at(-1)!;
    expect(result.presentValueTerminal!).toBeCloseTo(result.terminalValue! * last.discountFactor, 8);
    expect(result.terminalValue!).toBeCloseTo(last.freeCashFlow * 1.025 / (.09 - .025), 8);
  });

  it("warns when the answer is mostly terminal value", () => {
    expect(result.terminalValueWeight!).toBeGreaterThan(0);
    const heavy = calculateDcf(base, assumptions({ terminalGrowth: .07 }));
    expect(heavy.terminalValueWeight!).toBeGreaterThan(.75);
    expect(heavy.warnings.join(" ")).toMatch(/highly assumption-sensitive/);
  });
});

describe("the cost of capital", () => {
  it("weights equity and debt by their market values, and taxes the debt", () => {
    const wacc = calculateWacc({ riskFreeRate: .04, equityRiskPremium: .05, beta: 1.2, preTaxCostOfDebt: .05, taxRate: .21, marketValueEquity: 800, debtValue: 200 });
    expect(wacc.costOfEquity).toBeCloseTo(.04 + 1.2 * .05, 12);
    expect(wacc.afterTaxCostOfDebt).toBeCloseTo(.05 * .79, 12);
    expect(wacc.equityWeight).toBeCloseTo(.8, 12);
    expect(wacc.wacc).toBeCloseTo(.8 * .1 + .2 * .0395, 12);
  });

  it("gives no rate without a capital structure to weight", () => {
    expect(calculateWacc({ riskFreeRate: .04, equityRiskPremium: .05, beta: 1, preTaxCostOfDebt: .05, taxRate: .21, marketValueEquity: 0, debtValue: 0 }).wacc).toBeNull();
  });
});

describe("interest is counted once", () => {
  it("never subtracts interest from a cash flow discounted at the cost of capital", () => {
    // FCFF is pre-interest by construction: the cost of debt enters through
    // WACC. Subtracting interest here as well would charge for the debt twice.
    const result = calculateDcf(base, assumptions());
    for (const projection of result.projections) {
      expect(projection.freeCashFlow).toBeCloseTo(
        projection.nopat + projection.depreciation - projection.capex - projection.changeInWorkingCapital, 10);
    }
  });
});
