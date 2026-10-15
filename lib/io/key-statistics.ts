import { cagrOf } from "@/components/io/format";
import { forwardReading, type Estimates } from "../estimates";
import { multipleOf } from "../market-basis";
import type { IoCompanyView, IoPeriod } from "./view";

/**
 * DES: the company in eight short blocks — profile, margins, returns over five
 * years, valuation on the last twelve months and on the next, balance sheet,
 * growth rates and dividends — every figure struck from the filings and the
 * live price this site already reads, and the consensus where it exists.
 *
 * A figure that cannot be struck honestly is null, never estimated: a
 * multiple over a loss, a growth rate across a change of sign, an average of
 * fewer than three years, a forward multiple for a share whose estimates are
 * in another currency. The screen leaves those rows out.
 */

export type StatKind = "money" | "count" | "percent" | "multiple" | "price";
export interface StatRow { label: string; value: number | null; kind: StatKind; title?: string }
export interface StatBlock { title: string; rows: StatRow[] }

/** Within two years: past that a figure carried forward is history, not the company's (components/io/Stats.tsx). */
const CARRY_DAYS = 2 * 366;

function latest(view: IoCompanyView, key: string): { value: number | null; period: IoPeriod | null } {
  const series = [...view.annual, ...view.trailing].sort((left, right) => left.end.localeCompare(right.end));
  const newest = series.at(-1)?.end;
  for (let index = series.length - 1; index >= 0; index--) {
    if (newest && (Date.parse(newest) - Date.parse(series[index].end)) / 86_400_000 > CARRY_DAYS) break;
    const value = series[index].values[key];
    if (value != null && Number.isFinite(value)) return { value, period: series[index] };
  }
  return { value: null, period: null };
}

/** Fiscal years, oldest first, one slot a year so a gap counts as the year it is. */
function yearly(view: IoCompanyView, key: string): Array<number | null> {
  const byYear = new Map(view.annual.map((period) => [period.fiscalYear, period.values[key] ?? null]));
  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (!years.length) return [];
  const out: Array<number | null> = [];
  for (let year = years[0]; year <= years.at(-1)!; year++) out.push(byYear.get(year) ?? null);
  return out;
}

/** The compound rate over exactly `years`, from the last filed year back: none if that year is missing. */
function cagr(view: IoCompanyView, key: string, years: number): number | null {
  const values = yearly(view, key);
  if (values.length <= years || values.at(-1) == null || values[values.length - 1 - years] == null) return null;
  return cagrOf(values.slice(-(years + 1)), years);
}

/** The average of the last five filed years, from three of them at least. */
function fiveYearAverage(view: IoCompanyView, key: string): number | null {
  const values = yearly(view, key).slice(-5).filter((value): value is number => value != null && Number.isFinite(value));
  return values.length >= 3 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function keyStatistics(input: {
  view: IoCompanyView;
  price: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  shares: number | null;
  /** The consensus, where its per-share figures are in the statements' currency and for the same share. */
  estimates: Estimates | null;
}): StatBlock[] {
  const { view, price, marketCap, enterpriseValue } = input;
  const value = (key: string) => latest(view, key).value;
  const toCommon = value("netIncomeToCommon");
  const earnings = toCommon ?? value("netIncome");
  const revenue = value("revenue");
  const equity = value("totalEquity");
  const dividends = value("dividendsPaid");

  const forward = input.estimates && price != null ? forwardReading(input.estimates, price) : null;
  const years = input.estimates?.yearly ?? [];
  // From this fiscal year's consensus to the one two years on.
  const [thisYear, , twoOn] = years.map((year) => year.consensus);
  const epsForward = thisYear != null && twoOn != null && thisYear > 0 && twoOn > 0 ? (twoOn / thisYear) ** 0.5 - 1 : null;

  const blocks: StatBlock[] = [
    { title: "Profile", rows: [
      { label: "Market cap", value: marketCap, kind: "money" },
      { label: "EV", value: enterpriseValue, kind: "money" },
      { label: "Shares out", value: input.shares, kind: "count" },
      { label: "Revenue", value: revenue, kind: "money" },
      { label: "Net income", value: earnings, kind: "money" },
      { label: "FCF", value: value("freeCashFlow"), kind: "money" },
    ] },
    { title: "Margins", rows: [
      { label: "Gross", value: value("grossMargin"), kind: "percent" },
      { label: "EBITDA", value: value("ebitdaMargin"), kind: "percent" },
      { label: "Operating", value: value("operatingMargin"), kind: "percent" },
      { label: "Pre-tax", value: value("pretaxMargin"), kind: "percent" },
      { label: "Net", value: value("netMargin"), kind: "percent" },
      { label: "FCF", value: value("freeCashFlowMargin"), kind: "percent" },
    ] },
    { title: "Returns · 5Y avg", rows: [
      { label: "ROA", value: fiveYearAverage(view, "returnOnAssets"), kind: "percent" },
      { label: "ROTA", value: fiveYearAverage(view, "returnOnTangibleAssets"), kind: "percent" },
      { label: "ROE", value: fiveYearAverage(view, "returnOnEquity"), kind: "percent" },
      { label: "ROCE", value: fiveYearAverage(view, "returnOnCapitalEmployed"), kind: "percent" },
      { label: "ROIC", value: fiveYearAverage(view, "roic"), kind: "percent" },
    ] },
    { title: "Valuation · TTM", rows: [
      { label: "P/E", value: multipleOf(marketCap, earnings), kind: "multiple" },
      { label: "P/B", value: multipleOf(marketCap, equity), kind: "multiple" },
      { label: "P/S", value: multipleOf(marketCap, revenue), kind: "multiple" },
      { label: "EV/Sales", value: multipleOf(enterpriseValue, revenue), kind: "multiple" },
      { label: "EV/EBITDA", value: multipleOf(enterpriseValue, value("ebitda")), kind: "multiple" },
      { label: "EV/Gross profit", value: multipleOf(enterpriseValue, value("grossProfit")), kind: "multiple" },
      { label: "P/FCF", value: multipleOf(marketCap, value("freeCashFlow")), kind: "multiple" },
      { label: "FCF yield", value: multipleOf(value("freeCashFlow"), marketCap), kind: "percent" },
    ] },
    { title: "Valuation · NTM", rows: [
      { label: "Price target", value: input.estimates?.target?.mean ?? null, kind: "price", title: "The analysts' mean target" },
      { label: "Upside", value: forward?.upside ?? null, kind: "percent" },
      { label: "P/E", value: forward?.forwardPe ?? null, kind: "multiple", title: "Price over the next four quarters' consensus EPS" },
      { label: "PEG", value: forward?.peg ?? null, kind: "multiple", title: "Forward P/E over the EPS growth expected from this fiscal year to the next" },
    ] },
    { title: "Financial health", rows: [
      { label: "Cash", value: value("liquidAssets") ?? value("cashAndEquivalents"), kind: "money", title: "Cash and short-term investments" },
      { label: "Net debt", value: view.basis?.netDebt ?? null, kind: "money" },
      { label: "Debt/Equity", value: equity != null && equity > 0 ? value("debtToEquity") : null, kind: "multiple" },
      { label: "Net debt/EBITDA", value: value("netDebtToEbitda"), kind: "multiple" },
      { label: "EBIT/Interest", value: value("interestCoverage"), kind: "multiple" },
      { label: "Current ratio", value: value("currentRatio"), kind: "multiple" },
    ] },
    { title: "Growth · CAGR", rows: [
      { label: "Revenue 3Y", value: cagr(view, "revenue", 3), kind: "percent" },
      { label: "Revenue 5Y", value: cagr(view, "revenue", 5), kind: "percent" },
      { label: "Revenue 10Y", value: cagr(view, "revenue", 10), kind: "percent" },
      { label: "Dil. EPS 3Y", value: cagr(view, "netIncomePerShare", 3), kind: "percent" },
      { label: "Dil. EPS 5Y", value: cagr(view, "netIncomePerShare", 5), kind: "percent" },
      { label: "Dil. EPS 10Y", value: cagr(view, "netIncomePerShare", 10), kind: "percent" },
      { label: "FCF 5Y", value: cagr(view, "freeCashFlow", 5), kind: "percent" },
      { label: "Shares 5Y", value: cagr(view, "dilutedShares", 5), kind: "percent" },
      { label: "EPS fwd 2Y", value: epsForward, kind: "percent", title: years.length >= 3 ? `Consensus EPS, FY ${years[0].fiscalEnd} to FY ${years[2].fiscalEnd}` : undefined },
    ] },
    { title: "Dividends", rows: [
      { label: "Yield", value: multipleOf(dividends == null ? null : Math.abs(dividends), marketCap), kind: "percent" },
      { label: "Payout", value: value("dividendPayout"), kind: "percent" },
      { label: "DPS", value: value("dividendsPerShare"), kind: "price" },
      { label: "DPS growth 3Y", value: cagr(view, "dividendsPerShare", 3), kind: "percent" },
      { label: "DPS growth 5Y", value: cagr(view, "dividendsPerShare", 5), kind: "percent" },
      { label: "DPS growth 10Y", value: cagr(view, "dividendsPerShare", 10), kind: "percent" },
    ] },
  ];
  // Only what could be struck; a block with nothing in it goes.
  return blocks.map((block) => ({ ...block, rows: block.rows.filter((row) => row.value != null && Number.isFinite(row.value)) })).filter((block) => block.rows.length > 0);
}
