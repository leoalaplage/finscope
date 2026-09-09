/**
 * Whether the company can pay what it owes, and for how long.
 *
 * A different question from the Quality Score beside it. Quality asks how good
 * a business this is; this asks whether it survives a bad year — and a good
 * business with a bad balance sheet is a real thing, as is the reverse.
 *
 * Three properties separate this from a panel of ratios:
 *
 * It answers questions, not formulas. "Net debt / EBITDA = 3.2" is a number a
 * reader has to know the conventions to judge. "The borrowings are three years
 * of operating profit" is a sentence, and the band it falls in is stated rather
 * than assumed.
 *
 * The verdict is the worst answer, never an average. Solvency is a chain: a
 * company with fortress liquidity and no interest cover is not "average". The
 * one that breaks is the one that matters, and averaging is how a panel of
 * ratios hides it.
 *
 * Book equity is reported and never judged. Booking's equity is minus eleven
 * billion because it has bought back more stock than it has ever retained; its
 * borrowings are a third of one year's cash flow. A debt-to-equity ratio there
 * is not a severe reading, it is a meaningless one — the denominator is an
 * accounting residue, not a resource. So negative equity is stated, its cause
 * named from the retained earnings behind it, and the verdict is struck on what
 * actually services debt: profit and cash.
 *
 * The same care is why the current ratio is not the liquidity test. Walmart's
 * is 0.77 and always has been: it sells the inventory before it pays for it.
 * The question here is whether cash on hand plus a year's free cash flow meets
 * the debt falling due plus the dividend — which a retailer passes and a
 * company funding its capital expenditure with borrowings fails.
 */

import { balanceSheetIsTheBusiness } from "../business-type";
import type { BusinessType } from "../types";

/** Worst to best. The order is the ladder; nothing else encodes it. */
export const HEALTH_STATES = ["strained", "stretched", "adequate", "sound", "fortress"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/**
 * Every band, in the order they are tested, worst last.
 *
 * Absolute, like the score's anchors, and printed on the page: a reader can
 * check the verdict against the reading without knowing this file exists. They
 * are conventions of credit analysis, not thresholds fitted to a watchlist —
 * fitting them to the companies on hand is how a scale stops measuring.
 */
export interface Band { at: number; state: HealthState }

/** Higher is better: the first band the reading reaches wins. */
const better = (bands: Band[], value: number): HealthState =>
  bands.find((band) => value >= band.at)?.state ?? "strained";

/**
 * What is owed, measured against the two things that repay it.
 *
 * Both are asked and the worse answer is kept. EBITDA flatters a company whose
 * profit never becomes cash, and free cash flow understates one in the middle
 * of building something; a reader is owed the harsher of the two, with the
 * other on the page beside it.
 */
const BURDEN: Band[] = [
  { at: 0.5, state: "fortress" },
  { at: 1.5, state: "sound" },
  { at: 3, state: "adequate" },
  { at: 4.5, state: "stretched" },
];
/** Fewer years is better here, so the ladder is read from the other end. */
const burdenState = (years: number): HealthState =>
  BURDEN.find((band) => years <= band.at)?.state ?? "strained";

/** Operating profit against the interest bill. Higher is better. */
const COVER: Band[] = [
  { at: 25, state: "fortress" },
  { at: 8, state: "sound" },
  { at: 4, state: "adequate" },
  { at: 2, state: "stretched" },
];

/** Cash and a year's free cash flow against what falls due. Higher is better. */
const NEAR_TERM: Band[] = [
  { at: 4, state: "fortress" },
  { at: 2, state: "sound" },
  { at: 1, state: "adequate" },
  { at: 0.6, state: "stretched" },
];

/**
 * Years of cash left at the current burn. Higher is better, and never a
 * fortress: a company spending more than it earns is not impregnable, however
 * long it can keep doing it.
 */
const RUNWAY: Band[] = [
  { at: 8, state: "sound" },
  { at: 4, state: "adequate" },
  { at: 2, state: "stretched" },
];

export interface HealthQuestion {
  key: "burden" | "cover" | "nearTerm" | "runway";
  /** Two words, for the column head. */
  label: string;
  /** The same thing as a question, which is how a reader actually asks it. */
  question: string;
  state: HealthState | null;
  /** The reading itself, already in the unit the question is asked in. */
  value: number | null;
  unit: "years" | "times";
  /**
   * The reading in words, because some answers are not numbers.
   *
   * A company with no borrowings has no ratio of them: "0.0 years" is an
   * arithmetic artefact of dividing nothing, and "None" is the fact.
   */
  reading: string;
  /** What the reading was struck on, or why there is none. */
  basis: string;
  /** The corroborating reading, shown but not judged. */
  aside: string | null;
}

/** "0.3 years", "12 years" — one decimal until the figure stops needing it. */
const years = (value: number) => `${value.toFixed(value >= 10 ? 0 : 1)} ${value >= 1.95 || value < 1 ? "years" : "year"}`;
const multiple = (value: number) => `${value.toFixed(value >= 100 ? 0 : 1)}\u00d7`;

export interface HealthNote { key: string; text: string }

export interface HealthReading {
  state: HealthState | null;
  questions: HealthQuestion[];
  answered: number;
  notes: HealthNote[];
  /** Why there is no verdict, when there is none. */
  reason: string | null;
  periodLabel: string;
  periodEnd: string;
  currency: string;
}

export interface HealthPeriod {
  label: string;
  end: string;
  currency: string;
  values: Record<string, number | null>;
}

const at = (period: HealthPeriod, key: string) => {
  const value = period.values[key];
  return value == null || !Number.isFinite(value) ? null : value;
};

/** A sum that is null unless at least one side is filed. Absence is not zero. */
function add(...parts: Array<number | null>): number | null {
  const filed = parts.filter((part): part is number => part != null);
  return filed.length ? filed.reduce((sum, part) => sum + part, 0) : null;
}

/** Under a hundredth of the company, which is not a borrowing, it is a rounding. */
const IMMATERIAL = 0.01;

/**
 * Whether this company owes nothing that matters, as opposed to nothing we found.
 *
 * The difference cannot be assumed either way. A missing tag is this site's
 * recurring failure — NVIDIA files no capital expenditure before 2022, and
 * reading that absence as a zero would have invented six years of free cash
 * flow. So an absence is only read as "none" on evidence: three consecutive
 * balance sheets that we demonstrably parsed, none of them carrying a borrowing
 * worth a hundredth of the assets, and no interest bill worth a hundredth of
 * the operating profit.
 *
 * Materiality rather than presence, because presence is the wrong test. Qualys
 * tags a hundred and seventy-eight thousand dollars of debt against a billion
 * of assets and twenty-six thousand of interest; Palantir repaid a real
 * facility in 2021 and has filed nothing since. Both are debt-free companies,
 * and a test that looked only for the absence of a tag called neither of them
 * one.
 */
export function borrowingsAbsent(periods: HealthPeriod[]): boolean {
  const parsed = periods.filter((period) => at(period, "totalAssets") != null);
  const recent = parsed.slice(-3);
  if (recent.length < 3) return false;
  const assets = at(recent[recent.length - 1], "totalAssets");
  const profit = at(recent[recent.length - 1], "operatingIncome");
  if (assets == null || assets <= 0) return false;
  return recent.every((period) => {
    const debt = at(period, "totalDebt");
    const interest = at(period, "interestExpense") ?? at(period, "interestPaid");
    if (debt != null && debt > assets * IMMATERIAL) return false;
    // With no operating profit to measure it against, any interest at all counts.
    if (interest != null && interest > (profit != null && profit > 0 ? profit * IMMATERIAL : 0)) return false;
    return true;
  });
}

/**
 * What the company owes after everything it could pay with tomorrow.
 *
 * Not the site's `netDebt`, which subtracts only cash and equivalents: that is
 * the right basis for an enterprise value, where a marketable security is an
 * asset the buyer acquires rather than a payment they make. It is the wrong
 * basis for a solvency question. Alphabet holds fifty-six billion in cash and a
 * hundred and eighty-seven billion in short-term investments against a hundred
 * billion of borrowings, and reading it as forty-four billion of net debt
 * describes a company that does not exist.
 */
function netBorrowings(period: HealthPeriod): number | null {
  const debt = at(period, "totalDebt");
  if (debt == null) return null;
  const liquid = add(at(period, "cashAndEquivalents"), at(period, "shortTermInvestments")) ?? 0;
  return debt - liquid;
}

/** Debt the company has to find the money for within the year. */
function dueWithinTheYear(period: HealthPeriod): number | null {
  return add(at(period, "longTermDebtCurrent"), at(period, "shortTermBorrowings"));
}

function burden(period: HealthPeriod, debtFree: boolean): HealthQuestion {
  const label = "Borrowings";
  const question = "How heavy are the borrowings?";
  if (debtFree) {
    return { key: "burden", label, question, state: "fortress", value: null, unit: "years", reading: "None",
      basis: "No borrowings worth a hundredth of the assets on the last three balance sheets, and no interest bill to match.",
      aside: null };
  }
  const netDebt = netBorrowings(period);
  const ebitda = at(period, "ebitda");
  const freeCashFlow = at(period, "freeCashFlow");
  if (netDebt == null) {
    return { key: "burden", label, question, state: null, value: null, unit: "years", reading: "\u2014",
      basis: "No borrowings are tagged for this period, and their absence is not a zero.", aside: null };
  }
  if (netDebt <= 0) {
    return { key: "burden", label, question, state: "fortress", value: null, unit: "years", reading: "Net cash",
      basis: "Cash and short-term investments exceed every borrowing on the balance sheet.", aside: null };
  }
  // Against profit, and against cash. The worse of the two is the answer.
  const onProfit = ebitda != null && ebitda > 0 ? netDebt / ebitda : null;
  const onCash = freeCashFlow != null && freeCashFlow > 0 ? netDebt / freeCashFlow : null;
  const readings = [onProfit, onCash].filter((value): value is number => value != null);
  if (!readings.length) {
    return { key: "burden", label, question, state: "strained", value: null, unit: "years", reading: "Nothing repays it",
      basis: "There are borrowings, and neither operating profit nor free cash flow is positive to repay them from.",
      aside: null };
  }
  const worst = Math.max(...readings);
  const aside = onProfit != null && onCash != null
    ? `${onProfit.toFixed(1)} years of EBITDA · ${onCash.toFixed(1)} years of free cash flow`
    : onProfit != null ? "Struck on EBITDA; free cash flow is not positive"
    : "Struck on free cash flow; EBITDA is not positive or not filed";
  return { key: "burden", label, question, state: burdenState(worst), value: worst, unit: "years", reading: years(worst),
    basis: "Borrowings after cash and short-term investments, over what repays them — taking the harsher of operating profit and free cash flow.",
    aside };
}

function cover(period: HealthPeriod, debtFree: boolean): HealthQuestion {
  const label = "Interest cover";
  const question = "Can profit carry the interest?";
  if (debtFree) {
    return { key: "cover", label, question, state: "fortress", value: null, unit: "times", reading: "No interest",
      basis: "There is no interest bill to carry.", aside: null };
  }
  const interest = at(period, "interestExpense") ?? at(period, "interestPaid");
  const operating = at(period, "operatingIncome");
  const freeCashFlow = at(period, "freeCashFlow");
  if (interest == null || interest <= 0) {
    return { key: "cover", label, question, state: null, value: null, unit: "times", reading: "\u2014",
      basis: "The filer tags no interest expense for this period.", aside: null };
  }
  if (operating == null) {
    return { key: "cover", label, question, state: null, value: null, unit: "times", reading: "\u2014",
      basis: "The filer publishes no operating income subtotal for this period.", aside: null };
  }
  const times = operating / interest;
  // A negative multiple is not a reading anyone can use. The fact is that there
  // is no operating profit to cover anything with, and that is what it says.
  // Free cash flow corroborates rather than judges: a company spending heavily
  // on capital projects has a thin cash cover and an intact profit cover, and
  // the two say different true things.
  const aside = freeCashFlow == null ? null : `Free cash flow covers it ${(freeCashFlow / interest).toFixed(1)}×`;
  return { key: "cover", label, question, state: times < 2 ? "strained" : better(COVER, times), value: times, unit: "times",
    reading: operating <= 0 ? "Operating loss" : multiple(times),
    basis: "Operating profit over the interest bill.", aside };
}

function nearTerm(period: HealthPeriod): HealthQuestion {
  const label = "The year ahead";
  const question = "Does the next year pay for itself?";
  const cash = add(at(period, "cashAndEquivalents"), at(period, "shortTermInvestments"));
  const freeCashFlow = at(period, "freeCashFlow");
  const due = dueWithinTheYear(period);
  const dividends = at(period, "dividendsPaid");
  const obligations = add(due, dividends);
  if (cash == null || freeCashFlow == null) {
    return { key: "nearTerm", label, question, state: null, value: null, unit: "times", reading: "\u2014",
      basis: cash == null
        ? "No cash balance is filed for this period."
        : "No free cash flow is filed for this period, and a year's generation is half the question.",
      aside: null };
  }
  if (obligations == null || obligations <= 0) {
    return { key: "nearTerm", label, question, state: null, value: null, unit: "times", reading: "Nothing falls due",
      basis: "Nothing these filings tag falls due within the year: no current borrowings and no dividend.",
      aside: null };
  }
  const times = (cash + freeCashFlow) / obligations;
  return { key: "nearTerm", label, question, state: better(NEAR_TERM, times), value: times, unit: "times", reading: multiple(times),
    basis: "Cash and a year's free cash flow over the borrowings falling due plus the dividend.",
    aside: "Not the current ratio: a retailer sells its inventory before it pays for it, and reads badly on one all its life." };
}

/**
 * How long the cash lasts, asked only of a company that is spending it.
 *
 * A question that does not exist for most filers, and the whole reading for the
 * ones it does. Amazon's free cash flow is minus twelve billion against a
 * hundred and twenty-three billion of cash — ten years of it — and Oracle's is
 * minus twenty-four billion against thirty-one, which is sixteen months.
 */
function runway(period: HealthPeriod): HealthQuestion | null {
  const freeCashFlow = at(period, "freeCashFlow");
  if (freeCashFlow == null || freeCashFlow >= 0) return null;
  const cash = add(at(period, "cashAndEquivalents"), at(period, "shortTermInvestments"));
  const label = "Cash runway";
  const question = "How long does the cash last?";
  if (cash == null) {
    return { key: "runway", label, question, state: null, value: null, unit: "years", reading: "\u2014",
      basis: "No cash balance is filed for this period.", aside: null };
  }
  const span = cash / Math.abs(freeCashFlow);
  return { key: "runway", label, question, state: better(RUNWAY, span), value: span, unit: "years", reading: years(span),
    basis: "Cash and short-term investments over the rate it is being spent.",
    aside: "Borrowing more is always available to a solvent company; this is the question asked without it." };
}

/**
 * The balance-sheet facts that are worth stating and not worth scoring.
 *
 * Each of these has been a false alarm in some panel somewhere. They are here
 * as sentences, with what caused them, so that a reader meets the fact rather
 * than a ratio built on it.
 */
function notesFor(period: HealthPeriod): HealthNote[] {
  const notes: HealthNote[] = [];
  // The accounts' own currency, never converted and never assumed: a figure
  // with no symbol on it reads as dollars to most people, and for a filer
  // keeping its books in euros that is simply a wrong number.
  const symbol = { USD: "$", EUR: "\u20ac", GBP: "\u00a3", JPY: "\u00a5", CHF: "CHF\u00a0", DKK: "DKK\u00a0" }[period.currency] ?? `${period.currency}\u00a0`;
  const money = (value: number) => {
    const size = Math.abs(value);
    const unit = size >= 1e9 ? [1e9, "bn"] as const : [1e6, "m"] as const;
    return `${value < 0 ? "\u2212" : ""}${symbol}${(size / unit[0]).toFixed(size / unit[0] >= 10 ? 0 : 1)}${unit[1]}`;
  };
  const equity = at(period, "totalEquity");
  const retained = at(period, "retainedEarnings");
  if (equity != null && equity < 0) {
    notes.push({
      key: "negativeEquity",
      text: retained != null && retained > 0
        ? `Book equity is ${money(equity)} because buybacks have exceeded ${money(retained)} of retained earnings, not because the company has lost money. Debt over equity and equity over assets are withheld: the denominator is an accounting residue, and what services the borrowings is on the lines above.`
        : retained != null
          ? `Book equity is ${money(equity)} against ${money(retained)} of retained earnings — an accumulated deficit, not a buyback. Debt over equity is withheld as meaningless; the questions above are struck on profit and cash.`
          : `Book equity is ${money(equity)}. Debt over equity and equity over assets are withheld rather than printed as negative numbers; the verdict rests on what services the borrowings.`,
    });
  }
  const netDebt = netBorrowings(period);
  if (netDebt != null && netDebt < 0) {
    notes.push({ key: "netCash", text: `Net cash of ${money(-netDebt)}: cash and short-term investments exceed every borrowing.` });
  }
  const assets = at(period, "totalAssets");
  const acquired = add(at(period, "goodwill"), at(period, "intangibleAssets"));
  if (assets != null && assets > 0 && acquired != null && acquired / assets > 0.4) {
    notes.push({
      key: "acquired",
      text: `${(100 * acquired / assets).toFixed(0)}% of the assets are goodwill and acquired intangibles — the price paid for past deals rather than something the company operates. Not a solvency question, and not scored above; it is what a write-down would fall on.`,
    });
  }
  return notes;
}

/**
 * The whole reading.
 *
 * Withheld outright where the balance sheet is the business: a bank's
 * borrowings are its raw material and its operating cash flow is the movement
 * of its loans, so every question above would be asked of a boundary it does
 * not have. That is the same predicate the rest of the site withholds on.
 */
export function companyHealth(
  current: HealthPeriod | null,
  history: HealthPeriod[],
  businessType: BusinessType | string | null | undefined,
): HealthReading | null {
  if (balanceSheetIsTheBusiness(businessType as BusinessType)) return null;
  if (!current) return null;

  const debtFree = borrowingsAbsent(history);
  const questions = [burden(current, debtFree), cover(current, debtFree), nearTerm(current), runway(current)]
    .filter((question): question is HealthQuestion => question != null);

  const answered = questions.filter((question) => question.state != null);
  // Two questions is the fewest that can be a verdict: one reading is a ratio,
  // and a ratio is what this exists not to be.
  const state = answered.length >= 2
    ? HEALTH_STATES[Math.min(...answered.map((question) => HEALTH_STATES.indexOf(question.state!)))]
    : null;

  return {
    state,
    questions,
    answered: answered.length,
    notes: notesFor(current),
    reason: state ? null : `${answered.length} of ${questions.length} questions could be answered from these filings.`,
    periodLabel: current.label,
    periodEnd: current.end,
    currency: current.currency,
  };
}

/** What each band means, for the legend the page prints under the verdict. */
export const HEALTH_MEANINGS: Record<HealthState, string> = {
  fortress: "Net cash or close to it, and every obligation covered many times over.",
  sound: "Borrowings are small against what repays them and comfortably carried.",
  adequate: "Nothing is broken; one of the questions is no longer generous.",
  stretched: "A bad year forces a decision — a cut, a sale, or a refinancing on someone else's terms.",
  strained: "It is not paying for what it owes out of what it earns.",
};
