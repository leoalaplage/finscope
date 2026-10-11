/**
 * PORT: what a book of holdings does, as a risk desk reads it.
 *
 * Every figure here is arithmetic on closing prices — the shares held today,
 * priced back through the window — so it describes the book as it stands, not
 * a record of trades. Returns are simple period returns on split-adjusted
 * closes; dividends are not in them, and the screen says so.
 *
 * Pure: the screen fetches and draws, this computes.
 */

export interface Point { date: string; value: number }

/** Trading days a year, and weeks, for annualising. */
export const DAILY = 252;
export const WEEKLY = 52;
/**
 * The risk-free rate a Sharpe ratio is struck against: a three-month Treasury
 * bill was about four per cent through 2025–26. Stated beside the ratio.
 */
export const RISK_FREE = 0.04;

/** Each date's return on the one before it. */
export function returnsOf(series: Point[]): Point[] {
  const out: Point[] = [];
  for (let index = 1; index < series.length; index++) {
    const before = series[index - 1].value;
    const now = series[index].value;
    if (before > 0 && Number.isFinite(now)) out.push({ date: series[index].date, value: now / before - 1 });
  }
  return out;
}

/** Two return series on the dates both have. */
export function aligned(left: Point[], right: Point[]): [number[], number[]] {
  const other = new Map(right.map((point) => [point.date, point.value]));
  const a: number[] = []; const b: number[] = [];
  for (const point of left) {
    const match = other.get(point.date);
    if (match != null) { a.push(point.value); b.push(match); }
  }
  return [a, b];
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function covariance(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null;
  const ma = mean(a); const mb = mean(b);
  let sum = 0;
  for (let index = 0; index < a.length; index++) sum += (a[index] - ma) * (b[index] - mb);
  return sum / (a.length - 1);
}

export function volatility(returns: number[], perYear: number): number | null {
  const variance = covariance(returns, returns);
  return variance == null ? null : Math.sqrt(variance * perYear);
}

export function beta(asset: number[], market: number[]): number | null {
  const cov = covariance(asset, market);
  const variance = covariance(market, market);
  return cov == null || !variance ? null : cov / variance;
}

export function correlation(a: number[], b: number[]): number | null {
  const cov = covariance(a, b);
  const va = covariance(a, a); const vb = covariance(b, b);
  return cov == null || !va || !vb ? null : cov / Math.sqrt(va * vb);
}

/** Annualised return over the excess of the risk-free rate, per unit of volatility. */
export function sharpe(returns: number[], perYear: number, riskFree = RISK_FREE): number | null {
  if (returns.length < 3) return null;
  const vol = volatility(returns, perYear);
  if (!vol) return null;
  const annual = (1 + mean(returns)) ** perYear - 1;
  return (annual - riskFree) / vol;
}

/** The same, with only the falls in the denominator. */
export function sortino(returns: number[], perYear: number, riskFree = RISK_FREE): number | null {
  if (returns.length < 3) return null;
  const threshold = (1 + riskFree) ** (1 / perYear) - 1;
  const downside = Math.sqrt(returns.reduce((sum, value) => sum + Math.min(0, value - threshold) ** 2, 0) / returns.length * perYear);
  if (!downside) return null;
  return ((1 + mean(returns)) ** perYear - 1 - riskFree) / downside;
}

/** How far below its running peak the book stood at every date. */
export function underwater(series: Point[]): Point[] {
  let peak = -Infinity;
  return series.map((point) => {
    peak = Math.max(peak, point.value);
    return { date: point.date, value: peak > 0 ? point.value / peak - 1 : 0 };
  });
}

export function maxDrawdown(series: Point[]): { depth: number; peak: string | null; trough: string | null; recovered: string | null } {
  let peak = series[0]; let worst = 0; let at: { peak: string; trough: string } | null = null;
  for (const point of series) {
    if (point.value > peak.value) peak = point;
    const fall = peak.value > 0 ? point.value / peak.value - 1 : 0;
    if (fall < worst) { worst = fall; at = { peak: peak.date, trough: point.date }; }
  }
  if (!at) return { depth: 0, peak: null, trough: null, recovered: null };
  const peakValue = series.find((point) => point.date === at!.peak)!.value;
  const recovered = series.find((point) => point.date > at!.trough && point.value >= peakValue)?.date ?? null;
  return { depth: worst, peak: at.peak, trough: at.trough, recovered };
}

/** Historical value at risk: the loss a period's return exceeded only `level` of the time. */
export function valueAtRisk(returns: number[], level = 0.05): number | null {
  if (returns.length < 20) return null;
  const sorted = [...returns].sort((left, right) => left - right);
  return sorted[Math.floor(level * (sorted.length - 1))];
}

/** Calendar-month returns from a series of closes: the last close of each month on the one before. */
export function monthlyReturns(series: Point[]): Array<{ year: number; month: number; value: number }> {
  const lastOfMonth = new Map<string, Point>();
  for (const point of series) lastOfMonth.set(point.date.slice(0, 7), point);
  const months = [...lastOfMonth.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  const out: Array<{ year: number; month: number; value: number }> = [];
  for (let index = 1; index < months.length; index++) {
    const before = months[index - 1][1].value; const now = months[index][1].value;
    if (before > 0) out.push({ year: Number(months[index][0].slice(0, 4)), month: Number(months[index][0].slice(5, 7)), value: now / before - 1 });
  }
  return out;
}

/**
 * Each holding's share of the book's variance.
 *
 * Its weight times its covariance with the book, over the book's variance:
 * the shares add up to one, and a holding whose share is well above its
 * weight is where the risk actually sits.
 */
export function riskContributions(weights: number[], returns: number[][]): number[] | null {
  const count = weights.length;
  if (!count || returns.some((series) => series.length !== returns[0].length) || returns[0].length < 3) return null;
  const matrix = returns.map((left) => returns.map((right) => covariance(left, right) ?? 0));
  const marginal = matrix.map((row) => row.reduce((sum, value, index) => sum + value * weights[index], 0));
  const variance = weights.reduce((sum, weight, index) => sum + weight * marginal[index], 0);
  if (!(variance > 0)) return null;
  return weights.map((weight, index) => (weight * marginal[index]) / variance);
}

/** Returns of several series on the dates all of them share, in order. */
export function commonReturns(series: Point[][]): { dates: string[]; returns: number[][] } {
  const maps = series.map((each) => new Map(returnsOf(each).map((point) => [point.date, point.value])));
  if (!maps.length) return { dates: [], returns: [] };
  const dates = [...maps[0].keys()].filter((date) => maps.every((map) => map.has(date))).sort();
  return { dates, returns: maps.map((map) => dates.map((date) => map.get(date)!)) };
}

/** The close on or before a date. */
export function closeOn(series: Point[], date: string): number | null {
  let found: number | null = null;
  for (const point of series) { if (point.date > date) break; found = point.value; }
  return found;
}

/**
 * What each holding added to the book over a window, in money and as a share
 * of the book's starting value: its shares times the change in its price.
 * The parts add up to the book's own change.
 */
export function contributions(
  positions: Array<{ ticker: string; shares: number }>,
  histories: Record<string, Point[] | undefined>,
  from: string,
): Array<{ ticker: string; money: number; share: number; ret: number }> {
  const rows = positions.flatMap((position) => {
    const series = histories[position.ticker];
    if (!series?.length) return [];
    const start = closeOn(series, from) ?? series[0].value;
    const end = series[series.length - 1].value;
    return start > 0 ? [{ ticker: position.ticker, startValue: start * position.shares, money: (end - start) * position.shares, ret: end / start - 1 }] : [];
  });
  const base = rows.reduce((sum, row) => sum + row.startValue, 0);
  return rows.map((row) => ({ ticker: row.ticker, money: row.money, share: base > 0 ? row.money / base : 0, ret: row.ret }));
}

/** Trades that bring each holding to its target weight at today's prices. */
export function rebalance(
  rows: Array<{ ticker: string; shares: number; price: number | null; target: number }>,
): Array<{ ticker: string; value: number; targetValue: number; trade: number; tradeShares: number | null }> {
  const total = rows.reduce((sum, row) => sum + (row.price ?? 0) * row.shares, 0);
  const targets = rows.reduce((sum, row) => sum + Math.max(0, row.target), 0);
  return rows.map((row) => {
    const value = (row.price ?? 0) * row.shares;
    const targetValue = targets > 0 ? total * Math.max(0, row.target) / targets : value;
    const trade = targetValue - value;
    return { ticker: row.ticker, value, targetValue, trade, tradeShares: row.price ? trade / row.price : null };
  });
}

/** Market scenarios, applied through each holding's beta. */
export const SCENARIOS = [
  { id: "down10", label: "S&P 500 −10%", move: -0.10 },
  { id: "down20", label: "S&P 500 −20%", move: -0.20 },
  { id: "covid", label: "Feb–Mar 2020 (−34%)", move: -0.339 },
  { id: "gfc", label: "2008 crisis (−57%)", move: -0.568 },
  { id: "up10", label: "S&P 500 +10%", move: 0.10 },
] as const;
