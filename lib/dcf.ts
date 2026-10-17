export type DcfMethod = "fcff" | "direct-fcf";
export type TerminalMethod = "perpetual-growth" | "exit-multiple";
export type ScenarioName = "bear" | "base" | "bull";

export interface WaccInputs {
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  preTaxCostOfDebt: number;
  taxRate: number;
  marketValueEquity: number;
  debtValue: number;
}

export interface DcfBase {
  revenue: number;
  operatingMargin: number;
  freeCashFlow: number;
  dilutedShares: number;
  cash: number;
  debt: number;
}

export interface DcfAssumptions {
  method: DcfMethod;
  terminalMethod: TerminalMethod;
  forecastYears: number;
  revenueGrowth: number[];
  operatingMargin: number[];
  taxRate: number[];
  depreciationPercentRevenue: number[];
  capexPercentRevenue: number[];
  workingCapitalPercentRevenue: number[];
  directFcfMargin: number[];
  shareChange: number[];
  wacc: number;
  terminalGrowth: number;
  exitMultiple: number;
  otherClaims: number;
  /** Optional normalized terminal-year reinvestment identity. Legacy explicit models may omit it. */
  terminalReturnOnCapital?: number;
  terminalTaxRate?: number;
  /** FCFF from GAAP EBIT already expenses stock compensation. Do not also extrapolate historical dilution. */
  stockCompensationTreatment?: "expensed" | "additional-dilution";
  /** Net investment as a share of revenue. Used when gross spending cannot be forecast from accounting D&A. */
  netReinvestmentPercentRevenue?: number[];
}

export interface DcfProjection {
  year: number;
  revenueGrowth: number;
  revenue: number;
  operatingMargin: number;
  operatingIncome: number;
  taxRate: number;
  nopat: number;
  depreciation: number;
  capex: number;
  changeInWorkingCapital: number;
  freeCashFlow: number;
  dilutedShares: number;
  freeCashFlowPerShare: number | null;
  discountFactor: number;
  presentValue: number;
  netReinvestment: number;
}

export interface DcfResult {
  projections: DcfProjection[];
  terminalValue: number | null;
  presentValueTerminal: number | null;
  presentValueForecast: number;
  enterpriseValue: number | null;
  equityValue: number | null;
  intrinsicValuePerShare: number | null;
  /**
   * The share count equity value is actually divided by.
   * Reported separately from the projected ending count because the two differ
   * whenever a buyback is assumed, and a reader shown only the ending count
   * cannot reproduce the per-share figure from the numbers on screen.
   */
  valuationShares: number;
  terminalValueWeight: number | null;
  terminalCashFlow?: number | null;
  terminalReinvestment?: number | null;
  dilutionAdjustment?: number;
  warnings: string[];
}

export function calculateWacc(inputs: WaccInputs) {
  const costOfEquity = inputs.riskFreeRate + inputs.beta * inputs.equityRiskPremium;
  const afterTaxCostOfDebt = inputs.preTaxCostOfDebt * (1 - inputs.taxRate);
  const totalCapital = inputs.marketValueEquity + inputs.debtValue;
  if (totalCapital <= 0) return { costOfEquity, afterTaxCostOfDebt, equityWeight: null, debtWeight: null, wacc: null };
  const equityWeight = inputs.marketValueEquity / totalCapital; const debtWeight = inputs.debtValue / totalCapital;
  return { costOfEquity, afterTaxCostOfDebt, equityWeight, debtWeight, wacc: equityWeight * costOfEquity + debtWeight * afterTaxCostOfDebt };
}

function at(values: number[], index: number) { return values[index] ?? values.at(-1) ?? 0; }

export function calculateDcf(base: DcfBase, assumptions: DcfAssumptions): DcfResult {
  const warnings: string[] = [];
  const invalid = (message: string): DcfResult => ({ projections: [], terminalValue: null, presentValueTerminal: null, presentValueForecast: 0, enterpriseValue: null, equityValue: null, intrinsicValuePerShare: null, valuationShares: base.dilutedShares, terminalValueWeight: null, warnings: [message] });
  if (![base.revenue, base.operatingMargin, base.cash, base.debt, base.dilutedShares, assumptions.otherClaims].every(Number.isFinite)) return invalid("A required base value or equity claim is not finite.");
  if (!Number.isFinite(assumptions.forecastYears)) return invalid("Forecast years must be finite.");
  if (base.revenue <= 0 || base.cash < 0 || base.debt < 0 || assumptions.otherClaims < 0) return invalid("Revenue must be positive; cash, debt and other claims must be nonnegative.");
  if (!Number.isFinite(assumptions.wacc) || assumptions.wacc <= 0) return invalid("WACC must be finite and positive for every terminal method.");
  if (assumptions.terminalMethod === "perpetual-growth" && (!Number.isFinite(assumptions.terminalGrowth) || assumptions.terminalGrowth <= -1)) return invalid("Terminal growth must be finite and greater than −100%.");
  if (assumptions.terminalReturnOnCapital != null && (!Number.isFinite(assumptions.terminalReturnOnCapital) || assumptions.terminalReturnOnCapital <= 0)) return invalid("Terminal return on capital must be finite and positive.");
  if (assumptions.stockCompensationTreatment !== "expensed" && assumptions.shareChange.some(v => v > 0)) return invalid("Future share issuance requires a proceeds and equity-claims schedule. A historical dilution rate alone cannot value the existing equity.");
  const years = Math.max(1, Math.min(30, Math.round(assumptions.forecastYears)));
  if (years !== assumptions.forecastYears) warnings.push("Forecast period was constrained to 1–30 whole years.");
  if (!Number.isFinite(assumptions.wacc) || assumptions.wacc <= 0) warnings.push("WACC must be a finite positive rate.");
  if (base.dilutedShares <= 0) warnings.push("Diluted shares must be positive; per-share value is unavailable.");
  let revenue = base.revenue; let shares = base.dilutedShares; const projections: DcfProjection[] = [];
  // Current fully diluted shares divide equity value. Recurring employee awards
  // are already expensed in GAAP operating profit. Future corporate issuance
  // requires its own cash proceeds and equity-claims schedule, not a rate.
  const valuationShares = base.dilutedShares;
  const dilutionAdjustment = 0;
  let buybackAssumed = false;
  /** The first intermediate that stops being a number stops the whole model. */
  let broken: string | null = null;
  const finite = (label: string, value: number) => {
    if (broken == null && !Number.isFinite(value)) broken = label;
    return value;
  };
  for (let index = 0; index < years; index++) {
    const revenueGrowth = finite("revenue growth", at(assumptions.revenueGrowth, index)); revenue = finite("revenue", revenue * (1 + revenueGrowth));
    const operatingMargin = finite("operating margin", at(assumptions.operatingMargin, index)); const operatingIncome = finite("operating income", revenue * operatingMargin);
    const taxRate = finite("tax rate", at(assumptions.taxRate, index));
    if (taxRate < 0 || taxRate > 1) return invalid("Tax rates must be between 0% and 100%.");
    if (revenueGrowth <= -1) return invalid("Revenue growth must be greater than −100%.");
    // Losses do not generate an immediate cash tax refund without an explicit tax-loss schedule.
    const nopat = finite("NOPAT", operatingIncome - Math.max(0, operatingIncome) * taxRate);
    const depreciation = finite("depreciation", revenue * at(assumptions.depreciationPercentRevenue, index));
    const capex = finite("capital expenditure", revenue * at(assumptions.capexPercentRevenue, index));
    const changeInWorkingCapital = finite("working-capital change", revenue * at(assumptions.workingCapitalPercentRevenue, index));
    const netReinvestment = finite("net reinvestment", assumptions.netReinvestmentPercentRevenue
      ? revenue * at(assumptions.netReinvestmentPercentRevenue, index) : capex - depreciation + changeInWorkingCapital);
    const freeCashFlow = finite("free cash flow", assumptions.method === "fcff"
      ? nopat - netReinvestment
      : revenue * at(assumptions.directFcfMargin, index));
    const shareChange = finite("share change", at(assumptions.shareChange, index));
    if (shareChange <= -1) return invalid("Share change must be greater than −100%.");
    shares *= 1 + shareChange;
    if (shareChange < 0) buybackAssumed = true;
    const discountFactor = finite("discount factor", 1 / Math.pow(1 + assumptions.wacc, index + 1));
    const presentValue = finite("present value", freeCashFlow * discountFactor);
    projections.push({ year: index + 1, revenueGrowth, revenue, operatingMargin, operatingIncome, taxRate, nopat, depreciation, capex, changeInWorkingCapital, freeCashFlow, dilutedShares: shares, freeCashFlowPerShare: shares > 0 && Number.isFinite(freeCashFlow) ? freeCashFlow / shares : null, discountFactor, presentValue, netReinvestment });
  }
  const last = projections.at(-1)!;
  if (broken != null) {
    warnings.push(`The model stopped: the projected ${broken} is not a finite number. Check the assumption behind it.`);
    return { projections, terminalValue: null, presentValueTerminal: null, presentValueForecast: 0, enterpriseValue: null, equityValue: null, intrinsicValuePerShare: null, valuationShares, terminalValueWeight: null, warnings };
  }
  if (buybackAssumed) {
    warnings.push("Negative share change is ignored when dividing equity value: free cash flow already contains the cash a buyback spends, so shrinking the share count too would count it twice. Issuance still dilutes.");
  }
  let terminalValue: number | null;
  let terminalCashFlow = last.freeCashFlow * (1 + assumptions.terminalGrowth);
  let terminalReinvestment: number | null = null;
  if (assumptions.terminalMethod === "perpetual-growth" && assumptions.terminalReturnOnCapital != null) {
    const terminalTax = assumptions.terminalTaxRate ?? last.taxRate;
    if (!Number.isFinite(terminalTax) || terminalTax < 0 || terminalTax > 1) return invalid("Terminal tax must be between 0% and 100%.");
    const nextOperating = last.revenue * (1 + assumptions.terminalGrowth) * last.operatingMargin;
    const nextNopat = nextOperating - Math.max(0, nextOperating) * terminalTax;
    terminalReinvestment = nextNopat * assumptions.terminalGrowth / assumptions.terminalReturnOnCapital;
    terminalCashFlow = nextNopat - terminalReinvestment;
  }
  if (assumptions.terminalMethod === "perpetual-growth") {
    if (!Number.isFinite(assumptions.wacc) || assumptions.wacc <= 0) {
      terminalValue = null; warnings.push("Perpetual-growth terminal value is unavailable until WACC is positive.");
    } else if (terminalCashFlow <= 0) {
      terminalValue = null; warnings.push("Perpetual-growth terminal value is unavailable because final-year FCFF is not positive.");
    } else if (assumptions.terminalGrowth >= assumptions.wacc) {
      terminalValue = null; warnings.push("Terminal growth must be lower than WACC.");
    } else terminalValue = terminalCashFlow / (assumptions.wacc - assumptions.terminalGrowth);
  } else {
    if (last.freeCashFlow <= 0 || assumptions.exitMultiple <= 0 || !Number.isFinite(assumptions.exitMultiple)) {
      terminalValue = null; warnings.push("Exit-multiple terminal value requires positive final-year FCFF and a positive finite multiple.");
    } else { terminalValue = last.freeCashFlow * assumptions.exitMultiple; warnings.push("Exit multiple is a relative valuation assumption, not an intrinsic-growth identity."); }
  }
  if (terminalValue != null && terminalValue < 0) warnings.push("Terminal value is negative because final-year free cash flow or the selected multiple is negative.");
  const presentValueForecast = projections.reduce((sum, projection) => sum + projection.presentValue, 0);
  const presentValueTerminal = terminalValue == null ? null : terminalValue * last.discountFactor;
  const enterpriseValue = presentValueTerminal == null ? null : presentValueForecast + presentValueTerminal;
  const equityValue = enterpriseValue == null ? null : enterpriseValue + base.cash - base.debt - assumptions.otherClaims - dilutionAdjustment;
  const intrinsicValuePerShare = equityValue == null || valuationShares <= 0 || !Number.isFinite(valuationShares) ? null : equityValue / valuationShares;
  const terminalValueWeight = enterpriseValue == null || enterpriseValue === 0 || presentValueTerminal == null ? null : presentValueTerminal / enterpriseValue;
  if (terminalValueWeight != null && terminalValueWeight > .75) warnings.push("Terminal value exceeds 75% of enterprise value; the result is highly assumption-sensitive.");
  if (assumptions.stockCompensationTreatment === "expensed" && assumptions.shareChange.some(v => v > 0)) warnings.push("Stock compensation is expensed in operating profit; no additional dilution deduction is applied. Review separately funded share issues and outstanding awards.");
  return { projections, terminalValue, presentValueTerminal, presentValueForecast, enterpriseValue, equityValue, intrinsicValuePerShare, valuationShares, terminalValueWeight, terminalCashFlow, terminalReinvestment, dilutionAdjustment, warnings };
}

export function defaultDcfAssumptions(base: DcfBase, years = 10, scenario: ScenarioName = "base"): DcfAssumptions {
  const scenarioMap = {
    bear: { growth: .05, margin: Math.max(0, base.operatingMargin - .03), wacc: .105, terminal: .02, dilution: .01 },
    base: { growth: .09, margin: base.operatingMargin, wacc: .09, terminal: .025, dilution: 0 },
    bull: { growth: .13, margin: base.operatingMargin + .03, wacc: .08, terminal: .03, dilution: -.005 },
  }[scenario];
  const count = Math.max(1, Math.min(30, years)); const repeat = (value: number) => Array.from({ length: count }, () => value);
  const fcfMargin = base.revenue ? base.freeCashFlow / base.revenue : 0;
  return { method: "fcff", terminalMethod: "perpetual-growth", forecastYears: count, revenueGrowth: repeat(scenarioMap.growth), operatingMargin: repeat(scenarioMap.margin), taxRate: repeat(.21), depreciationPercentRevenue: repeat(.035), capexPercentRevenue: repeat(.04), workingCapitalPercentRevenue: repeat(.01), directFcfMargin: repeat(fcfMargin), shareChange: repeat(0), wacc: scenarioMap.wacc, terminalGrowth: scenarioMap.terminal, exitMultiple: 18, otherClaims: 0, stockCompensationTreatment: "expensed" };
}

export function sensitivityMatrix(base: DcfBase, assumptions: DcfAssumptions, waccValues: number[], terminalValues: number[]) {
  return waccValues.map((wacc) => terminalValues.map((terminal) => calculateDcf(base, { ...assumptions, wacc, ...(assumptions.terminalMethod === "perpetual-growth" ? { terminalGrowth: terminal } : { exitMultiple: terminal }) }).intrinsicValuePerShare));
}

export function dcfToCsv(result: DcfResult, assumptions: DcfAssumptions) {
  const rows: Array<Array<string | number>> = [["year","revenue_growth","revenue","operating_margin","operating_income","tax_rate","nopat","depreciation","capex","change_working_capital","fcff","diluted_shares","fcff_per_share","discount_factor","present_value"]];
  for (const item of result.projections) rows.push([item.year,item.revenueGrowth,item.revenue,item.operatingMargin,item.operatingIncome,item.taxRate,item.nopat,item.depreciation,item.capex,item.changeInWorkingCapital,item.freeCashFlow,item.dilutedShares,item.freeCashFlowPerShare,item.discountFactor,item.presentValue].map(String));
  rows.push(["summary","wacc",assumptions.wacc,"terminal_growth",assumptions.terminalGrowth,"enterprise_value",result.enterpriseValue ?? "","equity_value",result.equityValue ?? "","intrinsic_value_per_share",result.intrinsicValuePerShare ?? ""]);
  return rows.map((row) => row.join(",")).join("\n");
}
