import { cagrForPeriods, derivedValue, nopatBasis, safeDivide } from "./finance";
import { marketBasis, shareCount } from "./market-basis";
import { METRICS } from "./metrics";
import type { CompanyDataset, FinancialPeriod, PricePoint } from "./types";

export type StatFormat = "currency" | "percent" | "ratio" | "multiple" | "shares" | "perShare" | "points";

export interface Stat {
  key: string;
  label: string;
  value: number | null;
  format: StatFormat;
  /**
   * Which direction is better, for the comparison highlight only.
   *
   * A market capitalisation has no better direction, and neither does a payout
   * ratio — a company returning nothing is not thereby worse than one returning
   * everything. Those are `0` and are never highlighted.
   */
  polarity: 1 | -1 | 0;
  formula?: string;
  /** Why the value is missing, when that is worth saying. */
  reason?: string;
}

export interface StatGroup { title: string; note?: string; stats: Stat[] }

/** Periods of one periodicity, oldest first. */
function ordered(dataset: CompanyDataset, periodicity: "annual" | "ttm"): FinancialPeriod[] {
  return dataset.periods.filter((period) => period.periodicity === periodicity).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

/**
 * The mean of a ratio over the last `years` reported years.
 *
 * A single year's return on capital moves with one impairment or one tax
 * settlement. The average over a cycle is the figure worth comparing across
 * companies, which is why the screenshot this follows states returns that way.
 * Missing years are skipped rather than counted as zero; fewer than three
 * usable years is not an average and returns nothing.
 */
function averageOver(annual: FinancialPeriod[], metric: string, years = 5): { value: number | null; reason?: string } {
  const values = annual.slice(-years).map((period) => derivedValue(period, metric)).filter((value): value is number => value != null && Number.isFinite(value));
  if (values.length < 3) return { value: null, reason: `Needs three reported years, has ${values.length}` };
  return { value: values.reduce((sum, value) => sum + value, 0) / values.length };
}

function cagr(annual: FinancialPeriod[], metric: string, years: 3 | 5 | 10): { value: number | null; reason?: string } {
  const result = cagrForPeriods(annual, metric, years);
  return { value: result.value, reason: result.value == null ? result.reason : undefined };
}

/**
 * Every headline statistic for one company, grouped the way an analyst reads
 * them: what the business is, what it keeps, what that earns on capital, what
 * the market charges for it, whether it can pay its debts, how fast it compounds
 * and what it hands back.
 *
 * Forward-looking blocks — next-twelve-month multiples, price targets, PEG,
 * two-year forward growth, long-term EPS estimates — are absent by construction.
 * Every one of them is a consensus of analyst estimates, and FinScope has no
 * estimates provider. Printing them would mean inventing them.
 */
/**
 * Why free-cash-flow measures are withheld for banks, brokers and exchanges.
 *
 * Operating cash flow at a financial institution moves with customer balances,
 * clearing deposits and margin lending — money that belongs to clients and
 * passes through the statement. Dividing that by a net revenue line produces a
 * number that is arithmetically correct and describes nothing: Interactive
 * Brokers came out at a 395% free-cash-flow margin and a 1773% cash return on
 * capital, printed on a watchlist card as though they were facts about the
 * business.
 *
 * A blank with a reason costs a reader nothing. A four-figure percentage costs
 * them their trust in every other number on the page.
 */
const FINANCIAL_CASH_FLOW = "Not meaningful at a financial institution";

/**
 * The same point at length, stated once at the top of the group.
 *
 * The short reason above sits on eight rows. Repeating a twenty-word
 * explanation on each of them is the right information served badly: the panel
 * becomes a wall of one sentence, and a reader stops reading any of it.
 */
const FINANCIAL_NOTE = "Free-cash-flow measures are withheld: operating cash flow at a bank, broker or exchange moves with customer and clearing balances — money belonging to clients that passes through the statement — so dividing it by a net revenue line gives a figure that is arithmetically correct and describes nothing.";

export function companyStatistics(dataset: CompanyDataset, price: PricePoint | null): StatGroup[] {
  const financial = dataset.company.businessType === "financial";
  /** The value, unless free cash flow is meaningless for this filer. */
  const cash = (value: number | null) => financial ? null : value;
  /*
   * ...and the reason that goes with it, only where it is the reason.
   *
   * The withheld-for-a-bank sentence used to sit on these rows unconditionally,
   * so an operating company missing an input met "Not meaningful at a financial
   * institution" — a true sentence about somebody else, which reads as a
   * misclassification of the company being looked at.
   */
  const cashReason = financial ? FINANCIAL_CASH_FLOW : undefined;
  const annual = ordered(dataset, "annual");
  const ttmPeriods = ordered(dataset, "ttm");
  // TTM is the right base for a flow when four clean quarters exist; the last
  // reported year is the honest fallback rather than an annualised quarter.
  const current = ttmPeriods.at(-1) ?? annual.at(-1) ?? null;

  /*
   * Every priced figure in this panel comes from one basis, or from none.
   *
   * The basis refuses a price quoted in a currency the statements are not kept
   * in, and refuses to read an unreported debt balance as zero. When it refuses,
   * market cap, enterprise value, all six multiples and the dividend yield are
   * unavailable together and carry the same reason — rather than one of them
   * quietly using a dollar price against a euro profit while the row beside it
   * says the price is missing.
   */
  const priced = current ? marketBasis(current, price) : { basis: null, reason: "No reported period to price" as string | undefined };
  const basis = priced.basis;
  const close = basis?.price ?? null;

  const flow = (metric: string) => current ? derivedValue(current, metric) : null;
  const counted = current ? shareCount(current) : null;
  const shares = counted?.shares ?? null;
  const marketCap = basis?.marketCap ?? null;
  const netDebt = flow("netDebt");
  const enterpriseValue = basis?.enterpriseValue ?? null;

  /** A multiple is only meaningful over a positive denominator. */
  const over = (numerator: number | null, denominator: number | null) =>
    numerator == null || denominator == null || denominator <= 0 ? null : numerator / denominator;

  const noPrice = priced.reason;
  /** Why there is no enterprise value: no price, or no readable debt balance. */
  const noEnterpriseValue = noPrice ?? basis?.enterpriseValueReason;
  const netDebtReason = "The filing tags no debt or no cash balance; an absent balance is not a zero one";
  /*
   * A missing value always says something, even when nothing specific is known.
   *
   * Most rows here pass a reason and the rest passed none, so a reader met a
   * bare dash and had no way to tell "this filer does not report it" from "the
   * application failed". Booking stopped tagging a gross-profit line after
   * 2017; its Gross Profit row simply went blank and stayed blank. The generic
   * fallback is deliberately about the filings rather than about us, because
   * that is where the gap is; a specific reason always wins.
   */
  const stat = (key: string, label: string, value: number | null, format: StatFormat, polarity: 1 | -1 | 0, reason?: string, formula?: string): Stat =>
    ({ key, label, value, format, polarity, formula: formula ?? METRICS[key]?.formula, reason: value == null ? reason ?? "Not reported in the filings for this period" : undefined });

  /*
   * A return computed on an assumed tax rate says so.
   *
   * NOPAT falls back to the statutory 21% whenever the reported effective rate
   * is missing, negative or above sixty percent — a loss-making year, or one
   * settled at an unusual rate. The figure is still worth showing; presenting
   * it with the same authority as one built from the company's own tax line is
   * not, and the evidence drawer could not tell the two paths apart either.
   */
  const taxAssumed = current ? nopatBasis(current).assumedTaxRate : false;
  const roicFormula = taxAssumed ? "NOPAT / Invested capital, where NOPAT applies an assumed 21% tax rate — the rate this period reports is unusable" : METRICS.roic?.formula;

  const average = (metric: string) => averageOver(annual, metric);
  /** A difference between two rates belongs in points, not percent of a percent. */
  const spread = (current: number | null, base: number | null) => current == null || base == null ? null : current - base;
  const growth = (metric: string, years: 3 | 5 | 10) => cagr(annual, metric, years);

  const dividendsPerShare = flow("dividendsPerShare");
  const paysDividend = dividendsPerShare != null && dividendsPerShare > 0;
  const noDividend = paysDividend ? undefined : "Pays no dividend";

  const groups: StatGroup[] = [
    {
      title: "Profile",
      note: basis?.sharesNote,
      stats: [
        stat("marketCapitalization", "Market Cap", marketCap, "currency", 0, noPrice ?? "The filing carries no share count"),
        stat("enterpriseValue", "EV", enterpriseValue, "currency", 0, noEnterpriseValue),
        stat("sharesOutstanding", "Shares Out", shares, "shares", 0, counted ? undefined : "The filing carries no share count"),
        stat("revenue", "Revenue", flow("revenue"), "currency", 1),
        stat("grossProfit", "Gross Profit", flow("grossProfit"), "currency", 1),
      ],
    },
    {
      title: "Margins (TTM)",
      note: financial ? FINANCIAL_NOTE : undefined,
      stats: [
        stat("grossMargin", "Gross", flow("grossMargin"), "percent", 1),
        stat("ebitdaMargin", "EBITDA", flow("ebitdaMargin"), "percent", 1),
        stat("operatingMargin", "Operating", flow("operatingMargin"), "percent", 1),
        stat("pretaxMargin", "Pre-Tax", flow("pretaxMargin"), "percent", 1),
        stat("netMargin", "Net", flow("netMargin"), "percent", 1),
        stat("freeCashFlowMargin", "FCF", cash(flow("freeCashFlowMargin")), "percent", 1, cashReason),
        stat("freeCashFlowAfterSbcMargin", "FCF after SBC", cash(flow("freeCashFlowAfterSbcMargin")), "percent", 1, cashReason),
      ],
    },
    {
      title: "Returns on Capital",
      note: financial
        ? "ROIC, ROE, ROCE and ROA are stated; the cash return is not, for the reason given under Margins."
        : "Cash RoC divides free cash flow by the same capital base as ROIC. ROIC's numerator applies a tax rate, and falls back to an assumed one when the reported rate is unusable; cash carries no such assumption.",
      stats: [
        // The headline pair, current against the cycle, and the gap between
        // them: a return well below its own five-year average is the first
        // thing to notice about a compounder, and an average alone hides it.
        stat("cashReturnOnCapital", "Cash RoC", cash(flow("cashReturnOnCapital")), "percent", 1, cashReason),
        stat("cashReturnOnCapital", "Cash RoC · 5Yr Avg", cash(average("cashReturnOnCapital").value), "percent", 1, cashReason ?? average("cashReturnOnCapital").reason),
        stat("cashReturnOnCapital", "Cash RoC · vs 5Yr", cash(spread(flow("cashReturnOnCapital"), average("cashReturnOnCapital").value)), "points", 1, cashReason ?? average("cashReturnOnCapital").reason),
        stat("roic", "ROIC", flow("roic"), "percent", 1, undefined, roicFormula),
        stat("roic", "ROIC · 5Yr Avg", average("roic").value, "percent", 1, average("roic").reason, roicFormula),
        stat("returnOnEquity", "ROE · 5Yr Avg", average("returnOnEquity").value, "percent", 1, average("returnOnEquity").reason),
        stat("returnOnCapitalEmployed", "ROCE · 5Yr Avg", average("returnOnCapitalEmployed").value, "percent", 1, average("returnOnCapitalEmployed").reason),
        stat("returnOnAssets", "ROA · 5Yr Avg", average("returnOnAssets").value, "percent", 1, average("returnOnAssets").reason),
        stat("returnOnTangibleAssets", "ROTA · 5Yr Avg", average("returnOnTangibleAssets").value, "percent", 1, "Reports no goodwill or acquired intangibles, so a tangible base cannot be identified"),
      ],
    },
    {
      title: "Valuation (TTM)",
      note: noPrice,
      stats: [
        stat("priceToEarnings", "P/E", over(marketCap, flow("netIncome")), "multiple", -1, noPrice ?? "Earnings are not positive"),
        stat("priceToBook", "P/B", over(marketCap, flow("totalEquity")), "multiple", -1, noPrice ?? "Equity is not positive"),
        stat("enterpriseToSales", "EV/Sales", over(enterpriseValue, flow("revenue")), "multiple", -1, noEnterpriseValue),
        stat("enterpriseToEbitda", "EV/EBITDA", over(enterpriseValue, flow("ebitda")), "multiple", -1, noEnterpriseValue ?? "EBITDA is not positive"),
        stat("priceToFreeCashFlow", "P/FCF", cash(over(marketCap, flow("freeCashFlow"))), "multiple", -1, cashReason ?? noPrice ?? "Free cash flow is not positive"),
        stat("enterpriseToGrossProfit", "EV/Gross Profit", over(enterpriseValue, flow("grossProfit")), "multiple", -1, noEnterpriseValue),
      ],
    },
    {
      title: "Financial Health",
      stats: [
        stat("cashAndEquivalents", "Cash", flow("cashAndEquivalents"), "currency", 1),
        stat("netDebt", "Net Debt", netDebt, "currency", -1, netDebtReason),
        // Booking is financed below zero, so the ratio has no base to stand on
        // and the row says that rather than "not reported".
        stat("debtToEquity", "Debt/Equity", flow("debtToEquity"), "ratio", -1, (flow("totalEquity") ?? 0) <= 0 && flow("totalEquity") != null ? "Equity is not positive" : undefined),
        stat("interestCoverage", "EBIT/Interest", flow("interestCoverage"), "ratio", 1, "Reports no interest expense"),
        stat("capitalIntensity", "Capex/Sales", cash(flow("capitalIntensity")), "percent", -1, cashReason),
      ],
    },
    {
      title: "Growth (CAGR)",
      stats: [
        stat("revenue", "Rev 3Yr", growth("revenue", 3).value, "percent", 1, growth("revenue", 3).reason),
        stat("revenue", "Rev 5Yr", growth("revenue", 5).value, "percent", 1, growth("revenue", 5).reason),
        stat("revenue", "Rev 10Yr", growth("revenue", 10).value, "percent", 1, growth("revenue", 10).reason),
        stat("netIncomePerShare", "Dil EPS 3Yr", growth("netIncomePerShare", 3).value, "percent", 1, growth("netIncomePerShare", 3).reason),
        stat("netIncomePerShare", "Dil EPS 5Yr", growth("netIncomePerShare", 5).value, "percent", 1, growth("netIncomePerShare", 5).reason),
        stat("netIncomePerShare", "Dil EPS 10Yr", growth("netIncomePerShare", 10).value, "percent", 1, growth("netIncomePerShare", 10).reason),
        stat("freeCashFlow", "FCF 5Yr", cash(growth("freeCashFlow", 5).value), "percent", 1, cashReason ?? growth("freeCashFlow", 5).reason),
        stat("freeCashFlowPerShare", "FCF/share 5Yr", cash(growth("freeCashFlowPerShare", 5).value), "percent", 1, cashReason ?? growth("freeCashFlowPerShare", 5).reason),
        // A rising share count dilutes the owner, so less is better here.
        stat("dilutedShares", "Shares 5Yr", growth("dilutedShares", 5).value, "percent", -1, growth("dilutedShares", 5).reason),
      ],
    },
    {
      title: "Dividends",
      stats: [
        // Dividends per share are filed in the statements' currency, so this is
        // a price the basis has already matched to that currency or nothing.
        stat("dividendYield", "Yield", paysDividend ? safeDivide(dividendsPerShare, close) : null, "percent", 1, noDividend ?? noPrice),
        stat("dividendPayout", "Payout", paysDividend ? flow("dividendPayout") : null, "percent", 0, noDividend),
        stat("dividendsPerShare", "DPS", dividendsPerShare, "perShare", 1, noDividend),
        stat("dividendsPerShare", "DPS Growth 3Yr", paysDividend ? growth("dividendsPerShare", 3).value : null, "percent", 1, noDividend ?? growth("dividendsPerShare", 3).reason),
        stat("dividendsPerShare", "DPS Growth 5Yr", paysDividend ? growth("dividendsPerShare", 5).value : null, "percent", 1, noDividend ?? growth("dividendsPerShare", 5).reason),
        stat("dividendsPerShare", "DPS Growth 10Yr", paysDividend ? growth("dividendsPerShare", 10).value : null, "percent", 1, noDividend ?? growth("dividendsPerShare", 10).reason),
      ],
    },
  ];

  return groups;
}

/** Every stat key, flattened, so a comparison can lay companies out in rows. */
export function statRows(groups: StatGroup[]): Array<{ group: string; label: string }> {
  return groups.flatMap((group) => group.stats.map((item) => ({ group: group.title, label: item.label })));
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function formatStat(value: number | null, format: StatFormat, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (format) {
    case "percent":
      // One decimal below ten percent, none above: 0.4% and 340% both read
      // cleanly, where a fixed precision makes one of them look wrong.
      return `${(value * 100).toFixed(Math.abs(value) < .1 ? 1 : Math.abs(value) < 10 ? 1 : 0)}%`;
    case "points": return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`;
    case "multiple": return `${value.toFixed(1)}×`;
    case "ratio": return value.toFixed(2);
    case "shares": return COMPACT.format(value);
    case "perShare": return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    case "currency": {
      const sign = value < 0 ? "-" : "";
      const symbol = currency === "USD" ? "$" : `${currency} `;
      return `${sign}${symbol}${COMPACT.format(Math.abs(value))}`;
    }
  }
}

/**
 * The companies holding the best value for one row.
 *
 * Returns a set rather than a single winner so an exact tie highlights both,
 * and returns nothing when the row has no better direction or only one company
 * has a value — being the only company to report something is not an achievement.
 */
export function bestIn(values: Array<{ ticker: string; value: number | null }>, polarity: 1 | -1 | 0): Set<string> {
  if (polarity === 0) return new Set();
  const usable = values.filter((item): item is { ticker: string; value: number } => item.value != null && Number.isFinite(item.value));
  if (usable.length < 2) return new Set();
  const best = usable.reduce((winner, item) => (polarity === 1 ? item.value > winner.value : item.value < winner.value) ? item : winner, usable[0]);
  return new Set(usable.filter((item) => item.value === best.value).map((item) => item.ticker));
}
