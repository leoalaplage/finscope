import { cagrForPeriods, derivedValue, reportedDebt, valueOf } from "./finance";
import { shareCount, type SharesBasis } from "./market-basis";
import { balanceSheetHealth } from "./statement-flows";
import type { CompanyDataset, FinancialPeriod } from "./types";
import { isFinancialBusiness } from "./business-type";
import { currentDatasetPeriod } from "./current-period";

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
  "Revenue Per Share 5Y CAGR", "FCF Per Share 5Y CAGR",
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

export interface QsRow { ticker: string; values: Record<string, number | string | null> }

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
export function qsRow(dataset: CompanyDataset, price: number | null): QsRow {
  const annual = ordered(dataset, "annual");
  const current = currentDatasetPeriod(dataset) ?? null;
  const now = (metric: string) => current ? derivedValue(current, metric) : null;
  const financial = isFinancialBusiness(dataset.company.businessType);
  const industrial = (value: number | null) => financial ? null : value;

  const operatingCashFlow = now("operatingCashFlow");
  const capex = now("capitalExpenditures");
  const netDebt = scoreNetDebt(dataset, current);
  const ebitda = now("ebitda");
  const interest = now("interestExpense") ?? now("interestPaid");
  const growth = (metric: string) => cagrForPeriods(annual, metric, 5).value;
  // The current ratio is not a derived metric but a balance-sheet health
  // question, so it comes from the panel that answers it rather than from a
  // second division here that could quietly disagree with it.
  const health = (key: string) => current ? balanceSheetHealth(current).find((item) => item.key === key)?.value ?? null : null;

  return {
    ticker: dataset.company.ticker,
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
