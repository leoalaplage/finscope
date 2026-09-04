import { cagrForPeriods, derivedValue, valueOf } from "./finance";
import { shareCount, type SharesBasis } from "./market-basis";
import { balanceSheetHealth } from "./statement-flows";
import type { CompanyDataset, FinancialPeriod } from "./types";
import { isFinancialBusiness } from "./business-type";
import { currentDatasetPeriod } from "./current-period";
import type { QsStructuredInput } from "./qs/contracts";

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

const percent = (value: number | null) => value == null || !Number.isFinite(value) ? null : value * 100;
const billions = (value: number | null) => value == null || !Number.isFinite(value) ? null : value / 1e9;
const ratio = (value: number | null) => value == null || !Number.isFinite(value) ? null : value;
const over = (numerator: number | null, denominator: number | null) =>
  numerator == null || denominator == null || denominator <= 0 ? null : numerator / denominator;

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
    netDebt: financial ? null : current ? derivedValue(current, "netDebt") : null,
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
export function qsStructuredInput(
  dataset: CompanyDataset,
  price: number | null,
  priceCurrency: string | null = dataset.company.currency,
): QsStructuredInput {
  const annual = ordered(dataset, "annual");
  const current = currentDatasetPeriod(dataset) ?? null;
  const now = (metric: string) => current ? derivedValue(current, metric) : null;
  const financial = isFinancialBusiness(dataset.company.businessType);
  const industrial = (value: number | null) => financial ? null : value;

  const operatingCashFlow = now("operatingCashFlow");
  const capex = now("capitalExpenditures");
  const growth = (metric: string) => cagrForPeriods(annual, metric, 5).value;
  // The current ratio is not a derived metric but a balance-sheet health
  // question, so it comes from the panel that answers it rather than from a
  // second division here that could quietly disagree with it.
  const health = (key: string) => current ? balanceSheetHealth(current).find((item) => item.key === key)?.value ?? null : null;

  const valuation = qsValuationColumns(qsPriceInputs(dataset), price, priceCurrency);
  return {
    ticker: dataset.company.ticker,
    sector: dataset.company.sector,
    marketCapBillions: valuation["Market Cap"],
    metrics: {
      ROIC: percent(industrial(now("roic"))),
      ROIC5: percent(industrial(fiveYearAverage(annual, "roic"))),
      OpM: percent(now("operatingMargin")),
      FCFM5: percent(industrial(fiveYearAverage(annual, "freeCashFlowMargin"))),
      FCF_NI: percent(industrial(now("cashConversion"))),
      GM5: percent(fiveYearAverage(annual, "grossMargin")),
      ShOut5: percent(growth("dilutedShares")),
      SBC: percent(now("stockBasedCompensationToRevenue")),
      NetDebtEBITDA: ratio(industrial(health("netDebtToEbitda"))),
      EBITInt: ratio(now("interestCoverage")),
      CurrentRatio: ratio(health("currentRatio")),
      // The registry carries one total borrowing, not a maturity split, so this
      // is total debt over total assets and is labelled as the column the
      // screener knows. Overstating the long-term share would flatter no one:
      // the metric scores lower the higher it is.
      LTDebtAssets: ratio(industrial(over(valueOf(current ?? annual.at(-1) ?? ({} as FinancialPeriod), "totalDebt"), now("totalAssets")))),
      OCF_Capex: ratio(industrial(over(operatingCashFlow, capex == null ? null : Math.abs(capex)))),
      Rev5: percent(growth("revenue")),
      RevFwd3: null,
      LevFCF5: percent(industrial(growth("freeCashFlow"))),
      NI5: percent(growth("netIncome")),
      RevPS5: null,
      FCFPS5: null,
      EV_EBIT: valuation["EV/EBIT"],
      EV_FCF: valuation["EV/FCF"],
      FwdP_FCF: null,
      FCFYield: valuation["FCF Yield"],
    },
    references: {
      operatingCashFlowBillions: billions(industrial(operatingCashFlow)),
      capexBillions: billions(industrial(capex == null ? null : Math.abs(capex))),
      peg: null,
    },
  };
}

/** The legacy CSV-shaped row, produced from the same structured input. */
export function qsRow(dataset: CompanyDataset, price: number | null): QsRow {
  const input = qsStructuredInput(dataset, price);
  return {
    ticker: input.ticker,
    values: {
      "Ticker": input.ticker,
      "Sector": input.sector,
      "Market Cap": input.marketCapBillions,
      "ROIC": input.metrics.ROIC,
      "ROIC 5Yr Avg": input.metrics.ROIC5,
      "Operating Margin": input.metrics.OpM,
      "FCF Margin 5Yr Avg": input.metrics.FCFM5,
      "FCF / Net Income": input.metrics.FCF_NI,
      "Gross Margin 5Yr Avg": input.metrics.GM5,
      "Shares Outstanding 5Y CAGR": input.metrics.ShOut5,
      "SBC to Revenue": input.metrics.SBC,
      "Net Debt / EBITDA": input.metrics.NetDebtEBITDA,
      "EBIT / Interest Expense": input.metrics.EBITInt,
      "Current Ratio": input.metrics.CurrentRatio,
      "Long-term Debt to Assets": input.metrics.LTDebtAssets,
      "OCF/Capex": input.metrics.OCF_Capex,
      "Revenue 5Y CAGR": input.metrics.Rev5,
      "FCF 5Y CAGR": input.metrics.LevFCF5,
      "Net Income 5Y CAGR": input.metrics.NI5,
      "EV/EBIT": input.metrics.EV_EBIT,
      "EV/FCF": input.metrics.EV_FCF,
      "FCF Yield": input.metrics.FCFYield,
      "OCF": input.references.operatingCashFlowBillions,
      "Capex": input.references.capexBillions,
    },
  };
}

/** Bridges stored legacy digest columns to the structured engine during rollout. */
export function qsStructuredInputFromRow(row: QsRow): QsStructuredInput {
  const number = (column: string) => {
    const value = row.values[column];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  return {
    ticker: row.ticker,
    sector: typeof row.values.Sector === "string" ? row.values.Sector : "(n/a)",
    marketCapBillions: number("Market Cap"),
    metrics: {
      ROIC: number("ROIC"), ROIC5: number("ROIC 5Yr Avg"), OpM: number("Operating Margin"),
      FCFM5: number("FCF Margin 5Yr Avg"), FCF_NI: number("FCF / Net Income"), GM5: number("Gross Margin 5Yr Avg"),
      ShOut5: number("Shares Outstanding 5Y CAGR"), SBC: number("SBC to Revenue"),
      NetDebtEBITDA: number("Net Debt / EBITDA"), EBITInt: number("EBIT / Interest Expense"), CurrentRatio: number("Current Ratio"),
      LTDebtAssets: number("Long-term Debt to Assets"), OCF_Capex: number("OCF/Capex"),
      Rev5: number("Revenue 5Y CAGR"), RevFwd3: null, LevFCF5: number("FCF 5Y CAGR"), NI5: number("Net Income 5Y CAGR"),
      RevPS5: null, FCFPS5: null, EV_EBIT: number("EV/EBIT"), EV_FCF: number("EV/FCF"), FwdP_FCF: null, FCFYield: number("FCF Yield"),
    },
    references: { operatingCashFlowBillions: number("OCF"), capexBillions: number("Capex"), peg: null },
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
