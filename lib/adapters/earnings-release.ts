/**
 * A quarter's headline figures from the company's own press release, the day
 * it is published.
 *
 * Results reach the SEC twice: first as an 8-K under item 2.02, the press
 * release, on the morning or the evening of the announcement; then, days or
 * weeks later, in the 10-Q or 10-K whose XBRL this site is built from. Between
 * the two, every page showed the previous quarter. The release is HTML, laid
 * out as each company pleases — the quarter first or the year to date first,
 * five quarters side by side in a bank's supplement, GAAP beside adjusted
 * figures — so a figure is never taken from its position on the page.
 *
 * It is taken from beside a figure this site already holds. Every release
 * prints the same quarter a year earlier, and that quarter is filed: when a
 * row of the release carries the filed year-ago revenue, to the rounding of
 * its units, the row, the column and the units are all proven at once, and
 * the current quarter is the figure in the column before it — stepping over
 * any column that holds another quarter already filed. A row where no
 * year-ago figure can be found gives nothing, and a figure that reads as a
 * year to date rather than a quarter is refused. Nothing is guessed: a
 * metric this cannot prove is left blank.
 *
 * Pure: documents and anchors in, figures out.
 */

export type ReleaseMetric = "revenue" | "operatingIncome" | "netIncome" | "dilutedEps";
export const RELEASE_METRICS: ReleaseMetric[] = ["revenue", "operatingIncome", "netIncome", "dilutedEps"];

export interface MetricAnchor {
  /** The filed year-ago quarter: one figure, or several readings of it (EPS on all shares, on common). */
  yearAgo: number[];
  /** Every other filed quarter of the measure, so a column holding one is stepped over. */
  known: number[];
  /** The quarters of the new quarter's fiscal year already filed, summed: a figure as large is a year to date. */
  yearToDate: number | null;
  /** Two, three and four consecutive filed quarters added up: a half, nine months, a year — never a quarter. */
  totals: number[];
}

/** The year-ago quarter's diluted share count, for checking earnings per share against net income. */
export interface ReleaseCheck { dilutedShares: number | null }

export type ReleaseAnchors = Partial<Record<ReleaseMetric, MetricAnchor>>;

export interface ReleaseFigure {
  value: number;
  yearAgo: number;
  /** The row it was read from, as the release labels it. */
  row: string;
  /** The document it was read from. */
  document: string;
}

export type ReleaseFigures = Partial<Record<ReleaseMetric, ReleaseFigure>>;

interface Cell { value: number; decimals: number }
/** A row's figures in their columns; a dash or an empty column is kept as null so columns line up across rows. */
export interface ReleaseRow {
  label: string;
  values: Array<Cell | null>;
  table: number;
  /** Columns whose header calls them adjusted, an adjustment or a change, where the header lines up with the figures. */
  excluded: Set<number>;
}

/** A column header that is not the reported figure. */
const NOT_REPORTED = /adjust|non-?gaap|impact|exclud|chang|variance|fav|unfav|increase|decrease|inc\.?\s*\/|%|percent|\bbps\b|constant/i;

const decode = (value: string) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
  .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)))
  .replace(/&(nbsp|amp|quot|apos|lt|gt);/gi, (entity) => ({
    "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">",
  })[entity.toLowerCase()] ?? entity);

const plain = (value: string) => decode(value.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** "1,480.2", "$(1.17)", "(8" then ")", "−3.2": the number a cell prints, with how finely it is printed. */
function cellNumber(cell: string): Cell | null {
  const text = cell.replace(/[−–]/g, "-").replace(/\$/g, "").replace(/\s+/g, "").trim();
  const match = /^(\()?(-)?([\d,]*\.?\d+)\)?$/.exec(text);
  if (!match || !/\d/.test(match[3])) return null;
  const digits = match[3].replace(/,/g, "");
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  const decimals = digits.includes(".") ? digits.length - digits.indexOf(".") - 1 : 0;
  return { value: match[1] || match[2] ? -value : value, decimals };
}

/** Every table row of a document: its label, and the numbers it prints, percentages left out. */
export function releaseRows(html: string): ReleaseRow[] {
  const rows: ReleaseRow[] = [];
  let tableIndex = -1;
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    tableIndex++;
    // The last row of words above the figures: the columns' headings.
    let header: string[] = [];
    for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => plain(cell[1])).filter(Boolean);
      if (cells.length > 1 && cells.every((cell) => !cellNumber(cell) || /^(19|20)\d\d$/.test(cell.trim()))) { header = cells; continue; }
      const at = cells.findIndex((cell) => /[a-z]{3}/i.test(cell));
      if (at < 0) continue;
      // "Net income (1)", "Diluted 1": a footnote marker is not part of the label.
      const label = cells[at].replace(/\s*\(\d\)\s*$|\s+\d$/, "").trim();
      // One entry per column: the figure, or null for a dash, a percentage or a word, so that the columns stay
      // where the headings put them. A "$" or a closing bracket in a cell of its own is not a column.
      const raw = cells.slice(at + 1);
      const columns: string[] = [];
      const values: Array<Cell | null> = [];
      raw.forEach((cell, index) => {
        if (/^[$)%(]+$/.test(cell.trim())) return;
        columns.push(cell);
        // A change in per cent, printed in the cell or the next one, is not a figure.
        values.push(/%/.test(cell) || /^\)?\s*%/.test(raw[index + 1] ?? "") ? null : cellNumber(cell));
      });
      // Headings line up with the columns when there is one per column, with or without one over the labels.
      const headings = header.length === columns.length ? header : header.length === columns.length + 1 ? header.slice(1) : null;
      const excluded = new Set<number>();
      headings?.forEach((heading, index) => { if (NOT_REPORTED.test(heading)) excluded.add(index); });
      if (values.some(Boolean)) rows.push({ label, values, table: tableIndex, excluded });
    }
  }
  return rows;
}

/** A figure the company adjusted is its own measure, not the one filed: never read. */
const NON_GAAP = /excluding|ex-|notable|adjusted|non-?gaap|core\b|underlying|operating basis|managed basis|pro forma|constant currency|organic|segment/i;

const ROWS: Record<ReleaseMetric, { take: RegExp; skip: RegExp }> = {
  revenue: {
    take: /revenue|net sales|^sales\b|total sales/i,
    skip: /cost|deferred|unearned|per (common )?share|margin|growth|expense|%|backlog|percent|days/i,
  },
  operatingIncome: {
    take: /operating (income|profit|earnings)|income from operations|^operating (loss|income \(loss\))/i,
    skip: /margin|per (common )?share|non-?operating|other operating|%|adjusted|before/i,
  },
  netIncome: {
    take: /^net (income|earnings|loss)|net (income|earnings) (attributable|applicable|available)/i,
    skip: /per (common )?share|margin|%|non-?controlling|minority|comprehensive|before|discontinued|continuing|adjusted|growth|return/i,
  },
  dilutedEps: {
    take: /diluted|per (common |diluted )?share/i,
    skip: /shares outstanding|weighted|average (diluted|common|shares)|dividend|book value|cash flow|basic|adjusted|non-?gaap|count/i,
  },
};

const SCALES: Record<ReleaseMetric, number[]> = {
  revenue: [1, 1e3, 1e6, 1e9],
  operatingIncome: [1, 1e3, 1e6, 1e9],
  netIncome: [1, 1e3, 1e6, 1e9],
  dilutedEps: [1],
};

/** Whether a printed figure, in these units, is a filed one to the rounding it is printed at. */
function same(cell: Cell, scale: number, filed: number, metric: ReleaseMetric): boolean {
  if (metric === "dilutedEps") return Math.abs(cell.value - filed) <= Math.max(0.011, 0.5 * 10 ** -cell.decimals + 1e-9);
  const rounding = scale * 0.51 * 10 ** -cell.decimals;
  return Math.abs(cell.value * scale - filed) <= Math.max(rounding, Math.abs(filed) * 0.0025);
}

interface Candidate { metric: ReleaseMetric; row: ReleaseRow; document: string; scale: number; yearAgo: number; at: number; current: number | null }

const isKnown = (cell: Cell | null, scale: number, anchor: MetricAnchor, metric: ReleaseMetric) =>
  cell != null && anchor.known.some((value) => value !== 0 && same(cell, scale, value, metric));

/** Printed finely enough to prove anything: three significant figures, for an amount ("5.2" billion proves nothing). */
const precise = (cell: Cell, metric: ReleaseMetric) => metric === "dilutedEps" || Math.abs(cell.value) * 10 ** cell.decimals >= 100;

/**
 * The quarter's figure in a row that carries the filed year-ago one.
 *
 * In the order a release lays a row out: oldest first, when the quarters
 * filed since the year-ago one follow it (the quarter comes after them); this
 * year's columns then last year's, as many of each (the quarter opens the
 * first half); otherwise the
 * nearest column before the year-ago figure that is not another filed quarter
 * (a bank prints five quarters side by side, Fastenal the nine months first,
 * Progressive the month) and not a column its header calls adjusted or a
 * change (Microsoft's "As Adjusted (non-GAAP)", Delta's "Change"); otherwise,
 * with nothing before it, the column after it, for a release that prints last
 * year first. A figure there that is not plausible gives nothing rather than
 * a reading further along.
 * A row whose figures before the year-ago one add up to it is a breakdown by
 * division ending in the total, and gives nothing.
 */
function candidate(row: ReleaseRow, metric: ReleaseMetric, anchor: MetricAnchor, document: string): Candidate | null {
  for (const scale of SCALES[metric]) {
    for (const filed of anchor.yearAgo) {
      if (filed === 0) continue;
      const at = row.values.findIndex((cell) => cell != null && precise(cell, metric) && same(cell, scale, filed, metric));
      if (at < 0) continue;
      const before = row.values.slice(0, at).filter((cell): cell is Cell => cell != null);
      if (before.length > 1 && Math.abs(before.reduce((sum, cell) => sum + cell.value, 0) * scale - filed) <= Math.abs(filed) * 0.01) return null;
      const usable = (index: number) => {
        const cell = row.values[index];
        return cell != null && !isKnown(cell, scale, anchor, metric) && !same(cell, scale, filed, metric) && plausible(metric, cell.value * scale, filed, anchor);
      };
      const found = (index: number): Candidate => ({ metric, row, document, scale, yearAgo: filed, at, current: index });
      const open = (index: number) => row.values[index] == null || row.excluded.has(index);
      // Oldest first, as a trend table runs (State Street: five quarters, left to right): the quarters filed
      // since the year-ago one follow it, and the new one comes after them.
      let next = at + 1;
      while (next < row.values.length && open(next)) next++;
      if (next < row.values.length && isKnown(row.values[next], scale, anchor, metric)) {
        while (next < row.values.length && (open(next) || isKnown(row.values[next], scale, anchor, metric))) next++;
        return next < row.values.length && usable(next) ? found(next) : null;
      }
      // This year's columns then last year's, as many of each: the quarter opens the first half.
      // (Counted to the last figure: the percentage columns after it are not a year's.)
      let filled = row.values.length;
      while (filled > 0 && row.values[filled - 1] == null) filled--;
      const half = filled / 2;
      if (Number.isInteger(half) && at === half && half > 1 && usable(0) && !row.excluded.has(0)) return found(0);
      // The nearest column before the year-ago figure that is neither another filed quarter nor a column headed
      // as adjusted or as a change.
      let index = at - 1;
      while (index >= 0 && (row.values[index] == null || row.excluded.has(index) || isKnown(row.values[index], scale, anchor, metric))) index--;
      if (index >= 0) return usable(index) ? found(index) : null;
      // Nothing before it: a release that prints last year first.
      let after = at + 1;
      while (after < row.values.length && (row.values[after] == null || row.excluded.has(after))) after++;
      if (after < row.values.length && usable(after)) return found(after);
      return null;
    }
  }
  return null;
}

/**
 * A quarter, not a year to date or a whole year, and not a different measure
 * printed in the quarter's place: within the range a business moves in a
 * year, and not as large as the quarters of its fiscal year already filed
 * plus half a quarter more.
 */
function plausible(metric: ReleaseMetric, value: number, yearAgo: number, anchor: MetricAnchor): boolean {
  const ratio = value / yearAgo;
  if (metric === "revenue" && !(ratio > 0.5 && ratio < 2)) return false;
  if (anchor.yearToDate != null && anchor.yearToDate > 0 && value > 0 && yearAgo > 0 && value >= anchor.yearToDate + yearAgo * 0.5) return false;
  if (anchor.totals.some((total) => total !== 0 && Math.abs(value - total) <= Math.abs(total) * (metric === "dilutedEps" ? 0.0025 : 0.002))) return false;
  return true;
}

/** The headline figure where a release prints two that both prove themselves: what is left for the company's own shareholders. */
const PREFERRED: Partial<Record<ReleaseMetric, RegExp>> = {
  netIncome: /attributable|available|applicable/i,
  dilutedEps: /dilut/i,
};

/**
 * Every metric the documents prove.
 *
 * Every row that proves itself votes, and the figure most rows give is kept:
 * a release prints its headline figures several times (the summary, the
 * statement, the reconciliation), and a stray row that happens to carry the
 * year-ago figure is outvoted by them. A tie proves nothing and gives nothing.
 */
export function readReleaseFigures(documents: Array<{ name: string; html: string }>, anchors: ReleaseAnchors, check: ReleaseCheck = { dilutedShares: null }): ReleaseFigures {
  const candidates: Candidate[] = [];
  for (const document of documents) {
    for (const row of releaseRows(document.html)) {
      if (row.label.length > 110 || NON_GAAP.test(row.label)) continue;
      for (const metric of RELEASE_METRICS) {
        const anchor = anchors[metric];
        if (!anchor || !ROWS[metric].take.test(row.label) || ROWS[metric].skip.test(row.label)) continue;
        const found = candidate(row, metric, anchor, document.name);
        if (found) candidates.push(found);
      }
    }
  }

  const figures: ReleaseFigures = {};
  for (const metric of RELEASE_METRICS) {
    const votes: Array<{ value: number; count: number; preferred: boolean; first: ReleaseFigure }> = [];
    for (const found of candidates.filter((each) => each.metric === metric && each.current != null)) {
      const value = found.row.values[found.current!]!.value * found.scale;
      const preferred = PREFERRED[metric]?.test(found.row.label) ?? false;
      const tolerance = metric === "dilutedEps" ? 0.005 : Math.abs(value) * 0.001;
      const vote = votes.find((each) => Math.abs(each.value - value) <= tolerance);
      if (vote) { vote.count++; vote.preferred ||= preferred; }
      else votes.push({ value, count: 1, preferred, first: { value, yearAgo: found.yearAgo, row: found.row.label, document: found.document } });
    }
    const pool = votes.some((vote) => vote.preferred) ? votes.filter((vote) => vote.preferred) : votes;
    const ranked = pool.sort((left, right) => right.count - left.count);
    // Two readings with as many rows behind each: nothing is proven.
    if (ranked[0] && !(ranked[1] && ranked[1].count === ranked[0].count)) figures[metric] = ranked[0].first;
  }

  // Earnings per share times the shares is the net income, near enough (buybacks, preferred dividends): when it is not, neither is kept.
  const { netIncome, dilutedEps } = figures;
  if (netIncome && dilutedEps && check.dilutedShares && dilutedEps.value !== 0) {
    const implied = netIncome.value / (dilutedEps.value * check.dilutedShares);
    if (!(implied > 0.75 && implied < 1.33)) { delete figures.netIncome; delete figures.dilutedEps; }
  }
  return figures;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Whether a document speaks of the quarter expected: it names a date within
 * ten days of the quarter's end ("three months ended September 30, 2026";
 * a 52-week year ends on a Saturday near it). A release for another quarter —
 * the one before, when the filed figures are behind — is never read as this one.
 */
export function namesQuarterEnd(html: string, end: string, quarter?: { number: number; fiscalYear: number }): boolean {
  const target = Date.parse(`${end}T12:00:00Z`);
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ");
  // Or by the fiscal quarter's name: "third-quarter 2026", "Q3 FY26", "3Q26", "second quarter of fiscal 2027".
  if (quarter) {
    const ordinal = ["first", "second", "third", "fourth"][quarter.number - 1];
    const year = String(quarter.fiscalYear);
    const short = year.slice(2);
    const named = new RegExp(`\\b(${ordinal}|${quarter.number}(st|nd|rd|th))[- ]quarter(,)?( of)?( fiscal( year)?)? (${year}|'?${short}\\b)|\\bQ${quarter.number}[ '-]*(FY)?[ '-]*(${year}|${short})\\b|\\b${quarter.number}Q[ '-]*(${year}|${short})\\b|\\bfiscal (${year}|${short}) (${ordinal}|${quarter.number}(st|nd|rd|th)) quarter`, "i");
    if (named.test(text)) return true;
  }
  for (const match of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d\d)\b/gi)) {
    const month = MONTHS.indexOf(match[1].toLowerCase());
    const date = Date.UTC(Number(match[3]), month, Number(match[2]), 12);
    if (Math.abs(date - target) <= 10 * 86_400_000) return true;
  }
  return false;
}

/** The release's documents in the order to read them: the press release, then any supplement, never the 8-K's own cover. */
export function releaseDocuments(names: Array<{ name: string; size?: string | number }>, primary: string | null): string[] {
  const rank = (name: string) => (/ex(hibit)?[-_ ]?99[-_.]?0?1\b|99d1|991|pr\.htm|release|earnings|results/i.test(name) ? 0
    : /ex(hibit)?[-_ ]?99|99d\d|supp|financ/i.test(name) ? 1 : 2);
  return names
    .filter((item) => /\.html?$/i.test(item.name) && item.name !== primary && !/-index|^R\d+\.htm/i.test(item.name))
    .sort((left, right) => rank(left.name) - rank(right.name) || Number(right.size ?? 0) - Number(left.size ?? 0))
    .slice(0, 4)
    .map((item) => item.name);
}
