import { applyDcfFoundation } from "../dcf-foundation";
import { balanceSheetIsTheBusiness } from "../business-type";
import {
  calculateDcf,
  defaultDcfAssumptions,
  type DcfAssumptions,
  type DcfBase,
  type DcfResult,
  type ScenarioName,
} from "../dcf";
import type { IoCompanyView, IoPeriod } from "./view";
import type { BusinessType } from "../types";

export type DcfScenarioSet = Record<ScenarioName, DcfAssumptions>;

export interface IoDcfFoundationRow {
  metric: "revenueGrowth" | "operatingMargin" | "taxRate" | "depreciationPercentRevenue" | "capexPercentRevenue" | "workingCapitalPercentRevenue" | "freeCashFlowMargin" | "shareChange";
  label: string;
  formula: string;
  latest: number | null;
  average3: number | null;
  average5: number | null;
  average10: number | null;
  average20: number | null;
  suggested: number | null;
}

const known = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
const value = (period: IoPeriod | undefined, metric: string) => {
  const reading = period?.values[metric];
  return known(reading) ? reading : null;
};

const mean = (values: Array<number | null>, count: number) => {
  const usable = values.slice(-count).filter(known);
  return usable.length ? usable.reduce((sum, reading) => sum + reading, 0) / usable.length : null;
};

export function fullDcfBase(view: IoCompanyView): DcfBase | null {
  if (balanceSheetIsTheBusiness((view.company.businessType ?? undefined) as BusinessType | undefined)) return null;
  const latest = view.annual.at(-1);
  const revenue = value(latest, "revenue");
  const operatingMargin = value(latest, "operatingMargin");
  const freeCashFlow = value(latest, "freeCashFlow");
  const dilutedShares = value(latest, "dilutedShares");
  const cash = value(latest, "cashAndEquivalents");
  const debt = value(latest, "totalDebt");
  if (
    !known(revenue) || revenue <= 0
    || !known(operatingMargin)
    || !known(freeCashFlow)
    || !known(dilutedShares) || dilutedShares <= 0
    || !known(cash)
    || !known(debt)
  ) return null;
  return { revenue, operatingMargin, freeCashFlow, dilutedShares, cash, debt };
}

export function fullDcfFoundation(view: IoCompanyView): IoDcfFoundationRow[] {
  const annual = view.annual;
  const series = (metric: IoDcfFoundationRow["metric"]): Array<number | null> => annual.map((period, index) => {
    const prior = annual[index - 1];
    const revenue = value(period, "revenue");
    if (metric === "revenueGrowth") {
      const previousRevenue = value(prior, "revenue");
      return known(revenue) && known(previousRevenue) && previousRevenue > 0 ? revenue / previousRevenue - 1 : null;
    }
    if (metric === "operatingMargin") return value(period, "operatingMargin");
    if (metric === "taxRate") return value(period, "effectiveTaxRate");
    if (metric === "depreciationPercentRevenue") {
      const depreciation = value(period, "depreciationAndAmortization");
      return known(revenue) && revenue > 0 && known(depreciation) ? Math.abs(depreciation) / revenue : null;
    }
    if (metric === "capexPercentRevenue") {
      const capex = value(period, "capitalExpenditures");
      return known(revenue) && revenue > 0 && known(capex) ? Math.abs(capex) / revenue : null;
    }
    if (metric === "freeCashFlowMargin") {
      const cash = value(period, "freeCashFlow");
      return known(revenue) && revenue > 0 && known(cash) ? cash / revenue : null;
    }
    if (metric === "shareChange") {
      const shares = value(period, "dilutedShares");
      const previousShares = value(prior, "dilutedShares");
      return known(shares) && known(previousShares) && previousShares > 0 ? shares / previousShares - 1 : null;
    }
    const workingCapital = value(period, "netWorkingCapital");
    const previousWorkingCapital = value(prior, "netWorkingCapital");
    return known(revenue) && revenue !== 0 && known(workingCapital) && known(previousWorkingCapital)
      ? (workingCapital - previousWorkingCapital) / revenue
      : null;
  });

  const definitions: Array<[IoDcfFoundationRow["metric"], string, string]> = [
    ["revenueGrowth", "Revenue growth", "Revenue / prior revenue − 1"],
    ["operatingMargin", "Operating margin", "Operating income / revenue"],
    ["taxRate", "Effective tax rate", "Tax expense / pre-tax income"],
    ["depreciationPercentRevenue", "D&A / revenue", "D&A / revenue"],
    ["capexPercentRevenue", "Capex / revenue", "|Capex| / revenue"],
    ["workingCapitalPercentRevenue", "Δ NWC / revenue", "(NWC − prior NWC) / revenue"],
    ["freeCashFlowMargin", "FCF margin", "FCF / revenue"],
    ["shareChange", "Share-count change", "Diluted shares / prior shares − 1"],
  ];

  return definitions.map(([metric, label, formula]) => {
    const values = series(metric);
    const average3 = mean(values, 3);
    const average5 = mean(values, 5);
    const average10 = mean(values, 10);
    const average20 = mean(values, 20);
    return {
      metric,
      label,
      formula,
      latest: values.at(-1) ?? null,
      average3,
      average5,
      average10,
      average20,
      suggested: average5 ?? average3 ?? values.at(-1) ?? null,
    };
  });
}

const shift = (values: number[], amount: number, floor = -0.5, ceiling = 1) => values.map((reading) => Math.min(ceiling, Math.max(floor, reading + amount)));
const bounded = (values: number[], floor: number, ceiling: number) => values.map((reading) => Math.min(ceiling, Math.max(floor, reading)));

export function defaultFullDcfScenarios(view: IoCompanyView, years = 10): DcfScenarioSet | null {
  const base = fullDcfBase(view);
  if (!base) return null;
  const foundation = fullDcfFoundation(view);
  const filed = applyDcfFoundation(defaultDcfAssumptions(base, years, "base"), foundation);
  // Filing-derived averages are the anchor, but a one-off tax benefit or a
  // near-zero comparison year must not silently become a perpetual forecast.
  const middle: DcfAssumptions = {
    ...filed,
    revenueGrowth: bounded(filed.revenueGrowth, -.25, .50),
    operatingMargin: bounded(filed.operatingMargin, -.20, .70),
    taxRate: bounded(filed.taxRate, 0, .50),
    depreciationPercentRevenue: bounded(filed.depreciationPercentRevenue, 0, .30),
    capexPercentRevenue: bounded(filed.capexPercentRevenue, 0, .50),
    workingCapitalPercentRevenue: bounded(filed.workingCapitalPercentRevenue, -.30, .30),
    directFcfMargin: bounded(filed.directFcfMargin, -.50, .70),
    shareChange: bounded(filed.shareChange, -.20, .20),
  };
  const bear: DcfAssumptions = {
    ...middle,
    revenueGrowth: shift(middle.revenueGrowth, -0.03),
    operatingMargin: shift(middle.operatingMargin, -0.03, 0, 1),
    shareChange: shift(middle.shareChange, 0.01),
    wacc: Math.min(0.3, middle.wacc + 0.015),
    terminalGrowth: Math.max(-0.02, middle.terminalGrowth - 0.005),
  };
  const bull: DcfAssumptions = {
    ...middle,
    revenueGrowth: shift(middle.revenueGrowth, 0.03),
    operatingMargin: shift(middle.operatingMargin, 0.03, 0, 1),
    shareChange: shift(middle.shareChange, -0.005),
    wacc: Math.max(0.01, middle.wacc - 0.01),
    terminalGrowth: Math.min(middle.wacc - 0.005, middle.terminalGrowth + 0.005),
  };
  return { bear, base: middle, bull };
}

export interface TerminalConsistency {
  state: "coherent" | "review" | "inconsistent" | "not-applicable";
  reinvestmentRate: number | null;
  impliedReturnOnCapital: number | null;
  excessReturn: number | null;
  message: string;
}

export function terminalConsistency(result: DcfResult, assumptions: DcfAssumptions): TerminalConsistency {
  if (assumptions.terminalMethod !== "perpetual-growth") {
    return {
      state: "not-applicable",
      reinvestmentRate: null,
      impliedReturnOnCapital: null,
      excessReturn: null,
      message: "The exit multiple is a relative valuation assumption, so no perpetual reinvestment identity can be tested.",
    };
  }
  if (assumptions.method !== "fcff" || !result.projections.length) {
    return {
      state: "not-applicable",
      reinvestmentRate: null,
      impliedReturnOnCapital: null,
      excessReturn: null,
      message: "The direct-FCF fallback does not expose the operating reinvestment needed for this check.",
    };
  }
  const last = result.projections.at(-1)!;
  const reinvestment = last.capex - last.depreciation + last.changeInWorkingCapital;
  const reinvestmentRate = last.nopat > 0 ? reinvestment / last.nopat : null;
  if (assumptions.terminalGrowth > 0 && (!known(reinvestmentRate) || reinvestmentRate <= 0)) {
    return {
      state: "inconsistent",
      reinvestmentRate,
      impliedReturnOnCapital: null,
      excessReturn: null,
      message: "Positive perpetual growth is paired with no positive reinvestment. Lower growth or raise terminal reinvestment.",
    };
  }
  if (!known(reinvestmentRate) || reinvestmentRate === 0 || assumptions.terminalGrowth <= 0) {
    return {
      state: "coherent",
      reinvestmentRate,
      impliedReturnOnCapital: null,
      excessReturn: null,
      message: "No positive perpetual growth is being financed, so the growth/reinvestment identity adds no further constraint.",
    };
  }
  const impliedReturnOnCapital = assumptions.terminalGrowth / reinvestmentRate;
  const excessReturn = impliedReturnOnCapital - assumptions.wacc;
  const state = excessReturn > 0.05 || impliedReturnOnCapital <= 0 ? "review" : "coherent";
  return {
    state,
    reinvestmentRate,
    impliedReturnOnCapital,
    excessReturn,
    message: state === "review"
      ? "The terminal period assumes unusually durable excess returns. Check whether the competitive advantage can plausibly persist."
      : "Terminal growth, reinvestment and the implied return on capital are mutually consistent.",
  };
}

export function scenarioResults(view: IoCompanyView, scenarios: DcfScenarioSet) {
  const base = fullDcfBase(view);
  if (!base) return null;
  return {
    bear: calculateDcf(base, scenarios.bear),
    base: calculateDcf(base, scenarios.base),
    bull: calculateDcf(base, scenarios.bull),
  };
}
