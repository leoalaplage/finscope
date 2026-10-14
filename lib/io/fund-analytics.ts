/**
 * What a fund's page computes from what it already has: weekly prices with
 * and without distributions (risk and return), the scored companies it holds
 * (the quality and price of its portfolio), and its filings (a score of its
 * own). Pure, so every figure can be checked without drawing it.
 */

export interface WeeklyBar { date: string; close: number; adjustedClose: number }

const YEAR_WEEKS = 52;

const growth = (from: number, to: number) => (from > 0 ? to / from - 1 : null);
const annualise = (total: number | null, years: number) => (total == null || years <= 0 ? null : (1 + total) ** (1 / years) - 1);

/** The bar closest to `weeks` before the last, if the history reaches it. */
const back = <T extends { date: string }>(bars: T[], weeks: number) => (bars.length > weeks ? bars[bars.length - 1 - weeks] : null);

export interface RiskReturn {
  asOf: string;
  /** Total return (distributions reinvested) and price return, over 1, 3 and 5 years; 3 and 5 a year. */
  total: { y1: number | null; y3: number | null; y5: number | null };
  price: { y1: number | null; y3: number | null; y5: number | null };
  /** What distributions added over the last year: total return less price return. */
  distributions: number | null;
  /** Annualised standard deviation of weekly total returns over the history (up to five years). */
  volatility: number | null;
  maxDrawdown: { value: number; peak: string; trough: string } | null;
  /** Against the benchmark's weekly total returns over the same weeks. */
  beta: number | null;
  correlation: number | null;
  /** Excess return over cash per unit of volatility, on the history's annualised return. */
  sharpe: number | null;
  /** The fund's value below its running peak, week by week, as a fraction (0 at a peak). */
  drawdown: Array<{ date: string; value: number }>;
  years: number;
}

export function riskReturn(bars: WeeklyBar[], benchmark: WeeklyBar[], cash: number | null): RiskReturn | null {
  const clean = bars.filter((bar) => bar.adjustedClose > 0 && bar.close > 0);
  if (clean.length < 30) return null;
  const last = clean[clean.length - 1];
  const span = (weeks: number, key: "close" | "adjustedClose") => {
    const start = back(clean, weeks);
    return start ? growth(start[key], last[key]) : null;
  };
  const years = (clean.length - 1) / YEAR_WEEKS;
  const weekly = clean.slice(1).map((bar, index) => ({ date: bar.date, value: bar.adjustedClose / clean[index].adjustedClose - 1 }));
  const mean = weekly.reduce((sum, entry) => sum + entry.value, 0) / weekly.length;
  const variance = weekly.reduce((sum, entry) => sum + (entry.value - mean) ** 2, 0) / Math.max(1, weekly.length - 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(YEAR_WEEKS);

  let peak = clean[0]; let worst: RiskReturn["maxDrawdown"] = null;
  const drawdown = clean.map((bar) => {
    if (bar.adjustedClose >= peak.adjustedClose) peak = bar;
    const value = bar.adjustedClose / peak.adjustedClose - 1;
    if (!worst || value < worst.value) worst = { value, peak: peak.date, trough: bar.date };
    return { date: bar.date, value };
  });

  // Beta and correlation over the weeks both have.
  const benchmarkByDate = new Map(benchmark.map((bar, index) => [bar.date, index]));
  const pairs: Array<[number, number]> = [];
  for (let index = 1; index < clean.length; index++) {
    const at = benchmarkByDate.get(clean[index].date); const before = benchmarkByDate.get(clean[index - 1].date);
    if (at == null || before == null || benchmark[before].adjustedClose <= 0) continue;
    pairs.push([clean[index].adjustedClose / clean[index - 1].adjustedClose - 1, benchmark[at].adjustedClose / benchmark[before].adjustedClose - 1]);
  }
  let beta: number | null = null; let correlation: number | null = null;
  if (pairs.length >= 26) {
    const meanFund = pairs.reduce((sum, [fund]) => sum + fund, 0) / pairs.length;
    const meanBench = pairs.reduce((sum, [, bench]) => sum + bench, 0) / pairs.length;
    let covariance = 0; let fundVariance = 0; let benchVariance = 0;
    for (const [fund, bench] of pairs) {
      covariance += (fund - meanFund) * (bench - meanBench);
      fundVariance += (fund - meanFund) ** 2;
      benchVariance += (bench - meanBench) ** 2;
    }
    beta = benchVariance > 0 ? covariance / benchVariance : null;
    correlation = fundVariance > 0 && benchVariance > 0 ? covariance / Math.sqrt(fundVariance * benchVariance) : null;
  }
  const annual = annualise(growth(clean[0].adjustedClose, last.adjustedClose), years);
  const y1Total = span(YEAR_WEEKS, "adjustedClose"); const y1Price = span(YEAR_WEEKS, "close");
  return {
    asOf: last.date,
    total: { y1: y1Total, y3: annualise(span(3 * YEAR_WEEKS, "adjustedClose"), 3), y5: annualise(span(5 * YEAR_WEEKS, "adjustedClose"), 5) },
    price: { y1: y1Price, y3: annualise(span(3 * YEAR_WEEKS, "close"), 3), y5: annualise(span(5 * YEAR_WEEKS, "close"), 5) },
    distributions: y1Total != null && y1Price != null ? y1Total - y1Price : null,
    volatility: Number.isFinite(volatility) && volatility > 0 ? volatility : null,
    maxDrawdown: worst,
    beta, correlation,
    sharpe: annual != null && volatility > 0 ? (annual - (cash ?? 0)) / volatility : null,
    drawdown, years,
  };
}

/* --- What the fund holds, read as companies ------------------------------- */

export interface ScoredHolding {
  weight: number;
  /** The engine's scores for the company, where it is one this site scores. */
  total: number | null;
  grade: string | null;
  pillars: Record<string, number | null>;
  /** Raw readings, from the company's own filings and today's price. */
  roic: number | null;
  operatingMargin: number | null;
  revenueGrowth: number | null;
  fcfYield: number | null;
  earningsYield: number | null;
  marketCap: number | null;
}

export interface PortfolioQuality {
  /** How much of the fund the readings below rest on. */
  coverage: number;
  total: number | null;
  pillars: Record<string, number | null>;
  grades: Array<{ grade: string; weight: number }>;
  roic: number | null;
  operatingMargin: number | null;
  revenueGrowth: number | null;
  /** Aggregates of yields, so that a price is divided by the fund's own share of earnings: P/FCF and EV/EBIT of the whole. */
  priceToFcf: number | null;
  evToEbit: number | null;
  size: Array<{ label: string; weight: number }>;
}

/** A weighted mean over the holdings that have the reading, re-weighted to them. */
function weighted(rows: ScoredHolding[], read: (row: ScoredHolding) => number | null): number | null {
  let sum = 0; let weight = 0;
  for (const row of rows) {
    const value = read(row);
    if (value == null || !Number.isFinite(value) || row.weight <= 0) continue;
    sum += value * row.weight; weight += row.weight;
  }
  return weight > 0 ? sum / weight : null;
}

const SIZE_BANDS: Array<[string, number]> = [["Mega · over $200bn", 200e9], ["Large · $10bn–200bn", 10e9], ["Mid · $2bn–10bn", 2e9], ["Small · under $2bn", 0]];

export function portfolioQuality(rows: ScoredHolding[], pillarNames: string[], gradeOrder: string[]): PortfolioQuality {
  const scored = rows.filter((row) => row.total != null || row.roic != null);
  const coverage = scored.reduce((sum, row) => sum + Math.max(0, row.weight), 0);
  const grades = gradeOrder.map((grade) => ({ grade, weight: scored.filter((row) => row.grade === grade).reduce((sum, row) => sum + row.weight, 0) }))
    .filter((entry) => entry.weight > 0);
  const fcfYield = weighted(scored, (row) => row.fcfYield);
  const earningsYield = weighted(scored, (row) => row.earningsYield);
  const sized = scored.filter((row) => row.marketCap != null && row.marketCap > 0);
  const sizedWeight = sized.reduce((sum, row) => sum + row.weight, 0);
  const size = SIZE_BANDS.map(([label, floor], index) => ({
    label,
    weight: sizedWeight > 0 ? sized.filter((row) => row.marketCap! >= floor && (index === 0 || row.marketCap! < SIZE_BANDS[index - 1][1])).reduce((sum, row) => sum + row.weight, 0) / sizedWeight : 0,
  })).filter((band) => band.weight > 0);
  return {
    coverage,
    total: weighted(scored, (row) => row.total),
    pillars: Object.fromEntries(pillarNames.map((pillar) => [pillar, weighted(scored, (row) => row.pillars[pillar] ?? null)])),
    grades,
    roic: weighted(scored, (row) => row.roic),
    operatingMargin: weighted(scored, (row) => row.operatingMargin),
    revenueGrowth: weighted(scored, (row) => row.revenueGrowth),
    priceToFcf: fcfYield != null && fcfYield > 0 ? 1 / fcfYield : null,
    evToEbit: earningsYield != null && earningsYield > 0 ? 1 / earningsYield : null,
    size,
  };
}

/* --- FinScope's own score for a fund -------------------------------------- */

export interface FundScore {
  score: number | null;
  stars: number | null;
  pillars: Array<{ name: string; score: number | null; weight: number; reading: string }>;
}

/** A reading placed on 0–100 between the value that scores nought and the value that scores a hundred. */
const scale = (value: number | null | undefined, zero: number, hundred: number) => {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, ((value - zero) / (hundred - zero)) * 100));
};

/**
 * FinScope's fund score: what it costs, what it holds, how spread it is, how
 * faithfully it does what it says, and how established it is. Not Morningstar's
 * rating, and not a forecast — five readings from the fund's own filings and
 * prices, each on a fixed scale and stated beside it. A reading that does not
 * apply (tracking, for a fund with no index) is left out and the rest
 * re-weighted.
 */
export function fundScore(input: {
  expenseRatio: number | null;
  holdingsQuality: number | null;
  qualityCoverage: number;
  effectiveHoldings: number | null;
  trackingDifference: number | null;
  netAssets: number | null;
}): FundScore {
  const pillars = [
    { name: "Cost", weight: 30, score: scale(input.expenseRatio, 0.01, 0.0003), reading: input.expenseRatio == null ? "Not stated" : `${(input.expenseRatio * 100).toFixed(2)}% a year` },
    {
      name: "Quality of holdings", weight: 25,
      score: input.qualityCoverage >= 0.5 ? scale(input.holdingsQuality, 25, 70) : null,
      reading: input.qualityCoverage >= 0.5 && input.holdingsQuality != null ? `Quality Score ${input.holdingsQuality.toFixed(0)} over ${(input.qualityCoverage * 100).toFixed(0)}% of the fund` : "Under half the fund is a company scored here",
    },
    { name: "Diversification", weight: 15, score: input.effectiveHoldings == null ? null : scale(Math.log10(input.effectiveHoldings), Math.log10(5), Math.log10(100)), reading: input.effectiveHoldings == null ? "Unknown" : `${input.effectiveHoldings.toFixed(0)} effective holdings` },
    { name: "Tracking", weight: 15, score: input.trackingDifference == null ? null : scale(Math.abs(input.trackingDifference), 0.01, 0), reading: input.trackingDifference == null ? "No index to track" : `${input.trackingDifference < 0 ? "−" : "+"}${Math.abs(input.trackingDifference * 100).toFixed(2)} points a year against its index` },
    { name: "Scale", weight: 15, score: input.netAssets == null ? null : scale(Math.log10(input.netAssets), 8, 10.5), reading: input.netAssets == null ? "Unknown" : `$${(input.netAssets / 1e9).toFixed(1)}bn of assets` },
  ];
  const counted = pillars.filter((pillar) => pillar.score != null);
  const weight = counted.reduce((sum, pillar) => sum + pillar.weight, 0);
  const score = weight >= 45 ? counted.reduce((sum, pillar) => sum + pillar.score! * pillar.weight, 0) / weight : null;
  return { score, stars: score == null ? null : Math.max(1, Math.min(5, Math.ceil(score / 20))), pillars };
}

/** The number of equal holdings that would concentrate a fund as much: one over the sum of squared weights. */
export function effectiveHoldings(weights: number[]): number | null {
  const positive = weights.filter((weight) => weight > 0);
  const total = positive.reduce((sum, weight) => sum + weight, 0);
  if (!positive.length || total <= 0) return null;
  return 1 / positive.reduce((sum, weight) => sum + (weight / total) ** 2, 0);
}

/* --- A treemap ----------------------------------------------------------- */

export interface Tile<T> { item: T; x: number; y: number; width: number; height: number }

/** Squarified treemap (Bruls, Huizing, van Wijk): tiles as near square as the weights allow. */
export function squarify<T>(items: Array<{ item: T; value: number }>, width: number, height: number): Array<Tile<T>> {
  const sorted = items.filter((entry) => entry.value > 0).sort((left, right) => right.value - left.value);
  const total = sorted.reduce((sum, entry) => sum + entry.value, 0);
  if (!total || width <= 0 || height <= 0) return [];
  const area = (value: number) => (value / total) * width * height;
  const tiles: Array<Tile<T>> = [];
  let x = 0; let y = 0; let w = width; let h = height;
  let row: Array<{ item: T; value: number }> = [];
  const worst = (entries: typeof row, side: number) => {
    const areas = entries.map((entry) => area(entry.value));
    const sum = areas.reduce((total, value) => total + value, 0);
    return Math.max(...areas.map((value) => Math.max((side * side * value) / (sum * sum), (sum * sum) / (side * side * value))));
  };
  const lay = (entries: typeof row) => {
    const sum = entries.reduce((total, entry) => total + area(entry.value), 0);
    if (w >= h) {
      const thickness = sum / h; let offset = y;
      for (const entry of entries) { const size = area(entry.value) / thickness; tiles.push({ item: entry.item, x, y: offset, width: thickness, height: size }); offset += size; }
      x += thickness; w -= thickness;
    } else {
      const thickness = sum / w; let offset = x;
      for (const entry of entries) { const size = area(entry.value) / thickness; tiles.push({ item: entry.item, x: offset, y, width: size, height: thickness }); offset += size; }
      y += thickness; h -= thickness;
    }
  };
  for (const entry of sorted) {
    const side = Math.min(w, h);
    if (row.length && worst([...row, entry], side) > worst(row, side)) { lay(row); row = []; }
    row.push(entry);
  }
  if (row.length) lay(row);
  return tiles;
}

/** What $10,000 became, week by week, distributions reinvested, for the fund and its benchmark over the same weeks. */
export function growthOf(bars: WeeklyBar[], benchmark: WeeklyBar[], start = 10_000): Array<{ date: string; fund: number; benchmark: number | null }> {
  if (bars.length < 2) return [];
  const byDate = new Map(benchmark.map((bar) => [bar.date, bar.adjustedClose]));
  const base = bars[0]; const baseBench = byDate.get(base.date) ?? null;
  return bars.map((bar) => {
    const bench = byDate.get(bar.date);
    return { date: bar.date, fund: (start * bar.adjustedClose) / base.adjustedClose, benchmark: baseBench && bench ? (start * bench) / baseBench : null };
  });
}

/** Total return month by month, from the last weekly bar of each month, as years of twelve cells. */
export function monthlyTable(bars: WeeklyBar[]): Array<{ year: number; months: Array<number | null>; year_total: number | null }> {
  const ends = new Map<string, number>();
  for (const bar of bars) ends.set(bar.date.slice(0, 7), bar.adjustedClose);
  const months = [...ends].sort(([left], [right]) => left.localeCompare(right));
  const returns = new Map<string, number>();
  for (let index = 1; index < months.length; index++) returns.set(months[index][0], months[index][1] / months[index - 1][1] - 1);
  const years = [...new Set(months.slice(1).map(([month]) => Number(month.slice(0, 4))))].sort();
  return years.map((year) => {
    const cells = Array.from({ length: 12 }, (_, index) => returns.get(`${year}-${String(index + 1).padStart(2, "0")}`) ?? null);
    const known = cells.filter((value): value is number => value != null);
    return { year, months: cells, year_total: known.length ? known.reduce((product, value) => product * (1 + value), 1) - 1 : null };
  }).reverse();
}
