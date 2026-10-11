import { balanceSheetIsTheBusiness, cashFlowIsTheBalanceSheet } from "../business-type";
import { GROWTH_YIELD_YEARS, annualRate, growthYield, growthYieldScore, growthYieldVerdict, type DatedRate, type GrowthYield } from "./growth-yield";
import { HEALTH_STATES, type HealthState } from "./health";
import type { IoCompanyView, IoPeriod } from "./view";

/**
 * The four answers, read the way a lender is read.
 *
 * A bank, a card issuer or a broker has no free cash flow worth the name — its
 * operating cash flow is the movement of its own loans — and its borrowings are
 * its raw material, so every reading this site makes of an industrial company
 * (free cash flow, net debt, cover, runway) is withheld from it, and its "at a
 * glance" line read four dashes. Analysts do not read a lender on those; they
 * read it on three things, and so does this:
 *
 * - Quality: does it earn well on its equity, and steadily? Five years of
 *   return on equity, and whether any of them was a loss.
 * - Health: how much of its balance sheet is its own money, and does it earn
 *   on its assets? Tangible equity against tangible assets, and the return on
 *   assets over the latest year.
 * - Price against growth: the same rate as everywhere else on the site —
 *   a yield plus five years of revenue-per-share growth — with the earnings
 *   yield standing in for the free-cash-flow yield a lender is not given.
 *
 * Growth is read from earnings per share (lib/io/verdict.ts).
 *
 * Every band is printed with the reading, as the industrial ones are, and they
 * are the conventions of bank analysis rather than thresholds fitted to the
 * companies on hand: a cost of equity of about ten per cent, a tangible equity
 * ratio of eight for a well-capitalised lender, a return on assets of one per
 * cent for a good one.
 */

/** Whether a company is read as a lender: its cash flow is its balance sheet. */
export const readAsLender = (view: IoCompanyView) => cashFlowIsTheBalanceSheet(view.company.businessType);
/** Whether its health is read as a lender's: an insurer's balance sheet is also its business. */
export const healthAsLender = (view: IoCompanyView) => balanceSheetIsTheBusiness(view.company.businessType as never);

/**
 * Whether an answer of the "at a glance" line opens the lender's reading.
 * The Quality Score keeps the first answer wherever it does grade the company.
 */
export function readsAsLender(view: IoCompanyView, key: "quality" | "health" | "valuation" | "growth", graded: boolean): boolean {
  if (key === "health") return healthAsLender(view);
  if (key === "quality") return readAsLender(view) && !graded;
  return readAsLender(view);
}

const value = (period: IoPeriod | null | undefined, key: string) => {
  const figure = period?.values[key];
  return figure == null || !Number.isFinite(figure) ? null : figure;
};

/* --- Quality ------------------------------------------------------------ */

/** Average return on equity over five years at or above this, with no loss year, is a quality lender. */
export const QUALITY_ROE = 0.12;

export interface LenderQuality {
  answer: "Yes" | "No" | null;
  averageRoe: number | null;
  years: Array<{ label: string; roe: number | null; netIncome: number | null }>;
  lossYears: number;
  note: string;
}

export function lenderQuality(view: IoCompanyView): LenderQuality {
  const years = view.annual.slice(-5).map((period) => {
    const netIncome = value(period, "netIncome");
    const equity = value(period, "totalEquity");
    // The return as the engine states it, or net income on positive equity.
    const roe = value(period, "returnOnEquity") ?? (netIncome != null && equity != null && equity > 0 ? netIncome / equity : null);
    return { label: period.label, roe, netIncome };
  });
  const known = years.filter((year) => year.roe != null);
  const lossYears = years.filter((year) => year.netIncome != null && year.netIncome < 0).length;
  if (known.length < 3) return { answer: null, averageRoe: null, years, lossYears, note: "Fewer than three years of return on equity" };
  const averageRoe = known.reduce((sum, year) => sum + year.roe!, 0) / known.length;
  const answer = averageRoe >= QUALITY_ROE && lossYears === 0 ? "Yes" : "No";
  return {
    answer, averageRoe, years, lossYears,
    note: `Return on equity ${(averageRoe * 100).toFixed(1)}% a year over ${known.length} years${lossYears ? ` · ${lossYears} loss year${lossYears > 1 ? "s" : ""}` : " · no loss year"}`,
  };
}

/* --- Health ------------------------------------------------------------- */

export interface LenderQuestion {
  id: "capital" | "earnings";
  question: string;
  reading: number | null;
  answer: string;
  state: HealthState | null;
  bands: Array<{ at: number; state: HealthState }>;
}

/** Tangible equity as a share of tangible assets: how much of the balance sheet is the lender's own money. */
export const CAPITAL_BANDS: Array<{ at: number; state: HealthState }> = [
  { at: 0.12, state: "fortress" }, { at: 0.08, state: "sound" }, { at: 0.06, state: "adequate" }, { at: 0.04, state: "stretched" },
];
/** Return on assets over the latest year. */
export const EARNINGS_BANDS: Array<{ at: number; state: HealthState }> = [
  { at: 0.015, state: "fortress" }, { at: 0.01, state: "sound" }, { at: 0.005, state: "adequate" }, { at: 0, state: "stretched" },
];

const band = (reading: number | null, bands: Array<{ at: number; state: HealthState }>): HealthState | null =>
  reading == null ? null : bands.find((entry) => reading >= entry.at)?.state ?? "strained";

export interface LenderHealth { state: HealthState | null; questions: LenderQuestion[]; periodLabel: string | null; note: string }

export function lenderHealth(view: IoCompanyView): LenderHealth {
  const current = view.ttm ?? view.annual.at(-1) ?? null;
  const equity = value(current, "totalEquity");
  const assets = value(current, "totalAssets");
  const intangible = (value(current, "goodwill") ?? 0) + (value(current, "intangibleAssets") ?? 0);
  const tangibleEquity = equity == null ? null : equity - intangible;
  const tangibleAssets = assets == null ? null : assets - intangible;
  const capital = tangibleEquity != null && tangibleAssets != null && tangibleAssets > 0 ? tangibleEquity / tangibleAssets : null;
  const netIncome = value(current, "netIncome");
  const roa = value(current, "returnOnAssets") ?? (netIncome != null && assets != null && assets > 0 ? netIncome / assets : null);
  const percent = (reading: number | null, places = 1) => (reading == null ? "—" : `${(reading * 100).toFixed(places)}%`);
  const questions: LenderQuestion[] = [
    {
      id: "capital", question: "How much of the balance sheet is its own money?", reading: capital, bands: CAPITAL_BANDS,
      answer: capital == null ? "Equity or total assets not filed for this period." : `Tangible equity is ${percent(capital)} of tangible assets${intangible ? " (goodwill and intangibles taken out of both)" : ""}.`,
      state: band(capital, CAPITAL_BANDS),
    },
    {
      id: "earnings", question: "Does it earn on what it holds?", reading: roa, bands: EARNINGS_BANDS,
      answer: roa == null ? "Net income or total assets not filed for this period." : `Net income is ${percent(roa, 2)} of total assets over the year.`,
      state: band(roa, EARNINGS_BANDS),
    },
  ];
  const answered = questions.filter((question) => question.state != null);
  // Both, or no verdict: one ratio is a ratio, not an answer.
  const state = answered.length === questions.length
    ? HEALTH_STATES[Math.min(...answered.map((question) => HEALTH_STATES.indexOf(question.state!)))]
    : null;
  return {
    state, questions, periodLabel: current?.label ?? null,
    note: state ? `${current!.label} · capital ${percent(capital)} · ROA ${percent(roa, 2)}` : `${answered.length} of 2 questions could be answered from these filings`,
  };
}

/* --- Price against growth ---------------------------------------------- */

export interface LenderValuation {
  reading: GrowthYield;
  score: number | null;
  verdict: string | null;
  rate: DatedRate;
  marketCap: number | null;
  earnings: IoPeriod | null;
  note: string;
}

/**
 * The site's growth yield, on earnings: the earnings yield at today's price
 * plus five years of revenue-per-share growth, scored on the same fixed scale.
 * A loss leaves the yield negative and the mark low, which is what it is.
 */
export function lenderValuation(view: IoCompanyView, quote: { price: number | null; currency?: string | null } | null): LenderValuation {
  const basis = view.basis;
  const price = quote?.price ?? null;
  const sameCurrency = !quote?.currency || !basis || quote.currency === basis.currency;
  const marketCap = basis && sameCurrency && price != null && Number.isFinite(price) && price > 0 ? price * basis.shares : null;
  const series = [...view.annual, ...view.trailing].sort((left, right) => left.end.localeCompare(right.end));
  const earnings = [...series].reverse().find((period) => value(period, "netIncome") != null) ?? null;
  const earningsYield = marketCap && earnings ? value(earnings, "netIncome")! / marketCap : null;
  const rate = annualRate(view.annual, "revenuePerShare", GROWTH_YIELD_YEARS);
  const reading = growthYield(earningsYield, rate.value);
  const score = growthYieldScore(reading.value);
  const note = score == null
    ? marketCap == null ? "No price against the share count" : "Missing earnings or five years of revenue per share"
    : `Earnings yield ${(earningsYield! * 100).toFixed(1)}% + revenue / share ${((reading.growth ?? 0) * 100).toFixed(1)}%/yr`;
  return { reading: { ...reading }, score, verdict: growthYieldVerdict(score), rate, marketCap, earnings, note };
}
