/**
 * Operating figures — members, deliveries, stores, RevPAR, comparable sales —
 * read from the tables of a company's own documents: its earnings releases
 * (8-K, Item 2.02) and its quarterly reports (10-Q).
 *
 * None of these is in the XBRL a filing carries: a 10-Q tags its statements
 * and its notes, and the figures a company runs itself by sit in the
 * management's discussion and the release, as printed tables. So nothing
 * filed can vouch for them, and they are proven the way the release reader
 * proves its quarter (lib/adapters/earnings-release.ts), against a document
 * already published: a row's year-ago figure must be printed, digit for
 * digit, as the current figure of the same row, under the same heading, in
 * the same kind of document a year earlier. Two documents a year apart agree,
 * or the row is not read. The column the older document printed its quarter
 * in is the column the newer one prints its quarter in — the same table, laid
 * out the same way, a year on.
 */

export type KpiUnit = "count" | "currency" | "percent";

export interface KpiCell { value: number; decimals: number }

export interface KpiRow {
  /** Heading and label, normalised, with the occurrence when a document prints the same row twice. */
  key: string;
  label: string;
  /** The heading the row sits under in its table ("Asia-Pacific (APAC)"), where there is one. */
  section: string | null;
  unit: KpiUnit;
  /** "millions", "thousands", where the row or its table says so. */
  scale: string | null;
  values: Array<KpiCell | null>;
  /** Columns headed as a change or an adjustment. */
  excluded: Set<number>;
  /** The table prints a line of the statements (revenue, operating income, total expenses…): only a plainly operating row is read from it. */
  financial: boolean;
  /** The columns' headings, where they line up with the figures. */
  headings: string[] | null;
  /** The table says, in its own headings, that it reports a quarter. */
  quarterly: boolean;
  /** The heading spanning the row's first figures, where it names a measure ("Net stores opened (closed)"). */
  group: string | null;
}

export interface KpiReading {
  key: string;
  label: string;
  section: string | null;
  unit: KpiUnit;
  scale: string | null;
  /** The column's own heading when it names a measure rather than a period ("Rooms", "Sales growth"). */
  measure: string | null;
  current: KpiCell;
  yearAgo: KpiCell;
}

const decode = (value: string) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
  .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)))
  .replace(/&(nbsp|amp|quot|apos|lt|gt|rsquo|lsquo|ldquo|rdquo|ndash|mdash);/gi, (entity) => ({
    "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">",
    "&rsquo;": "'", "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"', "&ndash;": "–", "&mdash;": "—",
  })[entity.toLowerCase()] ?? entity);

const plain = (value: string) => decode(value.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/[\u00a0\s]+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();

function cellNumber(cell: string): KpiCell | null {
  const text = cell.replace(/[−–—]/g, "-").replace(/[$€£%]/g, "").replace(/\s+/g, "").trim();
  const match = /^(\()?(-)?([\d,]*\.?\d+)\)?$/.exec(text);
  if (!match || !/\d/.test(match[3])) return null;
  const digits = match[3].replace(/,/g, "");
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  const decimals = digits.includes(".") ? digits.length - digits.indexOf(".") - 1 : 0;
  return { value: match[1] || match[2] ? -value : value, decimals };
}

/** A column heading that is not the period's figure. */
const NOT_THE_FIGURE = /chang|variance|fav|unfav|increase|decrease|growth|adjust|non-?gaap|constant|fx|currency|%|percent|\bbps\b|\bpts?\b|y\/y|yoy|vs\.?/i;

const SCALE = /\b(?:in |\()?(millions|thousands|billions)\b/i;
/** A count of people, never an amount. */
const HEADCOUNT = /\b(?:employees|headcount|full-time equivalents?|workforce)\b/i;

/** A figure that is an amount of money by its name, whether or not its row prints the dollar sign. */
const PRICED = /\barp[ua]\b|\barm\b|revpar|\badr\b|average daily rate|(?:revenue|price|win|sales|spend|ticket|fare) per\b|average (?:selling )?price|average ticket/i;
/** A spanning heading that names when, not what. */
const SPAN_PERIOD = /\b(?:three|six|nine|twelve|thirteen|sixteen|twenty-six|thirty-nine|fifty-two|\d{1,2})[- ](?:months|weeks)\b|\bquarters?\b|\byears?\b|\bended\b|^\s*(?:as of|at)\b|\b(?:19|20)\d\d\b|\bq[1-4]\b|\bfy\s?\d|^\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|^\s*(?:current|prior|reported|actual)\b|^\(?(?:in |dollars |\$ )?(?:millions|thousands|billions)|unaudited/i;
const PER_UNIT = /\bper\b|price|yield|average|\bratio\b|\brate\b|\barp[ua]\b|\barm\b|revpar|\badr\b/i;
const CUMULATIVE = /\b(?:six|nine|twelve|26|39|52|53|twenty-six|thirty-nine|fifty-two)[- ](?:months|weeks)\b|\byears? ended\b|\byear[- ]to[- ]date\b|\bfull[- ]year\b|\bfiscal year\b/i;
const QUARTERLY = /\b(?:three|thirteen|twelve|sixteen|13|12|16)[- ](?:months|weeks)\b|\bquarters?\b|\bQ[1-4]\b/i;

/** A row that makes a table one of the statements, or a breakdown of them. */
const STATEMENT_ROW = /^total (?:net )?(?:operating )?(?:revenues?|sales)$|^(?:net )?revenues?$|^net sales$|^operating (?:income|loss|profit)|^income (?:\(loss\) )?from operations|^net (?:income|earnings|loss)\b|^total (?:costs and )?(?:operating )?(?:costs and )?expenses?\b|^total assets$|^total liabilities|^net cash (?:provided|used|from)|^gross (?:profit|margin)$|^cost of (?:sales|revenues?|goods)|^income before|^(?:provision for|benefit from) income taxes|^total current (?:assets|liabilities)/i;

export const normalise = (text: string) => text.toLowerCase()
  .replace(/\(\s*(?:\d{1,2}|[a-z]|[ivx]+)\s*\)|[*†‡§]+/g, " ")
  .replace(/\s\d{1,2}$/, " ")
  .replace(/[^a-z0-9%$&/+.-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

/** Every row of every table in a document, with its heading, its unit and the figures in their columns. */
export function kpiRows(html: string): KpiRow[] {
  const rows: KpiRow[] = [];
  const seen = new Map<string, number>();
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    let header: string[] = [];
    // Headings that span several columns each: "Net stores opened (closed)" over two, "Stores open as of" over two more.
    let spanning: string[] | null = null;
    let section: string | null = null;
    let sectionUnit: KpiUnit | null = null;
    let tableScale: string | null = null;
    const start = rows.length;
    let financial = false;
    let adjusted = 0;
    let labelled = 0;
    let words = "";
    for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const raw = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => plain(cell[1])).filter(Boolean);
      if (!raw.length) continue;
      const numeric = raw.filter((cell) => cellNumber(cell) && !/^(19|20)\d\d$/.test(cell.trim()));
      if (!numeric.length) {
        tableScale = SCALE.exec(raw.join(" "))?.[1]?.toLowerCase() ?? tableScale;
        words += ` ${raw.join(" ")}`;
        // A row of words: the columns' headings when there are several, a heading over the rows below when one.
        if (raw.length > 1) { header = raw; if (!spanning) spanning = raw; }
        // A heading that only names the period or the units ("Three Months Ended June 30,") is not a heading over the rows.
        else if (/[a-z]{3}/i.test(raw[0]) && raw[0].length <= 90 && !/ended|^as of|unaudited|^\(?in (?:millions|thousands)|^(?:19|20)\d\d$|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},?(?: (?:19|20)\d\d)?$/i.test(raw[0])) { section = raw[0].replace(/:$/, "").replace(/(?:\s*\((?:\d{1,2}|[a-z])\))+$/, ""); sectionUnit = null; }
        continue;
      }
      const at = raw.findIndex((cell) => /[a-z]{3}/i.test(cell));
      if (at < 0) continue;
      const label = raw[at].replace(/(?:\s*\((?:\d{1,2}|[a-z])\))+\s*$|\s+\d$/, "").replace(/:$/, "").trim();
      if (STATEMENT_ROW.test(normalise(label)) || STATEMENT.test(label)) financial = true;
      labelled++;
      if (ADJUSTED.test(label)) adjusted++;
      const cells = raw.slice(at + 1);
      const columns: Array<{ text: string; percent: boolean }> = [];
      let currency = false;
      cells.forEach((cell, index) => {
        if (/^[$€£]$/.test(cell.trim())) { currency = true; return; }
        if (/^[)%(]+$/.test(cell.trim())) return;
        if (/[$€£]/.test(cell)) currency = true;
        // A change in points or basis points is a change, as a percentage is.
        columns.push({ text: cell, percent: /%|\bpts?\.?$|\bbps$|\bpoints?$/i.test(cell) || /^\)?\s*(?:%|pts?\.?|bps|points?)$/i.test(cells[index + 1] ?? "") });
      });
      if (!columns.length) continue;
      // A row printed wholly in per cent is a rate (comparable sales, occupancy); otherwise its per cent columns are changes.
      const figures = columns.filter((column) => cellNumber(column.text));
      const rate = figures.length > 0 && figures.every((column) => column.percent);
      const values = columns.map((column) => (column.percent && !rate ? null : cellNumber(column.text)));
      if (!values.some(Boolean)) continue;
      const headings = header.length === columns.length ? header : header.length === columns.length + 1 ? header.slice(1) : null;
      // The first two figures sit under the first spanning heading: where it names a measure rather than a period, it
      // is part of what the row counts.
      const groups = spanning && spanning.length >= 2 && spanning.length < columns.length ? spanning : null;
      const group = groups && !SPAN_PERIOD.test(groups[0]) && /[a-z]{4}/i.test(groups[0]) ? groups[0] : null;
      // A period over the first columns and a measure over the next ("Quarter Ended" | "Stores open as of"): what the
      // first columns count is said somewhere this reader cannot place (Starbucks: in the table's title). Not read.
      if (groups && SPAN_PERIOD.test(groups[0]) && groups.slice(1).some((entry) => !SPAN_PERIOD.test(entry) && /[a-z]{4}/i.test(entry))) continue;
      const excluded = new Set<number>();
      headings?.forEach((heading, index) => { if (NOT_THE_FIGURE.test(heading) && !(rate && /%|percent/i.test(heading) && !/chang|increase|decrease|growth/i.test(heading))) excluded.add(index); });
      // A heading covers the rows of its own kind below it: United's "Passenger load factor" heads three rates, not
      // the costs per seat mile printed after them.
      // "Systemwide", "Consolidated": the whole company, not the region printed above it (McDonald's).
      if (/^(?:systemwide|system-wide|consolidated|total company|worldwide|global|company-wide)\s+\S/i.test(label)) section = null;
      let unit: KpiUnit = rate ? "percent" : currency || PRICED.test(label) ? "currency" : "count";
      // People are counted, whatever the table's "$ in millions" says (Amazon prints its employees in that table).
      const people = HEADCOUNT.test(label) && !rate;
      // Only under a heading that is itself a measure, and only from a rate to an amount or back: a property's or a
      // region's name heads all its rows, and a "$" printed on the first row only does not change what is counted.
      if (section && sectionUnit && (unit === "percent") !== (sectionUnit === "percent") && OPERATING.test(section)) section = null;
      // A statement prints its "$" on a block's first row only: the rows below it under one heading are amounts too.
      const inherited = section != null && sectionUnit === "currency" && unit === "count" && !SCALE.test(label);
      if (inherited && !people) unit = "currency";
      if (people) unit = "count";
      if (section && !sectionUnit) sectionUnit = unit;
      // "Comparable sales increase" one year, "increase/(decrease)" the next: the same row.
      const keyed = (text: string) => normalise(text).replace(/\b(?:increase|decrease|growth|change)\b|\//g, " ").replace(/\s+/g, " ").trim();
      const base = `${section ? keyed(section) : ""}|${keyed(label)}${group ? `|${keyed(group)}` : ""}`;
      const occurrence = (seen.get(base) ?? 0) + 1;
      seen.set(base, occurrence);
      rows.push({
        key: occurrence > 1 ? `${base}#${occurrence}` : base,
        label, section,
        unit,
        // A table's "in millions" is said of its amounts; a count says its own scale in its label.
        // A figure per unit (RevPAR, a price per gallon) is in units, whatever the table's amounts are in.
        scale: SCALE.exec(label)?.[1]?.toLowerCase() ?? ((currency || inherited) && !PER_UNIT.test(label) ? tableScale : null),
        values, excluded, financial: false, headings, group, quarterly: false,
      });
    }
    // Six or nine months, a year: not a quarter, and a different series from the quarter's under the same label.
    // A reconciliation of an adjusted measure prints the reported one beside it: the table is the adjustment's, not the business's.
    // Six months printed before the quarter (Altria's 10-Q) put the cumulative figures in the first columns.
    const cumulative = words.search(CUMULATIVE);
    const quarterly = words.search(QUARTERLY);
    // A table of adjustments: its headings say so, or a third of its rows are adjusted (an adjusted row on its own is
    // left out by isOperating, its table kept: Delta prints "TRASM, adjusted" among its statistics).
    const reconciliation = /reconcil/i.test(words) || ADJUSTED.test(words) || (labelled > 0 && adjusted / labelled >= 1 / 3);
    if ((cumulative >= 0 && (quarterly < 0 || cumulative < quarterly)) || reconciliation) rows.splice(start);
    else for (let index = start; index < rows.length; index++) {
      rows[index].financial = financial;
      rows[index].quarterly = quarterly >= 0;
    }
  }
  return rows;
}

/**
 * What a company runs itself by, and not a line of its statements: those are
 * read from what it files, and a release's version of them is the release
 * reader's business.
 */
const OPERATING = new RegExp([
  "member", "subscri", "customer", "user", "account", "deliveries", "units?\\b", "unit volume", "stores?\\b", "restaurant", "locations?\\b",
  "warehouse", "clubs?\\b", "propert", "rooms?\\b", "occupanc", "revpar", "average daily rate", "\\badr\\b", "load factor", "passenger",
  "available seat", "\\basms?\\b", "\\brpms?\\b", "\\btrasm\\b", "\\bcasm", "\\brasm", "yield", "backlog", "bookings?\\b", "orders?\\b",
  "shipments?", "volume", "traffic", "transactions?\\b", "comparable", "same[- ]store", "\\bcomps?\\b", "headcount", "employees",
  "vehicles?\\b", "trips?\\b", "nights?\\b", "\\bgmv\\b", "gross merchandise", "\\barpu\\b", "\\barpa\\b", "\\barm\\b", "per (?:user|member|subscriber|customer|unit|account|paying|available|occupied|passenger|square|room)",
  "retention", "churn", "square f(?:ee|oo)t", "sq\\.? ?ft", "barrels", "\\bboe", "production", "\\bmcf", "\\bbcf", "tons?\\b", "ounces",
  "\\brigs?\\b", "wells?\\b", "beds?\\b", "admissions", "patients?", "visits", "enrollment", "\\blives\\b", "policies", "in force",
  "premiums? written", "assets under (?:management|custody|administration)", "\\baum\\b", "\\bauc\\b", "net (?:new )?flows", "clients?\\b",
  "daily active", "monthly active", "\\bdau", "\\bmau", "\\bdap\\b", "\\bmap\\b", "\\barr\\b", "annual(?:ized)? recurring", "net (?:revenue|dollar) retention",
  "installed base", "capacity", "utili[sz]ation", "fleet", "aircraft", "units sold", "average selling price", "\\basp\\b", "price per",
  "cost per", "doors", "franchise", "systemwide", "system-wide", "net adds", "net additions", "openings?\\b", "closures?\\b", "seats?\\b",
  "advertis(?:ers|ing impressions)", "impressions", "streams", "downloads", "listings", "hosts", "riders", "drivers", "couriers", "merchants",
  "sellers", "buyers", "payment volume", "\\btpv\\b", "\\bgtv\\b", "cards?\\b", "cardholders", "contracts", "lines\\b", "connections",
  "broadband", "wireless", "postpaid", "prepaid", "homes", "closings", "deliveries", "lots\\b", "communities", "rentals?\\b", "leased",
  "occupied", "cases\\b", "procedures", "tests?\\b", "scripts", "prescriptions", "claims\\b", "loss ratio", "combined ratio", "expense ratio",
].join("|"), "i");

/** A line of the statements, or a figure about the shares, the debt or the tax, whatever table it is printed in. */
const STATEMENT = /\brevenues?\b(?! per\b)|^(?:total )?(?:net )?sales\b(?! per\b)|propert(?:y|ies),? (?:plant|and equipment)|purchases? of|fees?\b|\bstock\b|\brsus?\b|awards?\b|options?\b|additions? to|acquisitions? of|proceeds|obligation|reconciliation|\brent\b|maintenance|repairs|salaries|wages|compensation|\b(?:net )?income\b|expenses?\b|\bcost of\b|\bcosts?\b(?! per\b)|\bmargin\b|earnings|\beps\b|\bprofit\b|\btax|depreciation|amortization|ebitda|\bebit\b|cash\b|\bassets\b(?! under)|liabilit|equity|\bdebt\b|borrowing|dividend|\bshares?\b|weighted|diluted|basic|interest|impairment|restructuring|\bgains?\b|\bloss(?:es)?\b(?! ratio)|provision|receivable|payable|inventor|goodwill|capital expenditure|free cash|operating activities|investing|financing|guidance|outlook|\bbps\b|effective/i;

/** Plainly operating, wherever it is printed: a figure per unit of something, a count in stated units, a rate the business is run by. */
const STRONG = /\bemployees\b|\bheadcount\b|\bper (?:available|paying|member|membership|user|subscriber|customer|unit|account|occupied|passenger|square|room|gallon|trip|order|transaction|vehicle|store|restaurant|location|daily)|\((?:in )?(?:000s|thousands|millions|cents)\)|\bin (?:thousands|millions)\b|comparable|same[- ]store|occupanc|load factor|retention|churn|available seat|revpar|average daily rate|paid members|subscribers|deliveries|backlog|systemwide|system-wide|daily active|monthly active/i;
const ADJUSTED = /adjusted|non-?gaap|excluding|\bex-|-ex\b|pro forma|see note/i;

export const isOperating = (row: Pick<KpiRow, "label" | "section" | "financial" | "unit">) => {
  // "Total" alone says nothing of what is totalled.
  if (!row.section && /^(?:total|other|all other|subtotal|consolidated|net)$/i.test(row.label.trim())) return false;
  if (STATEMENT.test(row.label) || ADJUSTED.test(row.label) || (row.section && (STATEMENT.test(row.section) || ADJUSTED.test(row.section)))) return false;
  // Occupancy is a rate; as an amount it is a line of costs (Chipotle's).
  if (/occupan/i.test(row.label) && row.unit !== "percent") return false;
  if (row.financial) return STRONG.test(row.label);
  return OPERATING.test(row.label) || (row.section != null && OPERATING.test(row.section));
};

const PERIOD = /\b(?:19|20)\d\d\b|\b\d{2}\b|months?|quarters?|weeks?|years?|ended|period|\bq[1-4]\b|\bfy|ytd|as of|current|prior|previous|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i;

/** Printed finely enough to prove anything: three significant figures, two for a rate. */
const precise = (cell: KpiCell, unit: KpiUnit) => Math.abs(cell.value) * 10 ** cell.decimals >= (unit === "percent" ? 10 : 100);
const equal = (left: KpiCell, right: KpiCell) => left.value === right.value && left.decimals === right.decimals;

/**
 * A row of the newer document proven against the same row of the document a
 * year older: its year-ago figure (column j) is the older one's own figure
 * (column i), so column i is where the newer prints its period. The earliest
 * such column, so a year to date printed after the quarter is not taken for it.
 */
export function anchorRow(newer: KpiRow, older: KpiRow): KpiReading | null {
  if (newer.unit !== older.unit) return null;
  // The period and the year before it are a row's first two figures, whichever comes first; a later column is
  // another measure under a heading this reader does not see (Starbucks: stores opened, then stores open).
  const figures = (row: KpiRow) => row.values.map((cell, index) => (cell && !row.excluded.has(index) ? index : -1)).filter((index) => index >= 0);
  const reading = (current: KpiCell, yearAgo: KpiCell, column: number): KpiReading | null => {
    // A rate moves by points, a count or an amount within a band: beyond it, a column of something else.
    if (newer.unit !== "percent" && yearAgo.value !== 0 && (current.value / yearAgo.value > 5 || current.value / yearAgo.value < 0.2)) return null;
    const heading = newer.headings?.[column] ?? null;
    const measure = newer.group ?? (heading && !PERIOD.test(heading) && !/millions|thousands|billions|dollars|unaudited|\$/i.test(heading) && /[a-z]{3}/i.test(heading) ? heading : null);
    return { key: newer.key, label: newer.label, section: newer.section, unit: newer.unit, scale: newer.scale ?? older.scale, measure, current, yearAgo };
  };
  // Five quarters or more side by side (Chipotle and the banks five, Amazon six): the year-ago quarter is four
  // columns from the newest, newest first or oldest first — and the older document prints it as its own newest.
  const newerFigures = figures(newer), olderFigures = figures(older);
  if (newerFigures.length >= 5 && olderFigures.join() === newerFigures.join()) {
    const count = newerFigures.length;
    const first = newerFigures[0], last = newerFigures[count - 1];
    const cell = (row: KpiRow, index: number) => row.values[index]!;
    // Newest first: the quarter is the first column, the year before it the fifth.
    const fifth = newerFigures[4];
    if (equal(cell(newer, fifth), cell(older, first)) && precise(cell(older, first), older.unit)) return reading(cell(newer, first), cell(newer, fifth), first);
    // Oldest first: the quarter is the last column, the year before it four to its left.
    const back = newerFigures[count - 5];
    if (equal(cell(newer, back), cell(older, last)) && precise(cell(older, last), older.unit)) return reading(cell(newer, last), cell(newer, back), last);
    return null;
  }
  const olderColumns = olderFigures.slice(0, 2);
  const newerColumns = newerFigures.slice(0, 2);
  if (olderColumns.length < 2 || newerColumns.length < 2 || olderColumns.join() !== newerColumns.join()) return null;
  for (const i of olderColumns) {
    const own = older.values[i];
    if (!own || !precise(own, older.unit)) continue;
    for (const j of newerColumns) {
      if (j === i) continue;
      const yearAgo = newer.values[j];
      if (!yearAgo || newer.excluded.has(j) || !equal(yearAgo, own)) continue;
      const current = newer.values[i];
      if (!current || newer.excluded.has(i)) continue;
      return reading(current, yearAgo, i);
    }
  }
  return null;
}

/** Every operating row of the newer document that the older one, a year before, proves. */
export function anchorDocuments(newer: KpiRow[], older: KpiRow[]): KpiReading[] {
  const byKey = new Map(older.map((row) => [row.key, row]));
  const readings: KpiReading[] = [];
  const printed = new Set<string>();
  for (const row of newer) {
    // A row printed twice under one heading is two measures this reader cannot tell apart (a quarter, then six months).
    if (row.key.includes("#") || !isOperating(row)) continue;
    const match = byKey.get(row.key);
    if (!match) continue;
    const reading = anchorRow(row, match);
    if (!reading) continue;
    // The same figure printed again further on (a summary, then the detail): read once.
    // Two labels for one figure ("Total revenue per available seat mile", then "TRASM"): three significant figures twice over are the same figure.
    const same = `${reading.current.value}|${reading.yearAgo.value}`;
    if (printed.has(same)) continue;
    printed.add(same);
    readings.push(reading);
  }
  return readings;
}
