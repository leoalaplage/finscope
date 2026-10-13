import type { FinancialPeriod, MetricKey } from "./types";

export const FORMULAS = {
  grossProfit: "Revenue − Cost of revenue, where the filer publishes no subtotal",
  grossMargin: "Gross profit / Revenue",
  operatingMargin: "Operating income / Revenue",
  netMargin: "Net income / Revenue",
  operatingCashFlowMargin: "Operating cash flow / Revenue",
  freeCashFlow: "Operating cash flow − |Capital expenditures|",
  freeCashFlowAfterSbc: "Operating cash flow − |Capital expenditures| − Stock-based compensation",
  freeCashFlowAfterSbcPerShare: "Free cash flow after stock-based compensation / Diluted weighted average shares",
  freeCashFlowAfterSbcMargin: "Free cash flow after stock-based compensation / Revenue",
  investedCapital: "Total debt + Total equity − Cash and short-term investments",
  nopat: "Operating income × (1 − Effective tax rate)",
  roic: "NOPAT / Average invested capital (opening and closing)",
  cashReturnOnCapital: "Free cash flow / Invested capital",
  capitalIntensity: "|Capital expenditures| / Revenue",
  freeCashFlowMargin: "Free cash flow / Revenue",
  revenuePerShare: "Revenue / Diluted weighted average shares",
  grossProfitPerShare: "Gross profit / Diluted weighted average shares",
  operatingIncomePerShare: "Operating income / Diluted weighted average shares",
  netIncomePerShare: "Net income / Diluted weighted average shares",
  operatingCashFlowPerShare: "Operating cash flow / Diluted weighted average shares",
  freeCashFlowPerShare: "Free cash flow / Diluted weighted average shares",
  dilutionRate: "Current diluted shares / Previous diluted shares − 1",
  cagr: "(Ending value / Beginning value)^(1 / years) − 1",
  ttmFlow: "Sum of the latest four available quarters",
  priceToSales: "Market capitalization / Revenue",
  priceToEarnings: "Market capitalization / Net income",
  priceToOperatingCashFlow: "Market capitalization / Operating cash flow",
  priceToFreeCashFlow: "Market capitalization / Free cash flow",
  freeCashFlowYield: "Free cash flow / Market capitalization",
  buybackYield: "Gross share repurchases / Market capitalization",
  ebitda: "Operating income + Depreciation and amortization",
  ebitdaMargin: "EBITDA / Revenue",
  pretaxMargin: "Pre-tax income / Revenue",
  tangibleAssets: "Total assets − Goodwill − Acquired intangibles",
  capitalEmployed: "Total assets − Current liabilities",
  returnOnEquity: "Net income / Total equity",
  returnOnAssets: "Net income / Total assets",
  returnOnTangibleAssets: "Net income / Tangible assets",
  returnOnCapitalEmployed: "Operating income / Capital employed",
  debtToEquity: "Total debt / Total equity",
  interestCoverage: "Operating income / Interest expense",
  dividendPayout: "Dividends paid / Net income",
  dividendYield: "Dividends per share / Share price",
  enterpriseValue: "Market capitalization + Net debt",
  priceToBook: "Market capitalization / Total equity",
  enterpriseToSales: "Enterprise value / Revenue",
  enterpriseToEbitda: "Enterprise value / EBITDA",
  enterpriseToGrossProfit: "Enterprise value / Gross profit",
} as const;

/**
 * Division that refuses anything it cannot state as a number.
 *
 * A null, a zero denominator, and — since the capital-intensity ratio was found
 * publishing `NaN` for a filer that tags no capital expenditure — anything that
 * is not finite on either side or in the result. An infinity or a NaN reaching
 * a formatter becomes an em dash on the page, which reads exactly like a fact
 * the filer never reported. It is not: it is arithmetic we should not have run.
 */
export function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator == null || denominator == null || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

/**
 * A ratio whose denominator has to be positive before the ratio means anything.
 *
 * Return on equity and debt to equity are arithmetically defined over a
 * negative equity base and describe nothing there. Booking Financial has bought
 * back more stock than it has retained earnings, so its equity is minus four
 * billion, and the panel stated a return on equity of −96.9% and a debt-to-equity
 * of −3.36× as though they were facts about the business. A company financed
 * below zero is not one that earns a negative return on its owners' capital; it
 * is one the measure cannot describe.
 */
export function divideByPositive(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (denominator == null || denominator <= 0) return null;
  return safeDivide(numerator, denominator);
}

/**
 * Net debt, or nothing.
 *
 * Both balances are required. The previous form read `(debt ?? 0) − cash`,
 * which turned "this filer tags no debt concept we map" into "this company has
 * no debt" — and the difference between those two statements is the whole
 * point of the application. JPMorgan came out at minus 343bn of net debt, a
 * bank stated as though it were sitting on a third of a trillion in net cash,
 * while its own annual report carries at least 500bn of borrowings this
 * adapter does not yet read. An absent fact is unknown; only a filed zero is
 * zero.
 */
export function netDebt(period: FinancialPeriod): number | null {
  const debt = valueOf(period, "totalDebt"); const liquid = liquidAssets(period);
  if (debt == null || liquid == null) return null;
  return debt - liquid;
}

/**
 * Cash and the short-term investments held beside it: what net debt and an
 * enterprise value net against borrowings, by the convention every terminal
 * uses.
 *
 * Cash alone used to be netted, and a company holding its liquidity in
 * marketable securities was stated with net debt it does not have: Microsoft's
 * June 2026 balance sheet carries 20.9 billion of cash and 55.9 billion of
 * short-term investments against 40.3 billion of borrowings — net cash of 36.5
 * billion, which the page showed as 19.4 billion of net debt, and its
 * enterprise value 56 billion too high. The financial-health reading already
 * counted both; now every reading does. The cash balance is required; the
 * investments are added where filed (a filer with none tags none).
 */
/**
 * Net income to the common shareholder, where the filed line can be trusted,
 * or nothing — and every reader then falls back to net income.
 *
 * It is net income less preferred dividends, or plus a gain on redeeming them,
 * or a small share of it where most of the profit belongs to a minority
 * (Interactive Brokers keeps about a quarter). So no fixed band around net
 * income can judge it; the filer's own diluted earnings per share can. Where
 * one is filed, whichever of the two earnings lands nearer it, over the
 * diluted share count, is the one used: JPMorgan's 55.7 billion to common
 * gives its reported 20.02, General Motors' 7.0 billion its 6.37. Southwest
 * tagged its full 2021 year, 977 million, against the dates of its fourth
 * quarter, whose net income was 68 million, and the reported 0.12 rejects it.
 * Without a reported figure the line is used within a third of net income.
 */
export function earningsToCommon(period: FinancialPeriod): number | null {
  const toCommon = valueOf(period, "netIncomeToCommon");
  const net = valueOf(period, "netIncome");
  if (toCommon == null) return null;
  if (net == null) return toCommon;
  const reported = valueOf(period, "dilutedEpsReported");
  const shares = valueOf(period, "dilutedShares");
  if (reported != null && shares != null && shares > 0) {
    return Math.abs(toCommon / shares - reported) <= Math.abs(net / shares - reported) ? toCommon : null;
  }
  return Math.abs(net - toCommon) <= Math.max(Math.abs(net), 1) / 3 ? toCommon : null;
}

export function liquidAssets(period: FinancialPeriod): number | null {
  const cash = valueOf(period, "cashAndEquivalents");
  if (cash == null) return null;
  const investments = valueOf(period, "shortTermInvestments");
  return cash + (investments != null && investments > 0 ? investments : 0);
}

/** A borrowing balance, and which filing actually stated it. */
export interface DebtReading {
  value: number;
  label: string;
  periodEnd: string;
  /** True where it was read from an earlier filing than the period being valued. */
  carried: boolean;
}

/**
 * The most recent borrowing balance the filer actually stated.
 *
 * A trailing period ends on a quarterly balance sheet, and a quarterly balance
 * sheet is shorter than an annual one: an immaterial borrowing disappears into
 * a combined line there while the annual lease note states it to the dollar.
 * Copart is the case — $2.7m of finance leases at 31 July 2025, nothing tagged
 * at 30 April 2026 — and the consequence was that a company with $3.3bn of cash
 * and no borrowings to speak of had no enterprise value at all on its own page,
 * while the Quality Score on the same page ranked it on a net debt it had
 * worked out for itself.
 *
 * One rule now, in one place. The balance is read from the last annual filing
 * that states one, and it travels with the period it came from so every screen
 * showing it can say where it is from. That is the difference between this and
 * inventing a zero: a figure a filer published, dated, rather than an absence
 * read as nothing.
 *
 * Annual only, deliberately. A quarter that omits the line is usually one of
 * several that omit it, and the annual report is the filing that carries the
 * note the balance is stated in.
 */
export function reportedDebt(periods: FinancialPeriod[], current: FinancialPeriod | null): DebtReading | null {
  const own = current ? valueOf(current, "totalDebt") : null;
  if (current && own != null) return { value: own, label: current.label, periodEnd: current.periodEnd, carried: false };
  const earlier = periods
    .filter((period) => period.periodicity === "annual" && (!current || period.periodEnd <= current.periodEnd))
    .sort((left, right) => right.periodEnd.localeCompare(left.periodEnd))
    .find((period) => valueOf(period, "totalDebt") != null);
  const value = earlier ? valueOf(earlier, "totalDebt") : null;
  return earlier && value != null
    ? { value, label: earlier.label, periodEnd: earlier.periodEnd, carried: true }
    : null;
}

export function freeCashFlow(operatingCashFlow: number | null, capex: number | null) {
  if (operatingCashFlow == null || capex == null) return null;
  // Normalized data stores cash outflows as positive magnitudes. Math.abs keeps
  // this helper safe for raw provider fixtures without applying the sign twice.
  return operatingCashFlow - Math.abs(capex);
}

/**
 * A margin, unless revenue has all but vanished under it.
 *
 * Carnival's first quarter of 2021 carried 24 million of revenue against 470
 * million of cost of sales: a gross margin of −1,958% is arithmetic, not a
 * margin, and on a chart it flattens every real quarter into a line. Beyond
 * five times revenue either way the ratio says the denominator is a sliver,
 * and it is not stated — the convention every terminal marks as NM.
 */
export const MARGIN_LIMIT = 5;
export function margin(value: number | null, revenue: number | null) {
  const ratio = safeDivide(value, revenue);
  return ratio == null || Math.abs(ratio) > MARGIN_LIMIT ? null : ratio;
}

/**
 * A return whose base is a meaningful part of the business, or nothing.
 *
 * A return on equity divides by book equity, and a company that has bought
 * back nearly all of it has a base that rounds to nothing. S&P Global's equity
 * fell to 70 million against 8.5 billion of assets in March 2018, and its
 * return on equity read 2,445%; its invested capital, net of the cash it was
 * holding for the IHS Markit merger, fell to 120 million in 2021 and its ROIC
 * read 2,543%. Both are arithmetic on a sliver and neither is a return. Below
 * five per cent of total assets the base is not stated against, so the
 * return is not stated either (NM); where total assets are unknown the base
 * need only be positive, as before.
 */
export const MEANINGFUL_BASE = 0.05;
export function returnOn(numerator: number | null | undefined, base: number | null | undefined, totalAssets: number | null | undefined) {
  if (base == null || base <= 0) return null;
  if (totalAssets != null && totalAssets > 0 && base < totalAssets * MEANINGFUL_BASE) return null;
  return safeDivide(numerator, base);
}

export function perShare(value: number | null, dilutedShares: number | null) {
  return safeDivide(value, dilutedShares);
}

export function dilutionRate(current: number | null, previous: number | null) {
  const ratio = safeDivide(current, previous);
  return ratio == null ? null : ratio - 1;
}

export function annualizedDilution(current: number | null, previous: number | null, years: number) {
  if (current == null || previous == null || current <= 0 || previous <= 0 || years <= 0) return null;
  return Math.pow(current / previous, 1 / years) - 1;
}

export function cagr(start: number | null, end: number | null, years: number) {
  if (start == null || end == null || start <= 0 || end <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

export interface CagrResult {
  value: number | null;
  years: number;
  startDate: string;
  endDate: string;
  startValue: number | null;
  endValue: number | null;
  reason?: string;
}

export function cagrBetweenDates(startValue: number | null, endValue: number | null, startDate: string, endDate: string): CagrResult {
  const years = (Date.parse(endDate) - Date.parse(startDate)) / (365.2425 * 86_400_000);
  const base = { years, startDate, endDate, startValue, endValue };
  if (!Number.isFinite(years) || years <= 0) return { ...base, value: null, reason: "Invalid or overlapping dates" };
  if (startValue == null || endValue == null) return { ...base, value: null, reason: "Insufficient data" };
  if (startValue === 0) return { ...base, value: null, reason: "Starting value is zero" };
  if (Math.sign(startValue) !== Math.sign(endValue)) return { ...base, value: null, reason: "Endpoint signs differ" };
  if (startValue < 0 || endValue < 0) return { ...base, value: null, reason: "CAGR is not meaningful for negative endpoints" };
  return { ...base, value: Math.pow(endValue / startValue, 1 / years) - 1 };
}

export function cagrForPeriods(periods: FinancialPeriod[], metric: string, targetYears: number | "max") {
  const dependencyMap: Record<string, MetricKey[]> = { freeCashFlow: ["operatingCashFlow","capitalExpenditures"], revenuePerShare:["revenue","dilutedShares"], netIncomePerShare:["netIncome","dilutedShares"], freeCashFlowPerShare:["operatingCashFlow","capitalExpenditures","dilutedShares"], freeCashFlowAfterSbc:["operatingCashFlow","capitalExpenditures","stockBasedCompensation"], freeCashFlowAfterSbcPerShare:["operatingCashFlow","capitalExpenditures","stockBasedCompensation","dilutedShares"] };
  const valid = (period: FinancialPeriod) => {
    const keys = dependencyMap[metric] ?? [metric as MetricKey];
    return keys.every((key) => period.facts[key]?.validation?.status !== "Confirmed invalid");
  };
  const complete = periods.filter((period) => valid(period) && derivedValue(period, metric) != null).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const end = complete.at(-1);
  if (!end) return { value: null, years: 0, startDate: "", endDate: "", startValue: null, endValue: null, reason: "Insufficient data" } satisfies CagrResult;
  const yearsFromEnd = (period: FinancialPeriod) => (Date.parse(end.periodEnd) - Date.parse(period.periodEnd)) / (365.2425 * 86_400_000);
  const maximumStart = complete[0]; const maximumYears = yearsFromEnd(maximumStart);
  const start = targetYears === "max" ? maximumStart : complete
    .map((period) => ({ period, distance: Math.abs(yearsFromEnd(period) - targetYears), years: yearsFromEnd(period) }))
    .filter((candidate) => candidate.years > 0 && candidate.distance <= 0.5)
    .sort((left, right) => left.distance - right.distance)[0]?.period;
  if (!start || start === end) return { value: null, years: maximumYears, startDate: maximumStart.periodEnd, endDate: end.periodEnd, startValue: derivedValue(maximumStart, metric), endValue: derivedValue(end, metric), reason: `Requested ${targetYears}Y; maximum exact available history is ${maximumYears.toFixed(2)}Y. Maximum-available CAGR is reported separately.` } satisfies CagrResult;
  return cagrBetweenDates(derivedValue(start, metric), derivedValue(end, metric), start.periodEnd, end.periodEnd);
}

export function ttm(values: Array<number | null>) {
  const lastFour = values.slice(-4);
  if (lastFour.length !== 4 || lastFour.some((value) => value == null)) return null;
  return (lastFour as number[]).reduce((sum, value) => sum + value, 0);
}

export function splitAdjustedShares(shares: number | null, splitFactor: number) {
  if (shares == null || splitFactor <= 0) return null;
  return shares * splitFactor;
}

export function valueOf(period: FinancialPeriod, key: MetricKey) {
  return period.facts[key]?.value ?? null;
}

/**
 * The financing view of invested capital: what the providers of capital put in,
 * net of the cash the business is not using. Preferred over the operating view
 * because a full operating build-up would need fixed assets and intangibles
 * that several filers omit.
 *
 * All three balances are required. Treating an unmapped debt concept as zero
 * understates the capital base, and understating the denominator of a return
 * overstates the return — which is how a company with 90bn of borrowings once
 * showed a 247% return on invested capital. A missing balance is unknown, and
 * unknown capital earns an unknown return.
 */
export function investedCapital(period: FinancialPeriod): number | null {
  // Cash and short-term investments, as net debt nets them: Copart moving its
  // cash into treasury bills each quarter otherwise swung its invested capital
  // by billions, and its return on it between 21% and 33%, quarter to quarter.
  const debt = valueOf(period, "totalDebt"); const equity = valueOf(period, "totalEquity"); const liquid = liquidAssets(period);
  if (debt == null || equity == null || liquid == null) return null;
  const capital = debt + equity - liquid;
  return capital > 0 ? capital : null;
}

/**
 * Invested capital close to twelve months before `current`, from whichever
 * filing (quarter or year) put a balance sheet nearest that date, within a
 * quarter of it. Null when no such balance exists: the return then stays on
 * the period-end capital rather than an invented opening one.
 */
export function capitalAYearEarlier(
  periods: FinancialPeriod[],
  current: FinancialPeriod,
  capitalOf: (period: FinancialPeriod) => number | null = investedCapital,
): number | null {
  const years = (earlier: string, later: string) => (Date.parse(later) - Date.parse(earlier)) / (365.2425 * 86_400_000);
  let best: { capital: number; distance: number } | null = null;
  for (const period of periods) {
    if (period.periodEnd >= current.periodEnd) continue;
    const distance = Math.abs(years(period.periodEnd, current.periodEnd) - 1);
    if (distance > 0.25 || (best && best.distance <= distance)) continue;
    const capital = capitalOf(period);
    if (capital != null) best = { capital, distance };
  }
  return best?.capital ?? null;
}

/**
 * Return on invested capital, one definition for the screener and the company
 * page: NOPAT over the capital employed through the year — the average of the
 * opening and closing balances where an opening one exists, the closing one
 * otherwise. Capital is total debt + equity − cash and short-term investments.
 */
export function returnOnAverageCapital(
  nopatValue: number | null | undefined,
  ending: number | null,
  opening: number | null,
  totalAssets: number | null | undefined,
) {
  if (ending == null) return null;
  return returnOn(nopatValue, opening == null ? ending : (opening + ending) / 2, totalAssets);
}

/**
 * Operating profit after the tax the company actually paid on it — and whether
 * that rate is the company's or ours.
 *
 * When the reported rate is unusable the statutory 21% stands in, and that is
 * an assumption, not a filed figure. It travels with the value here so a caller
 * can say so on the page instead of presenting an assumed rate as a reading.
 */
export function nopatBasis(period: FinancialPeriod): { value: number | null; assumedTaxRate: boolean; rate: number | null } {
  const operating = valueOf(period, "operatingIncome");
  if (operating == null) return { value: null, assumedTaxRate: false, rate: null };
  const pretax = valueOf(period, "incomeBeforeTax"); const tax = valueOf(period, "incomeTaxExpense");
  const rate = pretax != null && tax != null && pretax > 0 ? tax / pretax : null;
  // A rate outside nought to sixty percent is a one-off, not a run rate.
  const reported = rate != null && rate >= 0 && rate <= .6 ? rate : null;
  const effective = reported ?? .21;
  return { value: operating * (1 - effective), assumedTaxRate: reported == null, rate: effective };
}

export function nopat(period: FinancialPeriod): number | null {
  return nopatBasis(period).value;
}

/**
 * Operating profit before the non-cash charges that depend on accounting
 * policy rather than trading. Built up from operating income rather than down
 * from net income, so it never picks up financing or one-off items.
 */
export function ebitda(period: FinancialPeriod): number | null {
  const operating = valueOf(period, "operatingIncome");
  const depreciation = valueOf(period, "depreciationAndAmortization");
  return operating == null || depreciation == null ? null : operating + Math.abs(depreciation);
}

/**
 * Assets the business actually operates, with goodwill and acquired intangibles
 * removed. Those are the price paid for past acquisitions; leaving them in
 * flatters an organic grower and penalises an acquisitive one for nothing it
 * does today.
 */
export function tangibleAssets(period: FinancialPeriod): number | null {
  const assets = valueOf(period, "totalAssets");
  if (assets == null) return null;
  const goodwill = valueOf(period, "goodwill"); const intangibles = valueOf(period, "intangibleAssets");
  // A filer that tags neither concept has not told us it owns no goodwill — it
  // has told us nothing. Returning total assets under a tangible label would
  // publish return on assets a second time wearing a different name, which is
  // exactly what Apple did after it stopped tagging goodwill in 2017.
  if (goodwill == null && intangibles == null) return null;
  const tangible = assets - (goodwill ?? 0) - (intangibles ?? 0);
  return tangible > 0 ? tangible : null;
}

/** Capital employed: everything financed for longer than a trading cycle. */
export function capitalEmployed(period: FinancialPeriod): number | null {
  const assets = valueOf(period, "totalAssets"); const current = valueOf(period, "currentLiabilities");
  if (assets == null || current == null) return null;
  const employed = assets - current;
  return employed > 0 ? employed : null;
}

export function derivedValue(period: FinancialPeriod, key: string): number | null {
  const revenue = valueOf(period, "revenue");
  const diluted = valueOf(period, "dilutedShares");
  const capex = valueOf(period, "capitalExpenditures");
  const cash = valueOf(period, "cashAndEquivalents");
  const currentAssets = valueOf(period, "currentAssets");
  const currentLiabilities = valueOf(period, "currentLiabilities");
  const compatibleCurrencyFacts = (keys: MetricKey[]) => keys.map((metric) => period.facts[metric]).every((fact) => fact?.unit === "currency" && fact.currency === period.currency && fact.periodEnd === period.periodEnd);
  const compatibleShares = period.facts.dilutedShares?.unit === "shares" && period.facts.dilutedShares.currency === period.currency && period.facts.dilutedShares.periodEnd === period.periodEnd;
  const fcf = compatibleCurrencyFacts(["operatingCashFlow","capitalExpenditures"]) ? freeCashFlow(valueOf(period, "operatingCashFlow"), valueOf(period, "capitalExpenditures")) : null;
  const compatiblePerShare = (total: number | null, dependencies: MetricKey[]) => compatibleShares && compatibleCurrencyFacts(dependencies) ? perShare(total,diluted) : null;
  // Treats stock-based compensation as the cost it is rather than adding it
  // back. Operating cash flow already contains depreciation and the working
  // capital movement, so subtracting compensation from it lands on the same
  // figure as building free cash flow up from net income — without depending on
  // an aggregate working-capital concept that two thirds of filers never tag.
  const sbc = valueOf(period, "stockBasedCompensation");
  const fcfAfterSbc = fcf == null || sbc == null || !compatibleCurrencyFacts(["stockBasedCompensation"]) ? null : fcf - Math.abs(sbc);
  /*
   * Gross profit as filed, or the subtraction it is when the filer publishes
   * both sides and no subtotal.
   *
   * Six of the twenty-one companies here tag a cost of revenue and no
   * `GrossProfit` — Alphabet, Meta, Airbnb, Paychex, Zoetis and FactSet — so
   * the overview drew an empty gross-profit card for two of the largest
   * companies in the world while every figure needed to fill it sat in the same
   * period. Nothing here is estimated: it is one reported number less another,
   * within a single period, and it is the same arithmetic the income-statement
   * diagram has been doing all along, which is why a company could show a gross
   * profit ribbon under Statements and nothing at all under Overview.
   *
   * Checked against a filer that publishes all three: NVIDIA's FY2026 revenue
   * of 215.9bn less its 62.5bn cost of revenue is 153.5bn, which is the
   * `GrossProfit` it files to the cent.
   *
   * The absolute value guards the handful of filers who tag the cost as a
   * negative, the way capital expenditures are treated a few lines above.
   */
  const reportedGross = valueOf(period, "grossProfit");
  const costOfRevenue = valueOf(period, "costOfRevenue");
  const grossProfit = reportedGross ?? (
    revenue != null && costOfRevenue != null && compatibleCurrencyFacts(["revenue", "costOfRevenue"])
      ? revenue - Math.abs(costOfRevenue)
      : null
  );
  const map: Record<string, number | null> = {
    freeCashFlow: fcf,
    freeCashFlowAfterSbc: fcfAfterSbc,
    freeCashFlowAfterSbcMargin: margin(fcfAfterSbc, revenue),
    freeCashFlowAfterSbcPerShare: compatiblePerShare(fcfAfterSbc,["operatingCashFlow","capitalExpenditures","stockBasedCompensation"]),
    grossProfit,
    grossMargin: margin(grossProfit, revenue),
    operatingMargin: margin(valueOf(period, "operatingIncome"), revenue),
    netMargin: margin(valueOf(period, "netIncome"), revenue),
    operatingCashFlowMargin: margin(valueOf(period, "operatingCashFlow"), revenue),
    freeCashFlowMargin: margin(fcf, revenue),
    revenuePerShare: compatiblePerShare(revenue,["revenue"]),
    // The dependency check names whichever facts the figure actually came
    // from, or a derived gross profit would fail a test for a fact that does
    // not exist and quietly disappear again.
    grossProfitPerShare: compatiblePerShare(grossProfit, reportedGross != null ? ["grossProfit"] : ["revenue", "costOfRevenue"]),
    operatingIncomePerShare: compatiblePerShare(valueOf(period, "operatingIncome"),["operatingIncome"]),
    /*
     * Earnings per share on what belongs to the common shareholder: net income
     * less preferred dividends, where the filer states it. JPMorgan's 2025 net
     * income of 57.0 billion carries 1.4 billion for its preferred holders, and
     * dividing all of it by the common shares gave 20.51 a share against the
     * 20.02 it reports.
     */
    netIncomePerShare: earningsToCommon(period) != null
      ? compatiblePerShare(earningsToCommon(period), ["netIncomeToCommon"])
      : compatiblePerShare(valueOf(period, "netIncome"), ["netIncome"]),
    // Read through the same guard by every consumer: the P/E, the earnings yield, the history.
    netIncomeToCommon: earningsToCommon(period),
    operatingCashFlowPerShare: compatiblePerShare(valueOf(period, "operatingCashFlow"),["operatingCashFlow"]),
    freeCashFlowPerShare: compatiblePerShare(fcf,["operatingCashFlow","capitalExpenditures"]),
    stockBasedCompensationToRevenue: safeDivide(valueOf(period, "stockBasedCompensation"), revenue),
    stockBasedCompensationToFcf: safeDivide(valueOf(period, "stockBasedCompensation"), fcf),
    cashConversion: safeDivide(fcf, valueOf(period, "netIncome")),
    effectiveTaxRate: safeDivide(valueOf(period, "incomeTaxExpense"), valueOf(period, "incomeBeforeTax")),
    investedCapital: investedCapital(period),
    nopat: nopat(period),
    // ROIC has been declared in the metric registry all along without ever
    // being computed, so it rendered as an em dash everywhere it appeared.
    roic: returnOn(nopat(period), investedCapital(period), valueOf(period, "totalAssets")),
    // The same question as ROIC, asked of cash instead of accounting profit.
    // NOPAT applies an effective tax rate, and falls back to an assumed 21%
    // when the reported one is not usable, so ROIC always carries one
    // assumption. Free cash flow carries none: it is what the business
    // actually produced after paying for its own maintenance.
    cashReturnOnCapital: returnOn(fcf, investedCapital(period), valueOf(period, "totalAssets")),
    capitalIntensity: capex == null ? null : safeDivide(Math.abs(capex), revenue),
    netDebt: netDebt(period),
    liquidAssets: liquidAssets(period),
    currentRatio: divideByPositive(currentAssets, currentLiabilities),
    // Leverage against earnings; not meaningful on negative EBITDA, so not stated there.
    netDebtToEbitda: (() => { const value = ebitda(period); return value == null || value <= 0 ? null : safeDivide(netDebt(period), value); })(),
    // Working capital excluding cash needs the cash balance as much as it needs
    // the two current totals; without it the figure is a different measure
    // wearing this one's label.
    netWorkingCapital: currentAssets == null || currentLiabilities == null || cash == null ? null : currentAssets - currentLiabilities - cash,
    ebitda: ebitda(period),
    ebitdaMargin: margin(ebitda(period), revenue),
    pretaxMargin: margin(valueOf(period, "incomeBeforeTax"), revenue),
    tangibleAssets: tangibleAssets(period),
    capitalEmployed: capitalEmployed(period),
    // Returns are stated on the period-end base rather than an average of
    // opening and closing balances. The average is marginally more correct for
    // a year of heavy issuance, but it needs a prior balance sheet, and mixing
    // the two conventions across companies would be worse than either.
    returnOnEquity: returnOn(valueOf(period, "netIncome"), valueOf(period, "totalEquity"), valueOf(period, "totalAssets")),
    // No business earns its whole balance sheet in a year: a return on assets
    // beyond that is a total-assets figure tagged at the wrong scale.
    returnOnAssets: (() => { const value = safeDivide(valueOf(period, "netIncome"), valueOf(period, "totalAssets")); return value == null || Math.abs(value) > 1 ? null : value; })(),
    returnOnTangibleAssets: safeDivide(valueOf(period, "netIncome"), tangibleAssets(period)),
    returnOnCapitalEmployed: safeDivide(valueOf(period, "operatingIncome"), capitalEmployed(period)),
    debtToEquity: divideByPositive(valueOf(period, "totalDebt"), valueOf(period, "totalEquity")),
    // A company with no interest expense is not infinitely covered, it is
    // simply unlevered. Dividing by zero would print ∞, so it stays unavailable.
    interestCoverage: safeDivide(valueOf(period, "operatingIncome"), valueOf(period, "interestExpense")),
    // A share of a loss is not a payout ratio: a company distributing cash in a
    // year it lost money has a payout its earnings cannot describe.
    dividendPayout: divideByPositive(valueOf(period, "dividendsPaid"), valueOf(period, "netIncome")),
  };
  // A key the map defines answers for itself, null included: a value it has
  // judged unusable must not fall back to the raw fact it rejected.
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : valueOf(period, key as MetricKey);
}

