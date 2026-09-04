import { validatedDerivedValue } from "../data-quality";
import { currentDatasetPeriod } from "../current-period";
import { netDebt as netDebtOf } from "../finance";
import { shareCount } from "../market-basis";
import { METRICS, type MetricKind } from "../metrics";
import type { CompanyDataset, FinancialPeriod } from "../types";

/**
 * The whole company, in the shape one web page actually draws.
 *
 * A normalized company is about four megabytes: every fact it carries, every
 * provenance record, every validation note, for every period the filer has ever
 * published. The research workspace loads that because it shows all of it. A
 * page whose promise is that it opens instantly cannot, so this reduces the
 * same dataset to the figures a reader looks at — computed by the same engine,
 * through the same validation gate, and never re-derived in the browser.
 *
 * Nothing here is estimated. A metric the filings do not support is `null`,
 * which the page draws as an absence rather than as a zero.
 */

/** A metric's identity, sent once so the browser needs no copy of the registry. */
export interface IoMetric {
  key: string;
  label: string;
  short: string;
  unit: MetricKind;
  formula: string | null;
}

export interface IoPeriod {
  /** "FY2025", "Q3 2026", "TTM" — the label the engine already assigns. */
  label: string;
  end: string;
  start: string | null;
  fiscalYear: number;
  fiscalQuarter: string | null;
  filingDate: string;
  accession: string;
  currency: string;
  values: Record<string, number | null>;
}

/**
 * What a live price may legitimately be multiplied by.
 *
 * The share count and the currency of the accounts travel together because the
 * two questions that decide whether a multiple is a fact at all are asked of
 * them: is the quote in the currency the statements are kept in, and is the
 * count the one the company has outstanding. See `marketBasis`, which asks the
 * same two questions of a matched historical session.
 */
export interface IoValuationBasis {
  currency: string;
  shares: number;
  sharesBasis: "outstanding" | "cover-date" | "diluted";
  sharesNote: string | null;
  netDebt: number | null;
  periodEnd: string;
  periodLabel: string;
}

export interface IoCompanyView {
  company: {
    ticker: string;
    name: string;
    cik: string;
    exchange: string;
    sector: string;
    currency: string;
    description: string;
    businessType: string | null;
    resolution: string;
  };
  retrievedAt: string;
  current: { label: string; end: string; frequency: string } | null;
  metrics: IoMetric[];
  sections: Array<{ id: string; label: string; metrics: string[] }>;
  annual: IoPeriod[];
  quarterly: IoPeriod[];
  trailing: IoPeriod[];
  ttm: IoPeriod | null;
  basis: IoValuationBasis | null;
  basisReason: string | null;
  warnings: string[];
}

/**
 * The statements, in reading order.
 *
 * One list per statement, each following the order the statement itself is
 * filed in, so a reader scanning the table finds revenue above cost above gross
 * profit rather than an alphabetised inventory of concepts.
 */
export const IO_SECTIONS: Array<{ id: string; label: string; metrics: string[] }> = [
  {
    id: "income",
    label: "Income statement",
    metrics: [
      "revenue", "costOfRevenue", "grossProfit", "researchAndDevelopment",
      "sellingGeneralAndAdministrative", "operatingExpenses", "operatingIncome",
      "ebitda", "interestExpense", "otherIncomeExpense", "incomeBeforeTax",
      "incomeTaxExpense", "netIncome", "netIncomePerShare", "dilutedShares", "basicShares",
    ],
  },
  {
    id: "balance",
    label: "Balance sheet",
    metrics: [
      "cashAndEquivalents", "shortTermInvestments", "accountsReceivable", "inventory",
      "currentAssets", "propertyPlantAndEquipment", "goodwill", "intangibleAssets",
      "longTermInvestments", "totalAssets", "accountsPayable", "currentLiabilities",
      "totalDebt", "totalLiabilities", "retainedEarnings", "totalEquity", "netDebt",
      "sharesOutstanding",
    ],
  },
  {
    id: "cashflow",
    label: "Cash flow",
    metrics: [
      "operatingCashFlow", "depreciationAndAmortization", "stockBasedCompensation",
      "capitalExpenditures", "freeCashFlow", "freeCashFlowAfterSbc", "freeCashFlowPerShare",
      "acquisitions", "shareRepurchases", "shareIssuance", "netShareRepurchases",
      "dividendsPaid", "dividendsPerShare",
    ],
  },
  {
    id: "ratios",
    label: "Margins and returns",
    metrics: [
      "grossMargin", "operatingMargin", "ebitdaMargin", "netMargin",
      "operatingCashFlowMargin", "freeCashFlowMargin", "cashConversion",
      "roic", "cashReturnOnCapital", "returnOnEquity", "returnOnAssets",
      "returnOnCapitalEmployed", "capitalIntensity", "effectiveTaxRate",
      "dividendPayout", "debtToEquity", "interestCoverage",
    ],
  },
];

const IO_METRIC_KEYS = Object.keys(METRICS);

/**
 * How far back the page goes.
 *
 * Twenty years of annual figures is longer than almost any filer's XBRL history
 * and short enough that the payload stays small; twenty-four quarters is six
 * years, which is where a quarterly chart stops being readable anyway.
 */
const ANNUAL_LIMIT = 20;
const QUARTERLY_LIMIT = 24;
/**
 * Every trailing period the filings support, because MAX has to mean MAX.
 *
 * This was twenty-four — six years — and the page's widest window was drawn
 * from it, so a reader who asked for everything and stayed on trailing figures
 * was shown six years of a seventeen-year history and had no way to tell.
 * Eighty covers twenty years, which is longer than any filer's XBRL.
 */
const TTM_LIMIT = 80;

/**
 * The measures this company actually has, not the whole registry.
 *
 * The registry holds a hundred and six, and twenty-one of them cannot be
 * computed from a filed period at all — a market capitalisation, a
 * price-to-earnings, a share price, every compound rate — because they need a
 * quote or a second period. They were shipped for every company, in every
 * period, as a column of nulls that no chart could ever draw. A measure earns
 * its place here by being present somewhere in the periods below it.
 */
function metricCatalogue(periods: IoPeriod[]): IoMetric[] {
  return IO_METRIC_KEYS
    .filter((key) => periods.some((period) => period.values[key] != null))
    .map((key) => {
      const definition = METRICS[key];
      return {
        key,
        label: definition.label,
        short: definition.short,
        unit: definition.kind,
        formula: definition.formula ?? null,
      };
    });
}

function projectPeriod(period: FinancialPeriod): IoPeriod {
  const values: Record<string, number | null> = {};
  for (const key of IO_METRIC_KEYS) values[key] = validatedDerivedValue(period, key, "validated");
  return {
    label: period.label,
    end: period.periodEnd,
    start: period.periodStart ?? null,
    fiscalYear: period.fiscalYear,
    fiscalQuarter: period.fiscalQuarter ?? null,
    filingDate: period.filingDate,
    accession: period.accession,
    currency: period.currency,
    values,
  };
}

/** Ascending by period end, then the most recent `limit` of them. */
function ordered(periods: FinancialPeriod[], periodicity: FinancialPeriod["periodicity"], limit: number) {
  return periods
    .filter((period) => period.periodicity === periodicity)
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
    .slice(-limit);
}

function valuationBasis(dataset: CompanyDataset): { basis: IoValuationBasis | null; reason: string | null } {
  const period = currentDatasetPeriod(dataset)
    ?? ordered(dataset.periods, "annual", 1).at(-1);
  if (!period) return { basis: null, reason: "No filed period carries a share count." };
  const count = shareCount(period);
  if (!count) return { basis: null, reason: "The latest filing carries no share count, so no multiple can be struck." };
  return {
    reason: null,
    basis: {
      currency: period.currency,
      shares: count.shares,
      sharesBasis: count.basis,
      sharesNote: count.note ?? null,
      netDebt: netDebtOf(period),
      periodEnd: period.periodEnd,
      periodLabel: period.label,
    },
  };
}

export function companyView(dataset: CompanyDataset): IoCompanyView {
  const current = currentDatasetPeriod(dataset);
  const trailing = ordered(dataset.periods, "ttm", TTM_LIMIT).map(projectPeriod);
  const annual = ordered(dataset.periods, "annual", ANNUAL_LIMIT).map(projectPeriod);
  const quarterly = ordered(dataset.periods, "quarterly", QUARTERLY_LIMIT).map(projectPeriod);
  const ttm = trailing.at(-1) ?? null;
  const { basis, reason } = valuationBasis(dataset);
  return {
    company: {
      ticker: dataset.company.ticker,
      name: dataset.company.name,
      cik: dataset.company.cik,
      exchange: dataset.company.exchange,
      sector: dataset.company.sector,
      currency: dataset.company.currency,
      description: dataset.company.description,
      businessType: dataset.company.businessType ?? null,
      resolution: dataset.company.resolutionStatus ?? "partial",
    },
    retrievedAt: dataset.retrievedAt,
    current: current
      ? { label: current.label, end: current.periodEnd, frequency: current.periodicity }
      : null,
    metrics: metricCatalogue([...annual, ...quarterly, ...trailing]),
    sections: IO_SECTIONS,
    annual,
    quarterly,
    trailing,
    ttm,
    basis,
    basisReason: reason,
    warnings: dataset.warnings.slice(0, 4),
  };
}
