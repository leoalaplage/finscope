import { cagrForPeriods, derivedValue, reportedDebt, valueOf } from "./finance";
import { shareCount, type SharesBasis } from "./market-basis";
import { balanceSheetHealth } from "./statement-flows";
import type { CompanyDataset, FinancialPeriod } from "./types";
import { isFinancialBusiness } from "./business-type";
import { currentDatasetPeriod } from "./current-period";
import { logLinearRSquared } from "./log-linear.js";

/**
 * The watchlist, written as the table the QS Screener already reads.
 *
 * Nothing here touches the screener: no formula, weight, threshold, anchor or
 * ranking rule is involved, and the engine never learns where its rows came
 * from. This builds the same comma-separated table a reader would paste, under
 * the same column titles the parser has always accepted, and hands it over the
 * same way. If the engine changes its mind about a metric tomorrow, this file
 * does not need to know.
 *
 * Two conventions decide whether the scores are right, and both come from the
 * screener's own parser:
 *
 *  - a percentage is a number out of a hundred, not a fraction — the parser
 *    strips a `%` sign and divides by 100 when it compounds, so 85.2 is what
 *    an 85.2% return must be written as;
 *  - money is in billions, because the column is titled `$Md`.
 *
 * The forward-looking columns — three-year revenue estimates, forward P/FCF,
 * PEG — are absent, because this application holds no analyst estimates and
 * will not invent any. The engine already drops a missing column and
 * renormalises the remaining weights, which is its own documented behaviour and
 * needs no change here.
 */

/** Column titles the screener's parser accepts, chosen from its alias lists. */
export const QS_COLUMNS = [
  "Ticker", "Sector", "Market Cap",
  "ROIC", "ROIC 5Yr Avg", "Operating Margin", "FCF Margin 5Yr Avg", "FCF / Net Income",
  "Gross Margin 5Yr Avg", "Shares Outstanding 5Y CAGR", "SBC to Revenue",
  "Net Debt / EBITDA", "EBIT / Interest Expense", "Current Ratio", "Long-term Debt to Assets", "OCF/Capex",
  "Revenue 5Y CAGR", "FCF 5Y CAGR", "Net Income 5Y CAGR",
  "Revenue Per Share 5Y CAGR", "FCF Per Share 5Y CAGR", "FCF/Share 5Y R2",
  "Revenue 10Y CAGR", "FCF 10Y CAGR", "Net Income 10Y CAGR",
  "Revenue Per Share 10Y CAGR", "FCF Per Share 10Y CAGR",
  "EV/EBIT", "EV/FCF", "FCF Yield",
  "OCF", "Capex",
] as const;

const ordered = (dataset: CompanyDataset, periodicity: "annual" | "ttm") =>
  dataset.periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

/** The mean of a metric over the last five reported years, on the same rule the statistics panel uses. */
function fiveYearAverage(annual: FinancialPeriod[], metric: string): number | null {
  const values = annual.slice(-5).map((period) => derivedValue(period, metric)).filter((value): value is number => value != null && Number.isFinite(value));
  return values.length < 3 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * How straight the last five years of free cash flow per share were.
 *
 * The same log-linear fit the company page's own panel draws, from the same
 * module, so the screener and the page can never state two different numbers
 * for one company. A zero or negative year has no logarithm and fewer than
 * three observations is not a trend: both come back as nothing rather than as
 * a nought, because "not measurable" and "erratic" are opposite statements.
 */
function fcfPerShareConsistency(annual: FinancialPeriod[]): number | null {
  const recent = annual.slice(-6);
  const first = recent[0];
  if (!first) return null;
  const points = recent.flatMap((period) => {
    const value = derivedValue(period, "freeCashFlowPerShare");
    return value == null || !Number.isFinite(value) ? [] : [{ x: yearsBetween(first.periodEnd, period.periodEnd), value }];
  });
  return logLinearRSquared(points);
}

/** Years between two balance-sheet dates, including leap years accurately enough for matching. */
const yearsBetween = (earlier: string, later: string) =>
  (Date.parse(later) - Date.parse(earlier)) / (365.2425 * 86_400_000);

const percent = (value: number | null) => value == null || !Number.isFinite(value) ? null : value * 100;
const billions = (value: number | null) => value == null || !Number.isFinite(value) ? null : value / 1e9;
const ratio = (value: number | null) => value == null || !Number.isFinite(value) ? null : value;
const over = (numerator: number | null, denominator: number | null) =>
  numerator == null || denominator == null || denominator <= 0 ? null : numerator / denominator;

/**
 * The most recent debt balance the filer actually stated.
 *
 * This used to be scoring's own rule, and having it here alone is what let the
 * screener rank Copart on a net debt the company page refused to state. It is
 * `reportedDebt` in finance.ts now — same reading, one definition — and every
 * screen that shows the figure says which filing it came from.
 */
const debtFor = (dataset: CompanyDataset, current: FinancialPeriod | null): number | null =>
  reportedDebt(dataset.periods, current)?.value ?? null;

function scoreNetDebt(dataset: CompanyDataset, current: FinancialPeriod | null): number | null {
  const debt = debtFor(dataset, current);
  const cash = current ? valueOf(current, "cashAndEquivalents") : null;
  return debt == null || cash == null ? null : debt - cash;
}

function scoreRoic(dataset: CompanyDataset, current: FinancialPeriod | null): number | null {
  if (!current) return null;
  const nopat = derivedValue(current, "nopat");
  const capital = (period: FinancialPeriod) => {
    const debt = debtFor(dataset, period);
    const equity = valueOf(period, "totalEquity");
    const cash = valueOf(period, "cashAndEquivalents");
    const invested = debt == null || equity == null || cash == null ? null : debt + equity - cash;
    return invested != null && invested > 0 ? invested : null;
  };
  const ending = capital(current);
  if (nopat == null || ending == null) return null;

  /*
   * A return earned through a year belongs over the capital employed through
   * that year, not only the balance left on its final day. Prefer a balance
   * close to twelve months earlier, regardless of whether it arrived in a
   * quarter or an annual filing. When no comparable opening balance exists we
   * keep the auditable period-end convention instead of fabricating one.
   */
  const opening = dataset.periods
    .filter((period) => period.periodEnd < current.periodEnd)
    .map((period) => ({ period, distance: Math.abs(yearsBetween(period.periodEnd, current.periodEnd) - 1) }))
    .filter(({ period, distance }) => distance <= 0.25 && capital(period) != null)
    .sort((left, right) => left.distance - right.distance)[0]?.period;
  const openingCapital = opening ? capital(opening) : null;
  return over(nopat, openingCapital == null ? ending : (openingCapital + ending) / 2);
}

/** Five annual ROIC readings, each using average capital where an opening balance exists. */
function fiveYearRoicAverage(dataset: CompanyDataset, annual: FinancialPeriod[]): number | null {
  const values = annual.slice(-5)
    .map((period) => scoreRoic(dataset, period))
    .filter((value): value is number => value != null && Number.isFinite(value));
  return values.length < 3 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Long-term borrowing and leases, before falling back to total debt.
 *
 * The detailed SEC concepts are preferred because the metric explicitly asks
 * about structural debt. Some filers only publish a validated total, though;
 * using that total as a conservative ceiling preserves coverage without ever
 * making leverage look lower than the filing supports.
 */
function longTermDebtFor(dataset: CompanyDataset, current: FinancialPeriod | null): number | null {
  const read = (period: FinancialPeriod): number | null => {
    const combined = valueOf(period, "longTermDebtAndLeases");
    if (combined != null) return combined;
    const due = valueOf(period, "longTermDebtCurrent");
    const noncurrent = valueOf(period, "longTermDebtNoncurrent");
    if (due != null && noncurrent != null) return due + noncurrent;
    return noncurrent ?? valueOf(period, "otherLongTermDebt") ?? valueOf(period, "financeLeaseLiability");
  };
  if (current) {
    const own = read(current);
    if (own != null) return own;
  }
  const annual = dataset.periods
    .filter((period) => period.periodicity === "annual" && (!current || period.periodEnd <= current.periodEnd))
    .sort((left, right) => right.periodEnd.localeCompare(left.periodEnd))
    .find((period) => read(period) != null);
  return annual ? read(annual) : debtFor(dataset, current);
}

export interface QsRow {
  ticker: string;
  values: Record<string, number | string | null>;
  /**
   * The window the row was actually struck on.
   *
   * Not always the newest one the company has: where its most recent trailing
   * period carries no operating income, the score reads the newest one that
   * does. A grade shown against a date the figures did not come from is worse
   * than a grade shown against an older date, so the date travels with it.
   *
   * Optional because a table assembled in the browser from a pasted export has
   * no filed period behind it — only `qsRow` can know one.
   */
  period?: { label: string; end: string } | null;
}

/**
 * The few figures the valuation columns need a live price to finish.
 *
 * Kept separate because the table is built once a day and stored, while a
 * price is worth having as of now. Storing a market capitalisation would bake
 * yesterday's close into today's score, which is the kind of quiet staleness
 * this application refuses everywhere else.
 */
export interface QsPriceInputs { shares: number | null; sharesBasis: SharesBasis | null; currency: string | null; netDebt: number | null; operatingIncome: number | null; freeCashFlow: number | null }

export function qsPriceInputs(dataset: CompanyDataset): QsPriceInputs {
  const current = currentDatasetPeriod(dataset) ?? null;
  const counted = current ? shareCount(current) : null;
  const financial = isFinancialBusiness(dataset.company.businessType);
  return {
    shares: counted?.shares ?? null,
    sharesBasis: counted?.basis ?? null,
    // Carried so the client can refuse to divide a price quoted in one
    // currency into a statement kept in another.
    currency: current?.currency ?? null,
    netDebt: financial ? null : scoreNetDebt(dataset, current),
    operatingIncome: current ? derivedValue(current, "operatingIncome") : null,
    freeCashFlow: financial ? null : current ? derivedValue(current, "freeCashFlow") : null,
  };
}

/** The four columns that need a price, from one definition used on both sides. */
export function qsValuationColumns(inputs: QsPriceInputs, price: number | null, priceCurrency?: string | null): Record<string, number | null> {
  // A price in another currency finishes nothing: the columns stay empty rather
  // than stating a dollar market capitalisation against a euro cash flow.
  const compatible = priceCurrency == null || inputs.currency == null || priceCurrency === inputs.currency;
  const marketCap = compatible && price != null && Number.isFinite(price) && price > 0 && inputs.shares != null ? price * inputs.shares : null;
  const enterpriseValue = marketCap != null && inputs.netDebt != null ? marketCap + inputs.netDebt : null;
  return {
    "Market Cap": billions(marketCap),
    "EV/EBIT": ratio(over(enterpriseValue, inputs.operatingIncome)),
    "EV/FCF": ratio(over(enterpriseValue, inputs.freeCashFlow)),
    "FCF Yield": percent(over(inputs.freeCashFlow, marketCap)),
  };
}

/**
 * One company as a row of the screener's table.
 *
 * `price` is the matched close the rest of the application uses; without one
 * there is no market capitalisation and therefore no valuation column, and the
 * quality, health and growth pillars still score.
 */
/**
 * The newest period this company can actually be scored on.
 *
 * Not always the newest one it has. A filer's most recent trailing window is
 * assembled from quarters, and a quarter that tags no operating income leaves
 * that window with a revenue line and nothing under it: Eli Lilly's two newest
 * trailing periods carry no operating income, no interest expense and therefore
 * no EBITDA, so leverage and interest cover went missing and a company with a
 * complete annual record fell to 65% coverage and lost its grade.
 *
 * The figures are there one period back. Reading them from the newest filing
 * that states them is the rule this application already follows for a borrowing
 * the latest quarter does not tag, and for a free cash flow whose denominator
 * arrives a quarter late. The period travels with the score, so a reader sees
 * which window the grade was struck on rather than being told a date that is
 * not where the numbers came from.
 *
 * Only the income statement decides. A period missing a balance-sheet line is
 * missing one measure; a period missing its operating income is missing the
 * subtotal six of them rest on.
 */
function scorePeriod(dataset: CompanyDataset): FinancialPeriod | null {
  const newest = currentDatasetPeriod(dataset) ?? null;
  const scoreable = (period: FinancialPeriod) =>
    derivedValue(period, "revenue") != null && derivedValue(period, "operatingIncome") != null;
  if (!newest || scoreable(newest)) return newest;
  const earlier = dataset.periods
    .filter((period) => period.periodicity === newest.periodicity && period.periodEnd < newest.periodEnd)
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd));
  // Back through the same kind of window, newest first, and no further than the
  // one before last: a grade struck on figures a year stale is not a grade.
  for (const period of earlier.slice(-4).reverse()) if (scoreable(period)) return period;
  return newest;
}

export function qsRow(dataset: CompanyDataset, price: number | null): QsRow {
  const annual = ordered(dataset, "annual");
  const current = scorePeriod(dataset);
  const now = (metric: string) => current ? derivedValue(current, metric) : null;
  const financial = isFinancialBusiness(dataset.company.businessType);
  const industrial = (value: number | null) => financial ? null : value;

  const operatingCashFlow = now("operatingCashFlow");
  const capex = now("capitalExpenditures");
  const netDebt = scoreNetDebt(dataset, current);
  const ebitda = now("ebitda");
  const interest = now("interestExpense") ?? now("interestPaid");
  const growth = (metric: string) => cagrForPeriods(annual, metric, 5).value;
  /*
   * The same rate over the decade.
   *
   * Five years from a trough measures the climb out of it. Booking compounds
   * revenue at 31.7% a year over five and 11.3% over ten, because its 2020 is a
   * hole; the whole travel, energy and airline complex reads the same way. The
   * long window is not better — it is slower to notice a business that has
   * genuinely changed — so both are scored, and neither is allowed to answer
   * for the other.
   */
  const growth10 = (metric: string) => cagrForPeriods(annual, metric, 10).value;
  // The current ratio is not a derived metric but a balance-sheet health
  // question, so it comes from the panel that answers it rather than from a
  // second division here that could quietly disagree with it.
  const health = (key: string) => current ? balanceSheetHealth(current).find((item) => item.key === key)?.value ?? null : null;

  return {
    ticker: dataset.company.ticker,
    period: current ? { label: current.label, end: current.periodEnd } : null,
    values: {
      "Ticker": dataset.company.ticker,
      "Sector": dataset.company.sector,

      "ROIC": percent(industrial(scoreRoic(dataset, current))),
      "ROIC 5Yr Avg": percent(industrial(fiveYearRoicAverage(dataset, annual))),
      "Operating Margin": percent(now("operatingMargin")),
      "FCF Margin 5Yr Avg": percent(industrial(fiveYearAverage(annual, "freeCashFlowMargin"))),
      "FCF / Net Income": percent(industrial(now("cashConversion"))),
      "Gross Margin 5Yr Avg": percent(fiveYearAverage(annual, "grossMargin")),
      "Shares Outstanding 5Y CAGR": percent(growth("dilutedShares")),
      "SBC to Revenue": percent(now("stockBasedCompensationToRevenue")),

      "Net Debt / EBITDA": ratio(industrial(over(netDebt, ebitda))),
      "EBIT / Interest Expense": ratio(over(now("operatingIncome"), interest)),
      "Current Ratio": ratio(health("currentRatio")),
      "Long-term Debt to Assets": ratio(industrial(over(longTermDebtFor(dataset, current), now("totalAssets")))),
      "OCF/Capex": ratio(industrial(over(operatingCashFlow, capex == null ? null : Math.abs(capex)))),

      "Revenue 5Y CAGR": percent(growth("revenue")),
      "FCF 5Y CAGR": percent(industrial(growth("freeCashFlow"))),
      "Net Income 5Y CAGR": percent(growth("netIncome")),
      /*
       * Per share, which is the half of growth a total hides.
       *
       * Both are scored — forty of the Growth pillar's hundred points — and
       * neither had a column title, so no table could ever supply them and no
       * company could ever earn them. FinScope has computed both all along.
       */
      "Revenue Per Share 5Y CAGR": percent(growth("revenuePerShare")),
      "FCF Per Share 5Y CAGR": percent(industrial(growth("freeCashFlowPerShare"))),
      /*
       * And how straight that line was, which the rate alone cannot say.
       *
       * Two companies compounding free cash flow per share at twelve per cent —
       * one a step a year, the other a collapse and a recovery — end in the
       * same place and are not the same business. Scored in Quality rather than
       * Growth, because it is a property of the earnings and not a rate of
       * them. Fitted on the same annual figures the CAGR above is read from.
       */
      "FCF/Share 5Y R2": industrial(fcfPerShareConsistency(annual)),

      /*
       * And the decade, which is where a recovery stops looking like growth.
       *
       * Weighted a little under the five-year figures, so a business that has
       * genuinely accelerated is not held back by its own history — but heavily
       * enough that a company whose growth exists only since 2020 cannot reach
       * the same score as one that has compounded through two cycles. A company
       * younger than ten years simply has no such figure, and the coverage rule
       * decides whether it can still be graded.
       */
      "Revenue 10Y CAGR": percent(growth10("revenue")),
      "FCF 10Y CAGR": percent(industrial(growth10("freeCashFlow"))),
      "Net Income 10Y CAGR": percent(growth10("netIncome")),
      "Revenue Per Share 10Y CAGR": percent(growth10("revenuePerShare")),
      "FCF Per Share 10Y CAGR": percent(industrial(growth10("freeCashFlowPerShare"))),

      "OCF": billions(industrial(operatingCashFlow)),
      "Capex": billions(industrial(capex == null ? null : Math.abs(capex))),
      ...qsValuationColumns(qsPriceInputs(dataset), price),
    },
  };
}

/** A cell as the parser wants to read it: a plain number, or nothing at all. */
const cell = (value: number | string | null) => {
  if (value == null) return "";
  if (typeof value === "string") return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return Number.isFinite(value) ? String(Number(value.toFixed(4))) : "";
};

/** The whole watchlist as one comma-separated table, header row first. */
export function qsTable(rows: QsRow[]): string {
  return [QS_COLUMNS.join(","), ...rows.map((row) => QS_COLUMNS.map((column) => cell(row.values[column] ?? null)).join(","))].join("\n");
}
