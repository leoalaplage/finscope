import { calculateDcf, type DcfAssumptions, type DcfBase, type DcfResult } from "@/lib/dcf";
import { terminalGrowthFor } from "@/lib/implied-erp";
import type { IoCompanyView, IoPeriod } from "./view";

/**
 * The DCF as a reader drives it: a handful of levers in plain words instead of
 * ten columns of percentages, turned into the year-by-year assumptions the
 * engine (lib/dcf.ts) already knows how to value.
 *
 * - Revenue grows at one rate in year one and another in year five, in a
 *   straight line between, then fades to the terminal rate by the last year:
 *   the two-stage shape every business that has ever grown has had.
 * - The operating margin moves from today's to a target by year five and
 *   holds there.
 * - Capital spending and depreciation start where they are today and move to
 *   a year-five level in a straight line, so year one's free cash flow looks
 *   like this year's rather than like a five-year average (a company in the
 *   middle of a building programme is not valued as if it had finished it).
 * - From year five the reinvestment fades to what the terminal growth needs:
 *   growth ÷ return on capital, of NOPAT (Damodaran's identity). A company
 *   mid-way through a building programme does not keep building at that pace
 *   for ever, and a perpetuity with no reinvestment cannot grow.
 * - Tax and working capital are shares of revenue; dilution is a yearly
 *   change in the share count.
 * - The discount rate is the weighted cost of capital: this company's cost of
 *   equity (its measured beta on the ten-year Treasury) and its own cost of
 *   debt after tax, at today's market weights.
 *
 * The base year is the trailing twelve months where the filer has them, so
 * year one is the next twelve months rather than a fiscal year already half
 * gone. Every default is the company's own record, bounded where a one-off
 * year would otherwise become a perpetual forecast.
 *
 * A lender's cash flow is its balance sheet moving, so it gets the model that
 * fits a lender instead: the justified price-to-book, (ROE − g) / (r − g).
 *
 * Pure.
 */

export const YEARS = 10;
const STAGE_ONE = 5;

export interface Drivers {
  growthStart: number;
  growthEnd: number;
  marginTarget: number;
  taxRate: number;
  capex: number;
  depreciation: number;
  workingCapital: number;
  dilution: number;
  wacc: number;
  terminalMethod: "perpetual-growth" | "exit-multiple";
  terminalGrowth: number;
  /** Enterprise value over the last year's free cash flow. */
  exitMultiple: number;
}

export interface DcfFoundation {
  base: DcfBase;
  /** The period the base was read from. */
  basePeriod: { label: string; end: string };
  /** Today's operating margin, where the margin path starts. */
  startMargin: number;
  /** Where operating income is not filed, how the margin was struck instead; null where it is. */
  marginNote: string | null;
  /** Today's levels, where the reinvestment paths start, and today's growth. */
  now: { growth: number | null; capex: number | null; depreciation: number | null };
  /** The company's record, for the hints beside each lever. */
  record: {
    growth3: number | null; growth5: number | null; growth10: number | null;
    margin5: number | null; marginHigh: number | null;
    tax5: number | null; capex5: number | null; depreciation5: number | null; workingCapital5: number | null; dilution5: number | null;
    /** Capital spending over revenue, the median of up to ten years: what the business needs when it is not in a building programme. */
    capex10: number | null;
    costOfDebt: number | null;
    /** Return on invested capital, five-year average: what new capital earns once the business is mature. */
    roic5: number | null;
    /** Revenue and free cash flow by fiscal year, for the chart. */
    years: Array<{ label: string; end: string; revenue: number | null; freeCashFlow: number | null }>;
  };
}

const known = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const at = (period: IoPeriod | undefined, key: string) => (known(period?.values[key]) ? period!.values[key]! : null);
const median = (values: Array<number | null>) => {
  const usable = values.filter(known).sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
};
const mean = (values: Array<number | null>) => {
  const usable = values.filter(known);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
};

/**
 * Operating income as filed, or where a filer presents no operating subtotal
 * (Nike, GE, Lennar, Newmont: 24 of 307 non-financial S&P 500 members in
 * October 2026) the same thing struck the classic way, pre-tax income plus
 * interest expense. Without it the margin read as nought and the model valued
 * Eli Lilly below zero.
 */
function operatingOf(period: IoPeriod | undefined): { value: number; derived: boolean } | null {
  const filed = at(period, "operatingIncome");
  if (known(filed)) return { value: filed, derived: false };
  const pretax = at(period, "incomeBeforeTax");
  if (!known(pretax)) return null;
  return { value: pretax + Math.abs(at(period, "interestExpense") ?? 0), derived: true };
}

/** The company's figures the model starts from, or null where a DCF cannot be built (no revenue, no share count, no operating figure). */
export function dcfFoundation(view: IoCompanyView): DcfFoundation | null {
  const annual = view.annual;
  const latest = view.trailing.at(-1) && at(view.trailing.at(-1), "revenue") != null ? view.trailing.at(-1)! : annual.at(-1);
  if (!latest) return null;
  const revenue = at(latest, "revenue");
  const operating = operatingOf(latest) ?? operatingOf(annual.at(-1));
  const shares = at(latest, "dilutedShares") ?? at(annual.at(-1), "dilutedShares");
  if (!known(revenue) || revenue <= 0 || !known(shares) || shares <= 0) return null;
  const cash = (at(latest, "cashAndEquivalents") ?? at(annual.at(-1), "cashAndEquivalents") ?? 0)
    + Math.max(0, at(latest, "shortTermInvestments") ?? at(annual.at(-1), "shortTermInvestments") ?? 0);
  const debt = at(latest, "totalDebt") ?? at(annual.at(-1), "totalDebt") ?? 0;
  const operatingRevenue = operatingOf(latest) ? revenue : at(annual.at(-1), "revenue");
  if (!operating || !known(operatingRevenue) || operatingRevenue <= 0) return null;
  const startMargin = operating.value / operatingRevenue;

  const growth = annual.map((period, index) => {
    const now = at(period, "revenue"), before = at(annual[index - 1], "revenue");
    return known(now) && known(before) && before > 0 ? now / before - 1 : null;
  });
  const cagr = (years: number) => {
    const end = annual.at(-1), start = annual.at(-1 - years);
    const a = at(start, "revenue"), b = at(end, "revenue");
    return known(a) && known(b) && a > 0 && b > 0 ? (b / a) ** (1 / years) - 1 : null;
  };
  const share = (key: string, absolute = true, years = 5) => annual.slice(-years).map((period) => {
    const value = at(period, key), base = at(period, "revenue");
    return known(value) && known(base) && base > 0 ? (absolute ? Math.abs(value) : value) / base : null;
  });
  const margins = annual.slice(-10).map((period) => {
    const income = operatingOf(period), base = at(period, "revenue");
    return income && known(base) && base > 0 ? income.value / base : null;
  });
  const workingCapital = annual.slice(-5).map((period, index, list) => {
    const now = at(period, "netWorkingCapital"), before = at(list[index - 1], "netWorkingCapital"), base = at(period, "revenue");
    return known(now) && known(before) && known(base) && base > 0 ? (now - before) / base : null;
  });
  const dilution = annual.slice(-5).map((period, index, list) => {
    const now = at(period, "dilutedShares"), before = at(list[index - 1], "dilutedShares");
    return known(now) && known(before) && before > 0 ? now / before - 1 : null;
  });
  const interest = at(latest, "interestExpense");
  // Today: the trailing year against the trailing year before it, where the filer has both.
  const yearAgo = view.trailing.find((period) => Math.abs(Date.parse(period.end) - (Date.parse(latest.end) - 365 * 86_400_000)) <= 20 * 86_400_000)
    ?? annual.find((period) => Math.abs(Date.parse(period.end) - (Date.parse(latest.end) - 365 * 86_400_000)) <= 20 * 86_400_000);
  const revenueAgo = at(yearAgo, "revenue");
  const ofRevenue = (key: string) => { const amount = at(latest, key); return known(amount) ? Math.abs(amount) / revenue : null; };
  return {
    base: { revenue, operatingMargin: startMargin, freeCashFlow: at(latest, "freeCashFlow") ?? 0, dilutedShares: shares, cash, debt },
    basePeriod: { label: latest.label, end: latest.end },
    startMargin,
    marginNote: operating.derived ? "Operating income is not filed: pre-tax income plus interest expense stands in." : null,
    now: { growth: known(revenueAgo) && revenueAgo > 0 ? revenue / revenueAgo - 1 : null, capex: ofRevenue("capitalExpenditures"), depreciation: ofRevenue("depreciationAndAmortization") },
    record: {
      growth3: cagr(3), growth5: cagr(5), growth10: cagr(10) ?? mean(growth.slice(-10)),
      margin5: mean(margins.slice(-5)), marginHigh: margins.filter(known).length ? Math.max(...margins.filter(known)) : null,
      tax5: mean(annual.slice(-5).map((period) => at(period, "effectiveTaxRate"))),
      capex5: mean(share("capitalExpenditures")), depreciation5: mean(share("depreciationAndAmortization")),
      capex10: median(share("capitalExpenditures", true, 10)),
      workingCapital5: median(workingCapital), dilution5: mean(dilution),
      costOfDebt: known(interest) && debt > 0 ? Math.abs(interest) / debt : null,
      roic5: mean(annual.slice(-5).map((period) => at(period, "roic"))),
      years: annual.slice(-6).map((period) => ({ label: period.label, end: period.end, revenue: at(period, "revenue"), freeCashFlow: at(period, "freeCashFlow") })),
    },
  };
}

/** The weighted cost of capital at market weights; the cost of equity alone where the company carries no debt. */
export function weightedCost(costOfEquity: number, costOfDebt: number | null, taxRate: number, marketCap: number | null, debt: number): number {
  if (!known(marketCap) || marketCap <= 0 || debt <= 0) return costOfEquity;
  const kd = clamp(costOfDebt ?? 0.05, 0.02, 0.12) * (1 - clamp(taxRate, 0, 0.4));
  const equity = marketCap / (marketCap + debt);
  return equity * costOfEquity + (1 - equity) * kd;
}

const midway = (now: number | null, record: number | null) => (now != null && record != null ? (now + record) / 2 : now ?? record);

/**
 * Year five's capital spending: back to the business's long-run norm (the
 * ten-year median) where today's is above it — a building programme is valued
 * as one, not as the company's permanent state: Amazon and Alphabet were
 * valued at a quarter of their price, their 2026 spending held for five years
 * without the growth it pays for — and halfway back to the five-year record
 * where today's is below.
 */
function capexTarget(foundation: DcfFoundation): number | null {
  const { capex } = foundation.now;
  const { capex5, capex10 } = foundation.record;
  if (capex != null && capex10 != null && capex > capex10) return capex10;
  return midway(capex, capex5);
}

/**
 * The company's own record, bounded, as the base case. Growth for ever follows
 * the Treasury (lib/implied-erp.ts), where the page has its rate.
 */
export function defaultDrivers(foundation: DcfFoundation, costOfEquity: number | null, marketCap: number | null, riskFree: number | null = null): Drivers {
  const r = foundation.record;
  // Today's growth weighs most in year one; the three-year record tempers a single year.
  const record3 = r.growth3 ?? r.growth5 ?? 0.05;
  const recent = foundation.now.growth != null ? 0.6 * foundation.now.growth + 0.4 * record3 : record3;
  const longer = r.growth5 ?? r.growth10 ?? record3;
  const growthStart = clamp(recent, -0.1, 0.35);
  const growthEnd = clamp(Math.min(growthStart, (longer + 0.03) / 2 + 0.02), -0.05, 0.2);
  const taxRate = clamp(r.tax5 ?? 0.21, 0.1, 0.3);
  const coe = costOfEquity ?? 0.09;
  return {
    growthStart, growthEnd,
    // Today's margin held: the case a reader moves from, up or down.
    marginTarget: clamp(foundation.startMargin, -0.2, 0.6),
    taxRate,
    // Year five's reinvestment: halfway from today's level back to the five-year record.
    capex: clamp(capexTarget(foundation) ?? 0.04, 0, 0.4),
    depreciation: clamp(midway(foundation.now.depreciation, r.depreciation5) ?? 0.035, 0, 0.3),
    // The median year, bounded: one year's swing in receivables is not a perpetual drain.
    workingCapital: clamp(r.workingCapital5 ?? 0.01, -0.02, 0.02),
    dilution: clamp(r.dilution5 ?? 0, 0, 0.05),
    wacc: clamp(weightedCost(coe, r.costOfDebt, taxRate, marketCap, foundation.base.debt), 0.05, 0.16),
    terminalMethod: "perpetual-growth",
    terminalGrowth: terminalGrowthFor(riskFree),
    exitMultiple: 18,
  };
}

export type Scenario = "bear" | "base" | "bull";

/**
 * The cases either side of the base: growth three points apart, the rate one
 * point, and the margin by a fifth of itself (at most three points) — three
 * points on Costco's 4% margin would nearly double or erase it.
 */
export function scenarioDrivers(base: Drivers, scenario: Scenario): Drivers {
  if (scenario === "base") return base;
  const sign = scenario === "bull" ? 1 : -1;
  const marginStep = Math.min(0.03, Math.max(0.005, Math.abs(base.marginTarget) * 0.2));
  return {
    ...base,
    growthStart: base.growthStart + sign * 0.03,
    growthEnd: base.growthEnd + sign * 0.02,
    marginTarget: base.marginTarget + sign * marginStep,
    wacc: base.wacc - sign * 0.01,
    terminalGrowth: base.terminalGrowth + sign * 0.005,
    exitMultiple: base.exitMultiple * (1 + sign * 0.2),
  };
}

/** The levers as the engine's year-by-year assumptions. */
export function assumptionsFrom(drivers: Drivers, foundation: DcfFoundation): DcfAssumptions {
  const growth = Array.from({ length: YEARS }, (_, index) => {
    if (index < STAGE_ONE) return drivers.growthStart + ((drivers.growthEnd - drivers.growthStart) * index) / (STAGE_ONE - 1);
    const fade = (index - STAGE_ONE + 1) / (YEARS - STAGE_ONE);
    const landing = drivers.terminalMethod === "perpetual-growth" ? drivers.terminalGrowth : Math.min(drivers.growthEnd, 0.04);
    return drivers.growthEnd + (landing - drivers.growthEnd) * fade;
  });
  const margin = Array.from({ length: YEARS }, (_, index) =>
    index < STAGE_ONE ? foundation.startMargin + ((drivers.marginTarget - foundation.startMargin) * (index + 1)) / STAGE_ONE : drivers.marginTarget);
  const repeat = (value: number) => Array.from({ length: YEARS }, () => value);
  // Today's level to the year-five one in a straight line, then held.
  const path = (now: number | null, target: number) => Array.from({ length: YEARS }, (_, index) =>
    now == null || index >= STAGE_ONE - 1 ? target : now + ((target - now) * index) / (STAGE_ONE - 1));
  /*
   * Capital spending from year five on fades to the steady state: depreciation
   * plus the net reinvestment the terminal growth needs at the company's
   * return on capital (bounded between the cost of capital and 30%), less what
   * working capital already takes.
   */
  const terminalGrowth = drivers.terminalMethod === "perpetual-growth" ? drivers.terminalGrowth : Math.min(drivers.growthEnd, 0.04);
  const roic = clamp(foundation.record.roic5 ?? 0.15, Math.max(drivers.wacc, 0.08), 0.3);
  const steadyCapex = Math.max(0, drivers.depreciation + (terminalGrowth / roic) * drivers.marginTarget * (1 - drivers.taxRate) - drivers.workingCapital);
  const capex = path(foundation.now.capex, drivers.capex).map((value, index) => {
    if (index < STAGE_ONE) return value;
    const fade = (index - STAGE_ONE + 1) / (YEARS - STAGE_ONE);
    return drivers.capex + (steadyCapex - drivers.capex) * fade;
  });
  return {
    method: "fcff", terminalMethod: drivers.terminalMethod, forecastYears: YEARS,
    revenueGrowth: growth, operatingMargin: margin, taxRate: repeat(drivers.taxRate),
    depreciationPercentRevenue: path(foundation.now.depreciation, drivers.depreciation), capexPercentRevenue: capex,
    workingCapitalPercentRevenue: repeat(drivers.workingCapital), directFcfMargin: repeat(0),
    shareChange: repeat(drivers.dilution), wacc: drivers.wacc,
    terminalGrowth: drivers.terminalGrowth, exitMultiple: drivers.exitMultiple, otherClaims: 0,
  };
}

export function valueWith(foundation: DcfFoundation, drivers: Drivers): DcfResult {
  return calculateDcf(foundation.base, assumptionsFrom(drivers, foundation));
}

/**
 * The growth the price asks for: the year-one-to-five rate (held flat across
 * the first stage) at which the model's value per share equals the price,
 * everything else as set. Null where no rate between −30% and +80% gets there.
 */
export function impliedGrowth(foundation: DcfFoundation, drivers: Drivers, price: number): number | null {
  if (!(price > 0)) return null;
  const valueAt = (growth: number) => valueWith(foundation, { ...drivers, growthStart: growth, growthEnd: growth }).intrinsicValuePerShare;
  let low = -0.3, high = 0.8;
  const lowValue = valueAt(low), highValue = valueAt(high);
  if (lowValue == null || highValue == null || lowValue > price || highValue < price) return null;
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2;
    const value = valueAt(middle);
    if (value == null) return null;
    if (value < price) low = middle; else high = middle;
  }
  return (low + high) / 2;
}

/** Value per share over a grid of two levers. */
export function sensitivityGrid(foundation: DcfFoundation, drivers: Drivers, rows: { key: keyof Drivers; values: number[] }, columns: { key: keyof Drivers; values: number[] }): Array<Array<number | null>> {
  return rows.values.map((row) => columns.values.map((column) => {
    const set = { ...drivers, [rows.key]: row, [columns.key]: column } as Drivers;
    // Both growth levers move together when the grid is on growth.
    if (rows.key === "growthStart") set.growthEnd = drivers.growthEnd + (row - drivers.growthStart);
    if (columns.key === "growthStart") set.growthEnd = drivers.growthEnd + (column - drivers.growthStart);
    return valueWith(foundation, set).intrinsicValuePerShare;
  }));
}

/* ---- Lenders ------------------------------------------------------------ */

export interface JustifiedBook {
  bookPerShare: number;
  roe: number;
  costOfEquity: number;
  growth: number;
  /** (ROE − g) / (r − g). */
  multiple: number;
  value: number;
}

/**
 * A lender's value as a multiple of its book: a bank earning its cost of equity
 * is worth its book, one earning more is worth more, in proportion to the
 * spread it keeps earning as it grows.
 */
export function justifiedBook(view: IoCompanyView, costOfEquity: number, growth = 0.03): JustifiedBook | null {
  const latest = view.annual.at(-1);
  const equity = at(latest, "totalEquity");
  const shares = at(latest, "dilutedShares");
  const roe = mean(view.annual.slice(-5).map((period) => at(period, "returnOnEquity")));
  if (!known(equity) || equity <= 0 || !known(shares) || shares <= 0 || !known(roe) || costOfEquity <= growth) return null;
  const multiple = Math.max(0, (roe - growth) / (costOfEquity - growth));
  const bookPerShare = equity / shares;
  return { bookPerShare, roe, costOfEquity, growth, multiple, value: multiple * bookPerShare };
}
