import { balanceSheetIsTheBusiness } from "../business-type";
import { validatedDerivedValue } from "../data-quality";
import { currentDatasetPeriod } from "../current-period";
import { reportedDebt, valueOf } from "../finance";
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
  /** The filed basis needed to price this period after it became public. */
  valuationBasis: {
    shares: number;
    sharesBasis: "outstanding" | "cover-date" | "diluted";
    sharesNote: string | null;
    netDebt: number | null;
    debtFrom: { label: string; periodEnd: string } | null;
  } | null;
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
  /**
   * Where the borrowings behind that net debt were filed, when they were not
   * filed with this period.
   *
   * A quarterly balance sheet omits an immaterial borrowing that the annual
   * note states exactly, and the enterprise value of a company with $3.3bn of
   * cash should not disappear over $2.7m of finance leases nobody tagged this
   * quarter. The balance is read back to the filing that states one and the
   * page says which — a figure with a date on it, never an absence read as a
   * zero.
   */
  debtFrom: { label: string; periodEnd: string } | null;
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
  annual: IoPeriod[];
  quarterly: IoPeriod[];
  trailing: IoPeriod[];
  ttm: IoPeriod | null;
  basis: IoValuationBasis | null;
  basisReason: string | null;
  /** Why some measures are absent for this filer, when they are. */
  withheldReason: string | null;
  warnings: string[];
}

const IO_METRIC_KEYS = Object.keys(METRICS);

/**
 * Measures a bank, a broker or an insurer is not given.
 *
 * Every one of them is struck on a boundary that does not exist at such a
 * filer. Free cash flow subtracts capital expenditure from an operating cash
 * flow that is mostly the movement of loans and deposits — JPMorgan's is
 * *minus* a hundred and sixty billion, against two hundred billion of revenue.
 * Net debt treats borrowings as leverage when they are the raw material. A
 * return on invested capital divides by other people's money.
 *
 * The engine can compute all of them, and where a filer happens to tag a
 * capital expenditure it did: Bank of America carried a free-cash-flow margin
 * of 107% for 2009. A number that arrives only when an unrelated concept
 * happens to be tagged is not a measure, it is an accident.
 */
const NOT_FOR_FINANCIALS = new Set([
  "freeCashFlow", "freeCashFlowAfterSbc", "freeCashFlowPerShare", "freeCashFlowAfterSbcPerShare",
  "freeCashFlowMargin", "freeCashFlowAfterSbcMargin", "operatingCashFlowMargin", "cashConversion",
  "netDebt", "roic", "cashReturnOnCapital", "returnOnCapitalEmployed",
  "investedCapital", "nopat", "capitalIntensity",
]);

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

function projectPeriod(dataset: CompanyDataset, period: FinancialPeriod, withheld: ReadonlySet<string>): IoPeriod {
  const values: Record<string, number | null> = {};
  for (const key of IO_METRIC_KEYS) values[key] = withheld.has(key) ? null : validatedDerivedValue(period, key, "validated");
  const counted = shareCount(period);
  const borrowed = withheld.has("netDebt") ? null : reportedDebt(dataset.periods, period);
  const cash = valueOf(period, "cashAndEquivalents");
  const netDebt = borrowed == null || cash == null ? null : borrowed.value - cash;
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
    valuationBasis: counted ? {
      shares: counted.shares,
      sharesBasis: counted.basis,
      sharesNote: counted.note ?? null,
      netDebt,
      debtFrom: netDebt != null && borrowed?.carried ? { label: borrowed.label, periodEnd: borrowed.periodEnd } : null,
    } : null,
  };
}

/** Ascending by period end, then the most recent `limit` of them. */
function ordered(periods: FinancialPeriod[], periodicity: FinancialPeriod["periodicity"], limit: number) {
  return periods
    .filter((period) => period.periodicity === periodicity)
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
    .slice(-limit);
}

function valuationBasis(dataset: CompanyDataset, withheld: ReadonlySet<string>): { basis: IoValuationBasis | null; reason: string | null } {
  const period = currentDatasetPeriod(dataset)
    ?? ordered(dataset.periods, "annual", 1).at(-1);
  if (!period) return { basis: null, reason: "No filed period carries a share count." };
  const count = shareCount(period);
  if (!count) return { basis: null, reason: "The latest filing carries no share count, so no multiple can be struck." };
  /*
   * Net debt on this period's cash and the last borrowings anybody filed.
   *
   * The cash is always this period's — it is the balance that moves, and every
   * filing states it. The borrowings are read back only where this period tags
   * none at all, and the date they came from travels with them.
   */
  const borrowed = withheld.has("netDebt") ? null : reportedDebt(dataset.periods, period);
  const cash = valueOf(period, "cashAndEquivalents");
  const netDebt = withheld.has("netDebt") || borrowed == null || cash == null ? null : borrowed.value - cash;
  return {
    reason: null,
    basis: {
      currency: period.currency,
      shares: count.shares,
      sharesBasis: count.basis,
      sharesNote: count.note ?? null,
      netDebt,
      debtFrom: netDebt != null && borrowed?.carried ? { label: borrowed.label, periodEnd: borrowed.periodEnd } : null,
      periodEnd: period.periodEnd,
      periodLabel: period.label,
    },
  };
}

export function companyView(dataset: CompanyDataset): IoCompanyView {
  const current = currentDatasetPeriod(dataset);
  const withheld = balanceSheetIsTheBusiness(dataset.company.businessType) ? NOT_FOR_FINANCIALS : new Set<string>();
  const project = (period: FinancialPeriod) => projectPeriod(dataset, period, withheld);
  const trailing = ordered(dataset.periods, "ttm", TTM_LIMIT).map(project);
  const annual = ordered(dataset.periods, "annual", ANNUAL_LIMIT).map(project);
  const quarterly = ordered(dataset.periods, "quarterly", QUARTERLY_LIMIT).map(project);
  const ttm = trailing.at(-1) ?? null;
  const { basis, reason } = valuationBasis(dataset, withheld);
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
    annual,
    quarterly,
    trailing,
    ttm,
    basis,
    basisReason: reason,
    withheldReason: withheld.size
      ? "Free cash flow, net debt and returns on invested capital are not stated for this filer: its operating cash flow is the movement of its own loans and deposits, and its borrowings are its raw material rather than its leverage."
      : null,
    warnings: dataset.warnings.slice(0, 4),
  };
}
