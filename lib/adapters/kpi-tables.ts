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
  /**
   * What the whole table is about, where the document says it: the heading printed just above the table ("Walmart
   * U.S. Segment", "U.S. comparable sales results") or the table's own first heading over its labels ("Sam's Club
   * U.S. | Q2 FY27 | Q2 FY26").
   */
  caption?: string | null;
  unit: KpiUnit;
  /** The table's scale is said of its dollars ("U.S. dollars in millions"), not of the counts printed in it. */
  dollarScale?: boolean;
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
  /**
   * How the figure was printed. "single": one quarter's figure under a heading
   * that names the measure, with no year-ago column (Tesla's deliveries:
   * Production | Deliveries). "text": a sentence of the release ("DAP was 3.60
   * billion on average for June 2026, an increase of 3% year-over-year"), with
   * the change on a year it states, which proves the figure against the one a
   * year before. A table row otherwise.
   */
  form?: "single" | "text";
  /** A sentence's stated change on the year, in per cent. */
  growth?: number | null;
}

export interface KpiReading {
  key: string;
  label: string;
  section: string | null;
  caption?: string | null;
  unit: KpiUnit;
  dollarScale?: boolean;
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
/** Counted, never an amount: what a "Number of" row or a row of customers, branches or stores counts. */
const COUNTED = /^number of\b|\badvisors?\b|\bbranch(?:es)?\b|\b(?:active )?(?:digital |mobile )?customers\b(?! deposits)|\bmembers\b|\bsubscribers\b|\bstores\b|\brestaurants\b|\blocations\b|\bdeliveries\b|\bunits\b(?! of)/i;
/** What a count in an amounts table may still be: things counted, not money. */
const OPERATING_COUNT = /units?\b|deliveries|vehicles?|stores?|restaurants?|locations?|customers?|members?|subscribers?|accounts?|branch|advisors?|employees|headcount|transactions?|trips?|nights?|rooms?|passengers?|barrels|tons?|ounces|wells?|rigs?|beds?|visits|admissions|patients?|policies|shipments?|orders?|impressions/i;
/** A rate by its name: printed without a "%" sign it is still a percentage. */
const RATE_NAME = /\brate\b|\byield\b|\bratio\b|\bmargin\b|delinquenc|charge-off rate|\bloss rate\b|\butilization\b|load factor|occupancy/i;

/** A figure that is an amount of money by its name, whether or not its row prints the dollar sign. */
const PRICED = /\barp[ua]\b|\barm\b|revpar|\badr\b|average daily rate|(?:revenue|price|win|sales|spend|ticket|fare) per\b|average (?:selling )?price|average ticket/i;
/** A spanning heading that names when, not what. */
const SPAN_PERIOD = /\bquarterly\b|\btrends\b|\b(?:three|six|nine|twelve|thirteen|sixteen|twenty-six|thirty-nine|fifty-two|\d{1,2})[- ](?:months|weeks)\b|\bquarters?\b|\byears?\b|\bended\b|^\s*(?:as of|at)\b|\b(?:19|20)\d\d\b|\bq[1-4]\b|\bfy\s?\d|^\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|^\s*(?:current|prior|reported|actual)\b|^\(?(?:in |dollars |\$ )?(?:millions|thousands|billions)|unaudited/i;
const PER_UNIT = /\bper\b|price|yield|average|\bratio\b|\brate\b|\barp[ua]\b|\barm\b|revpar|\badr\b/i;
const CUMULATIVE = /\b(?:six|nine|twelve|26|39|52|53|twenty-six|thirty-nine|fifty-two)[- ](?:months|weeks)\b|\byears? ended\b|\byear[- ]to[- ]date\b|\bfull[- ]year\b|\bfiscal year\b/i;
// "Quarterly trends", and quarters written 3Q26 (JPMorgan's supplement): a quarter, before the nine months beside it.
const QUARTERLY = /\b(?:three|thirteen|twelve|sixteen|13|12|16)[- ](?:months|weeks)\b|\bquarters?\b|\bquarterly\b|\bQ[1-4]\b|\b[1-4]Q(?:\d{2}|\d{4})?\b/i;

/** A row that makes a table one of the statements, or a breakdown of them. */
const STATEMENT_ROW = /^total (?:net )?(?:operating )?(?:revenues?|sales)$|^(?:net )?revenues?$|^net sales$|^operating (?:income|loss|profit)|^income (?:\(loss\) )?from operations|^net (?:income|earnings|loss)\b|^total (?:costs and )?(?:operating )?(?:costs and )?expenses?\b|^total assets$|^total liabilities|^net cash (?:provided|used|from)|^gross (?:profit|margin)$|^cost of (?:sales|revenues?|goods)|^income before|^(?:provision for|benefit from) income taxes|^total current (?:assets|liabilities)/i;

/** A line above a table that only says the units or the period, not what the table is about. */
const CAPTION_NOTE = /\.html?\b|^ex-\d|^exhibit \d|^\(?(?:\$|(?:(?:u\.s\. )?dollars?|amounts?|in|figures)\b).*\b(?:millions|thousands|billions)\b|^\(?unaudited\)?$|^\(?continued\)?$|^\(?in (?:millions|thousands|billions)|\bended\b|^as of\b|^table of contents$|^page \d+$|^\d{1,3}$|^(?:np|n\/m|nm)\b.*not (?:provided|meaningful)/i;

/**
 * The heading printed just above a table, where it is one: a short line, not a sentence of the text. The lines that
 * only give the units, the period or a page number are passed over; a paragraph ends the search.
 */
export function tableCaption(before: string): string | null {
  const blocks = before.split(/<\/(?:p|div|h\d|li|tr|table|caption|center)\s*>|<br\s*\/?\s*>/i).map(plain).filter((block) => /[a-z]/i.test(block));
  for (let index = blocks.length - 1, read = 0; index >= 0 && read < 4; index--, read++) {
    const block = blocks[index].replace(/\s*\(\d{1,2}\)$/, "").trim();
    if (CAPTION_NOTE.test(block) || /^(?:\d+|[a-z])\s/.test(block) && block.length > 60) continue;
    if (block.length > 90 || (/[.;:]$/.test(block) && block.split(" ").length > 6)) return null;
    if (!/[a-z]{3}/i.test(block)) continue;
    return block.replace(/[:\s]+$/, "");
  }
  return null;
}

/** A unit of volume or energy printed in a column of its own. */
const PHYSICAL_UNIT = /^(?:mb\/?d|m{0,2}boe(?:d|\/d|pd)?|m{0,2}bbls?(?:d|\/d)?|bpd|m{0,2}cf(?:e|d|\/d)?|bcfe?|mmbtus?|[kmg]whs?|mw|(?:metric )?tons|tonnes)$/i;

/** A row that states a change and nothing of what changed: "Percentage change from comparable period" under "Net sales". */
const SUBJECTLESS = /^(?:(?:f\/?x[- ]neutral|constant[- ]currency|ex-?fx)\s+)?(?:(?:y\/y|yoy|year[- ]over[- ]year)\s+)?(?:(?:percentage|percent|%)\s*)?(?:change|increase|decrease|growth|increase\s*\/\s*\(?decrease\)?)(?:\s+(?:from|over|vs\.?|versus|compared (?:to|with)|on)\b.*)?$/i;

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
  let lastEnd = 0;
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const at0 = table.index ?? 0;
    const above = tableCaption(html.slice(Math.max(lastEnd, at0 - 4000), at0));
    lastEnd = at0 + table[0].length;
    // The first heading over the labels, when the headings beside it are periods ("Walmart U.S. | Q2 FY27 | Q2 FY26").
    let headed: string | null = null;
    let figured = false;
    let lastLabel: string | null = null;
    let header: string[] = [];
    // Headings that span several columns each: "Net stores opened (closed)" over two, "Stores open as of" over two more.
    let spanning: string[] | null = null;
    let section: string | null = null;
    let sectionUnit: KpiUnit | null = null;
    let tableScale: string | null = null;
    let dollarScale = false;
    let countsScaled = false;
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
        const scaled = SCALE.exec(raw.join(" "));
        if (scaled) {
          const note = raw.join(" ");
          tableScale = scaled[1].toLowerCase();
          // Said of what comes before "except": "(In millions, except per share amounts)" scales more than dollars.
          dollarScale = /\$|dollars?\b|amounts/i.test(note.split(/\bexcept\b/i)[0]);
          // "In millions, except percentages": its counts are in millions too, unless it excepts them ("except store data").
          countsScaled = !dollarScale && !/except\b.*\b(?:stores?|units?|employees|members|data|counts?|numbers?|statistics|operating|square|locations|restaurants|customers|subscribers|accounts)\b/i.test(note);
        }
        words += ` ${raw.join(" ")}`;
        // A row of words: the columns' headings when there are several, a heading over the rows below when one.
        if (raw.length > 1) {
          header = raw; if (!spanning) spanning = raw;
          if (!figured && !headed && /[a-z]{3}/i.test(raw[0]) && raw[0].length <= 60 && !/^units?\b[\s*()\d]*$/i.test(raw[0]) && !SPAN_PERIOD.test(raw[0]) && !CAPTION_NOTE.test(raw[0]) && !NOT_THE_FIGURE.test(raw[0])
            && raw.slice(1).some((cell) => SPAN_PERIOD.test(cell))) headed = raw[0].replace(/(?:\s*\((?:\d{1,2}|[a-z])\))+$/, "");
        }
        // A heading that only names the period or the units ("Three Months Ended June 30,") is not a heading over the rows.
        else if (/[a-z]{3}/i.test(raw[0]) && raw[0].length <= 90 && !/ended|^as of|unaudited|^\(?in (?:millions|thousands)|^\(?(?:dollars|\$|amounts?) in (?:millions|thousands|billions)|^\(?(?:millions|thousands|billions)\b,? except|^(?:19|20)\d\d$|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},?(?: (?:19|20)\d\d)?$/i.test(raw[0])) { section = raw[0].replace(/:$/, "").replace(/(?:\s*\((?:\d{1,2}|[a-z])\))+$/, ""); sectionUnit = null; }
        continue;
      }
      const at = raw.findIndex((cell) => /[a-z]{3}/i.test(cell));
      if (at < 0) continue;
      figured = true;
      let printed = raw[at].replace(/(?:\s*\((?:\d{1,2}|[a-z])\))+\s*$|\s+\d$/, "").replace(/:$/, "").trim();
      // A unit printed in a column of its own beside the label ("Net Oil-Equivalent Production | MBOED | 2,077") is the label's.
      if (raw[at + 1] && PHYSICAL_UNIT.test(raw[at + 1].trim())) printed = `${printed} (${raw[at + 1].trim()})`;
      // A change with no subject is the change of the row above it.
      const label = SUBJECTLESS.test(printed) && lastLabel ? `${lastLabel}, ${/^.[a-z]/.test(printed) ? printed[0].toLowerCase() : printed[0]}${printed.slice(1)}` : printed;
      if (!SUBJECTLESS.test(printed)) lastLabel = printed;
      const caption = headed ?? above;
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
      // Columns that are each a measure of the one quarter, no period among them (Tesla: Production | Deliveries): one
      // row a measure, its single figure proven against the same measure a year before (anchorRow).
      if (headings && headings.length >= 2 && headings.every((heading) => !SPAN_PERIOD.test(heading) && !NOT_THE_FIGURE.test(heading) && /[a-z]{3}/i.test(heading))
        && headings.some((heading) => OPERATING.test(heading))) {
        headings.forEach((heading, index) => {
          const value = values[index];
          if (!value || !OPERATING.test(heading) || STATEMENT.test(heading) || ADJUSTED.test(heading)) return;
          let base = `${section ? normalise(section) : ""}|${normalise(label)}|${normalise(heading)}`;
          if (seen.has(base) && caption) base = `${normalise(caption)}~${base}`;
          const occurrence = (seen.get(base) ?? 0) + 1;
          seen.set(base, occurrence);
          rows.push({
            key: occurrence > 1 ? `${base}#${occurrence}` : base, label, section, caption, unit: rate ? "percent" : "count",
            scale: SCALE.exec(label)?.[1]?.toLowerCase() ?? null, values: [value], excluded: new Set(), financial: false,
            headings: [heading], group: heading, quarterly: false, form: "single",
          });
        });
        continue;
      }
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
      // People are counted, whatever the table's "$ in millions" says (Amazon prints its employees in that table).
      const people = (HEADCOUNT.test(label) || COUNTED.test(label)) && !rate && !currency;
      // A rate printed without its "%" (JPMorgan's delinquency rates, its net yield): every figure under a hundred.
      // Or named so by the heading above it ("30+ day delinquency rate" over "Card Services").
      // The heading's name only over a row that names no measure of its own: "PRASM (cents)" under "Passenger load factor" is not one.
      const ownMeasure = OPERATING.test(label) || PER_UNIT.test(label) || /cents|asm\b|\(|\$/i.test(label);
      const unmarkedRate = !rate && (RATE_NAME.test(label) || (section != null && RATE_NAME.test(section) && !ownMeasure)) && !/\bper\b/i.test(label) && !PRICED.test(label)
        && figures.length > 0 && figures.every((column) => Math.abs(cellNumber(column.text)?.value ?? 0) < 100);
      let unit: KpiUnit = rate || unmarkedRate ? "percent" : currency || PRICED.test(label) ? "currency" : "count";
      // In a table of amounts "in millions", a row that is neither a count nor its own scale is an amount (JPMorgan's loans).
      const amountTable = /\bin (?:millions|billions)\b/i.test(words);
      if (unit === "count" && !people && !SCALE.test(label) && amountTable && tableScale && !OPERATING_COUNT.test(label)) unit = "currency";
      // Only under a heading that is itself a measure, and only from a rate to an amount or back: a property's or a
      // region's name heads all its rows, and a "$" printed on the first row only does not change what is counted.
      // A heading over ratios ("Percentage of net sales") does not head the counts printed after them.
      if (section && sectionUnit && (unit === "percent") !== (sectionUnit === "percent") && (OPERATING.test(section) || /percent|%|\bratios?\b|\bmargins?\b/i.test(section))) section = null;
      // A statement prints its "$" on a block's first row only: the rows below it under one heading are amounts too.
      const inherited = section != null && sectionUnit === "currency" && unit === "count" && !SCALE.test(label);
      if (inherited && !people) unit = "currency";
      if (people) unit = "count";
      if (section && !sectionUnit) sectionUnit = unit;
      // "Comparable sales increase" one year, "increase/(decrease)" the next: the same row.
      const keyed = (text: string) => normalise(text).replace(/\b(?:increase|decrease|growth|change)\b|\//g, " ").replace(/\s+/g, " ").trim();
      let base = `${section ? keyed(section) : ""}|${keyed(label)}${group ? `|${keyed(group)}` : ""}`;
      // The same row in another table (Walmart prints "Transactions" for each segment): told apart by the table's caption.
      if (seen.has(base) && caption) base = `${keyed(caption)}~${base}`;
      const occurrence = (seen.get(base) ?? 0) + 1;
      seen.set(base, occurrence);
      rows.push({
        key: occurrence > 1 ? `${base}#${occurrence}` : base,
        label, section, caption, dollarScale,
        unit,
        // A table's "in millions" is said of its amounts; a count says its own scale in its label.
        // A figure per unit (RevPAR, a price per gallon) is in units, whatever the table's amounts are in.
        scale: SCALE.exec(label)?.[1]?.toLowerCase() ?? (unit === "currency" && (currency || inherited || amountTable) && !PER_UNIT.test(label) ? tableScale
          : unit === "count" && countsScaled && !PER_UNIT.test(label) ? tableScale : null),
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
export const OPERATING = new RegExp([
  "member", "subscri", "customer", "user", "account", "deliveries", "units?\\b", "unit volume", "stores?\\b", "restaurant", "locations?\\b",
  "warehouse", "clubs?\\b", "propert", "rooms?\\b", "occupanc", "revpar", "average daily rate", "\\badr\\b", "load factor", "passenger",
  "available seat", "\\basms?\\b", "\\brpms?\\b", "\\btrasm\\b", "\\bcasm", "\\brasm", "yield", "backlog", "bookings?\\b", "orders?\\b",
  "shipments?", "volume", "traffic", "transactions?\\b", "comparable", "same[- ]store", "\\bcomps?\\b", "headcount", "employees",
  "vehicles?\\b", "trips?\\b", "nights?\\b", "\\bgmv\\b", "gross merchandise", "\\barpu\\b", "\\barpa\\b", "\\barm\\b", "per (?:user|member|subscriber|customer|unit|account|paying|available|occupied|passenger|square|room)",
  "retention", "churn", "square f(?:ee|oo)t", "sq\\.? ?ft", "barrels", "\\bboe", "production", "\\bmcf", "\\bbcf", "tons?\\b", "ounces",
  "\\brigs?\\b", "wells?\\b", "beds?\\b", "admissions", "patients?", "visits", "enrollment", "\\blives\\b", "policies", "in force",
  "premiums? written", "assets under (?:management|custody|administration)", "\\baum\\b", "\\bauc\\b", "net (?:new )?flows", "clients?\\b",
  "wholesales?\\b", "people served", "members served", "case volume", "unit case", "branch(?:es)?\\b", "advisors?\\b", "impressions", "price per ad", "card sales", "payments? volume", "\\bgwh\\b", "storage deployed",
  "daily active", "monthly active", "\\bdau", "\\bmau", "\\bdap\\b", "\\bmap\\b", "\\barr\\b", "annual(?:ized)? recurring", "net (?:revenue|dollar) retention",
  "installed base", "capacity", "utili[sz]ation", "fleet", "aircraft", "units sold", "average selling price", "\\basp\\b", "price per",
  "cost per", "doors", "franchise", "systemwide", "system-wide", "net adds", "net additions", "openings?\\b", "closures?\\b", "seats?\\b",
  "advertis(?:ers|ing impressions)", "impressions", "streams", "downloads", "listings", "hosts", "riders", "drivers", "couriers", "merchants",
  "sellers", "buyers", "payment volume", "\\btpv\\b", "\\bgtv\\b", "cards?\\b", "cardholders", "contracts", "lines\\b", "connections",
  "broadband", "wireless", "postpaid", "prepaid", "homes", "closings", "deliveries", "lots\\b", "communities", "rentals?\\b", "leased",
  "occupied", "cases\\b", "procedures", "tests?\\b", "scripts", "prescriptions", "claims\\b", "loss ratio", "combined ratio", "expense ratio",
].join("|"), "i");

/** A line of the statements, or a figure about the shares, the debt or the tax, whatever table it is printed in. */
const STATEMENT = /\bgranted\b|\bvested\b|forfeit|unvested|restricted (?:stock )?units?|performance (?:share )?units?|\bfacilit(?:y|ies)\b|committed capacity|unused capacity|available capacity|\brewards?\b|marketing|business development|promotion|incentives?\b|payments? made to|price per share|per share\b|\bbuybacks?\b|repurchase|\brevenues?\b(?! per\b)|^(?:total )?(?:net )?sales\b(?! per\b)|propert(?:y|ies),? (?:plant|and equipment)|purchases? of|fees?\b|\bstock\b|\brsus?\b|awards?\b|options?\b|additions? to|acquisitions? of|proceeds|obligation|reconciliation|\brent\b|maintenance|repairs|salaries|wages|compensation|\b(?:net )?income\b|expenses?\b|\bcost of\b|\bcosts?\b(?! per\b)|\bmargin\b|earnings|\beps\b|\bprofit\b|\btax|depreciation|amortization|ebitda|\bebit\b|cash\b|\bassets\b(?! under)|liabilit|equity|\bdebt\b|borrowing|dividend|\bshares?\b|weighted|diluted|basic|interest|impairment|restructuring|\bgains?\b|\bloss(?:es)?\b(?! ratio)|provision|receivable|payable|inventor|goodwill|capital expenditure|free cash|operating activities|investing|financing|guidance|outlook|\bbps\b|effective/i;

/** Plainly operating, wherever it is printed: a figure per unit of something, a count in stated units, a rate the business is run by. */
const STRONG = /\bemployees\b|\bheadcount\b|\bper (?:available|paying|member|membership|user|subscriber|customer|unit|account|occupied|passenger|square|room|gallon|trip|order|transaction|vehicle|store|restaurant|location|daily)|\((?:in )?(?:000s|thousands|millions|billions|trillions|cents)\)|\bin (?:thousands|millions)\b|comparable|same[- ]store|occupanc|load factor|retention|churn|available seat|revpar|average daily rate|paid members|subscribers|deliveries|backlog|systemwide|system-wide|daily active|monthly active/i;
const ADJUSTED = /adjusted|non-?gaap|\bgaap measure|excluding|\bex-|-ex\b|pro forma|see note/i;

/**
 * Read wherever it is printed, statement table or not: growth at constant
 * currency or organic, which no filed statement carries, and the client
 * assets a bank or a broker runs its wealth business by.
 */
const BEYOND_STATEMENTS = /constant[- ]currency|currency[- ]neutral|f\/?x[- ]neutral|excluding (?:f\/?x|fx|foreign (?:exchange|currency)|(?:the )?(?:impact|effect)s? of (?:foreign|currency)|currency)|\borganic (?:revenue|sales|growth|net sales)|client (?:investment )?assets|assets under (?:supervision|management|custody)|remaining performance obligations?|\bc?rpo\b/i;

export const isOperating = (row: Pick<KpiRow, "label" | "section" | "financial" | "unit"> & { group?: string | null }) => {
  if (BEYOND_STATEMENTS.test(row.label) && (row.unit === "percent" || /assets|obligation/i.test(row.label))) return true;
  // A note in brackets, or a line of a reconciliation ("Less (add)", "Plus"), is not a measure.
  if (/^\(|^(?:less|add|plus|memo)\b/i.test(row.label.trim())) return false;
  // "Total" alone says nothing of what is totalled — unless a heading above its figure says (Tesla's "Total" deliveries).
  if (!row.section && !row.group && /^(?:total|other|all other|subtotal|consolidated|net)$/i.test(row.label.trim())) return false;
  if (STATEMENT.test(row.label) || ADJUSTED.test(row.label) || (row.section && (STATEMENT.test(row.section) || ADJUSTED.test(row.section)))) return false;
  // Occupancy is a rate; as an amount it is a line of costs (Chipotle's).
  if (/occupan/i.test(row.label) && row.unit !== "percent") return false;
  const measure = row.group != null && OPERATING.test(row.group);
  // In a table that prints statement lines, the row must name what it counts itself: under a heading alone it may be one of them.
  if (row.financial) return STRONG.test(row.label) || OPERATING.test(row.label) || measure;
  return OPERATING.test(row.label) || (row.section != null && OPERATING.test(row.section)) || measure;
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
  if (newer.form === "text" || newer.form === "single" || older.form === "text" || older.form === "single") return anchorStated(newer, older);
  // The period and the year before it are a row's first two figures, whichever comes first; a later column is
  // another measure under a heading this reader does not see (Starbucks: stores opened, then stores open).
  const figures = (row: KpiRow) => row.values.map((cell, index) => (cell && !row.excluded.has(index) ? index : -1)).filter((index) => index >= 0);
  const reading = (current: KpiCell, yearAgo: KpiCell, column: number): KpiReading | null => {
    // A rate moves by points, a count or an amount within a band: beyond it, a column of something else.
    if (newer.unit !== "percent" && yearAgo.value !== 0 && (current.value / yearAgo.value > 5 || current.value / yearAgo.value < 0.2)) return null;
    const heading = newer.headings?.[column] ?? null;
    const measure = newer.group ?? (heading && !PERIOD.test(heading) && !/millions|thousands|billions|dollars|unaudited|\$/i.test(heading) && /[a-z]{3}/i.test(heading) ? heading : null);
    return { key: newer.key, label: newer.label, section: newer.section, caption: newer.caption ?? null, dollarScale: newer.dollarScale, unit: newer.unit, scale: newer.scale ?? older.scale, measure, current, yearAgo };
  };
  // Five quarters or more side by side (Chipotle and the banks five, Amazon six): the year-ago quarter is four
  // columns from the newest, newest first or oldest first — and the older document prints it as its own newest.
  const newerFigures = figures(newer), olderFigures = figures(older);
  /*
   * How many of the columns are quarters: all of them where the table has no headings, else the leading ones up to
   * the first heading printed twice — JPMorgan's five quarters are followed by changes headed "2Q26" and "3Q25",
   * which are not two more quarters.
   */
  const headed = newerFigures.map((index) => newer.headings?.[index]?.trim().toLowerCase() ?? null);
  let run = newerFigures.length;
  if (headed.every((heading) => heading)) {
    const met = new Set<string>();
    run = headed.findIndex((heading) => (met.has(heading!) ? true : (met.add(heading!), false)));
    if (run < 0) run = newerFigures.length;
  }
  if (run >= 5 && olderFigures.join() === newerFigures.join()) {
    const count = run;
    const first = newerFigures[0], last = newerFigures[count - 1];
    const cell = (row: KpiRow, index: number) => row.values[index]!;
    /*
     * The year-ago quarter must be the older document's own. A figure too coarse to prove that alone (Amazon's paid
     * units, +8%) must be matched by the quarter beside it as well, which both documents print in a table of six;
     * columns past the quarters (JPMorgan's changes and nine months) are never compared.
     */
    const agree = (newestFirst: boolean) => {
      const mine = (offset: number) => newerFigures[newestFirst ? 4 + offset : count - 5 - offset];
      const theirs = (offset: number) => olderFigures[newestFirst ? offset : count - 1 - offset];
      if (mine(0) == null || !equal(cell(newer, mine(0)), cell(older, theirs(0)))) return false;
      // With six quarters or more two of them overlap, and both must agree: one small figure matches by chance too
      // easily, and read the wrong way round it would give an old quarter for the newest.
      if (count < 6 && precise(cell(older, theirs(0)), older.unit)) return true;
      const next = mine(1), beside = theirs(1);
      return next != null && beside != null && next >= 0 && equal(cell(newer, next), cell(older, beside));
    };
    const newestFirst = agree(true), oldestFirst = agree(false);
    // Both ways round: the table does not say which, and neither is taken.
    if (newestFirst && oldestFirst) return null;
    // Newest first: the quarter is the first column, the year before it the fifth.
    if (newestFirst) return reading(cell(newer, first), cell(newer, newerFigures[4]), first);
    // Oldest first: the quarter is the last column, the year before it four to its left.
    if (oldestFirst) return reading(cell(newer, last), cell(newer, newerFigures[count - 5]), last);
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

const SCALES: Record<string, number> = { thousand: 1e3, thousands: 1e3, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9, trillion: 1e12, trillions: 1e12 };
const absolute = (row: KpiRow, cell: KpiCell) => cell.value * (row.scale ? SCALES[row.scale] ?? 1 : 1);

/**
 * A figure printed without its year-ago beside it, proven against the same
 * measure in the document a year before.
 *
 * A sentence that states its change on the year proves itself: the two
 * figures must give that change, to the rounding of what is printed ("3.60
 * billion, an increase of 3%" against last year's 3.48 billion). A growth rate
 * (Meta's ad impressions, +14%) is the company's own figure each quarter, and
 * needs only to be stated again a year on. A measure under its own column
 * heading (Tesla's deliveries) must be printed finely and within a band of the
 * year before's; a moved column or a misread row fails one or the other.
 */
function anchorStated(newer: KpiRow, older: KpiRow): KpiReading | null {
  if (newer.form !== older.form) return null;
  const current = newer.values[0];
  const yearAgo = older.values[0];
  if (!current || !yearAgo) return null;
  const reading: KpiReading = { key: newer.key, label: newer.label, section: newer.section, caption: newer.caption ?? null, dollarScale: newer.dollarScale, unit: newer.unit, scale: newer.scale ?? older.scale, measure: newer.group, current, yearAgo };
  if (newer.unit === "percent") return newer.form === "text" ? reading : null;
  const now = absolute(newer, current), before = absolute(older, yearAgo);
  if (!(now > 0 && before > 0) || now / before > 5 || now / before < 0.2) return null;
  if (newer.form === "text") {
    if (newer.growth == null) return null;
    // Printed to two or three figures each side: a point and a half of slack on the stated change.
    return Math.abs((now / before - 1) * 100 - newer.growth) <= 1.5 ? { ...reading, current: { value: now / (SCALES[reading.scale ?? ""] ?? 1), decimals: current.decimals }, yearAgo: { value: before / (SCALES[reading.scale ?? ""] ?? 1), decimals: yearAgo.decimals } } : null;
  }
  return precise(current, newer.unit) && precise(yearAgo, older.unit) ? reading : null;
}

/**
 * How much a reading tells, to order a company's figures and keep the best
 * when there are more than a page holds: the measures a business is run by
 * first (comparable sales, RevPAR, members, deliveries, daily users), then
 * growth at constant currency and other operating figures, then the rest.
 */
export function kpiRank(reading: Pick<KpiReading, "label" | "section" | "measure" | "unit">): number {
  const name = `${reading.section ?? ""} ${reading.label} ${reading.measure ?? ""}`;
  if (STRONG.test(name) || /revpar|daily active|monthly active|paid members|subscribers|deliveries|comparable|same[- ]store|load factor|occupanc|backlog|\bc?rpo\b/i.test(name)) return 0;
  if (BEYOND_STATEMENTS.test(name) || OPERATING.test(reading.label)) return 1;
  return 2;
}

/* --- Figures stated in sentences ------------------------------------------ */

const NUMBER = String.raw`(\$)?\s?(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion)?`;
/** "<Name> – <subject> was 3.60 billion …, an increase of 3% year-over-year" and its kin. */
const LEVEL = new RegExp(String.raw`^(?:([A-Z][\w ()&,'/.-]{2,80}?)\s+[–—-]\s+)?([A-Z][\w ()&,'/.-]{1,100}?)\s+(?:was|were|totaled|totalled|reached|stood at|grew to|increased to|decreased to|declined to)\s+(?:approximately |about |nearly |over |more than |a record )?${NUMBER}\b(.*)$`);
const RATE = new RegExp(String.raw`^(?:([A-Z][\w ()&,'/.-]{2,80}?)\s+[–—-]\s+)?([A-Z][\w ()&,'/.-]{1,140}?)\s+(increased|decreased|grew|declined|rose|fell)\s+(?:by\s+)?(\d+(?:\.\d+)?)%(\s*\((?:up|down) (\d+(?:\.\d+)?)% in constant currency\))?`);
/** A line of business's revenue by its own name ("Azure and other cloud services revenue"), not revenue alone. */
const NAMED_REVENUE = /^(?!(?:total |net |our |the )?revenues?\b)[A-Z][\w ()&,'/.-]{2,80}\s(?:revenues?|sales)$/;
const CHANGE = /\b(?:an? )?(increase|decrease|growth|decline|rise|fall) of (\d+(?:\.\d+)?)%\s*(?:year-over-year|year over year|y\/y|from|compared|versus|vs\.?)|\b(up|down) (\d+(?:\.\d+)?)%\s*(?:year-over-year|year over year|y\/y)|\brepresenting (\d+(?:\.\d+)?)% (?:year-over-year )?(growth|decline)/i;
/** "Current remaining performance obligations ("cRPO") of $24.3 billion, representing 21% year-over-year growth" (ServiceNow). */
const STATED_OF = new RegExp(String.raw`^(?:([A-Z][\w ()&,'/.-]{2,80}?)\s+[–—-]\s+)?([A-Z][\w ()&,'"/.-]{1,120}?)\s+of\s+${NUMBER}\b(.*)$`);
const CONSTANT = /^(?:([A-Z][\w ()&,'/.-]{2,80}?)\s+[–—-]\s+)?([A-Z][\w ()&,'/.-]{1,60}?) on a constant currency basis would have (increased|decreased) (?:by )?(\d+(?:\.\d+)?)%/;

/**
 * The figures a release states in its sentences rather than its tables, the
 * operating ones only (Meta: daily active people, ad impressions, average
 * price per ad, headcount; its revenue at constant currency). Each becomes a
 * row of one figure, keyed by what it measures, for anchorStated to prove
 * against the year before.
 */
export function kpiSentences(html: string): KpiRow[] {
  const text = plain(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<\/(?:p|div|li|td|tr|h\d)>/gi, " ¶ ")).replace(/[•●▪]/g, " ¶ ");
  const rows: KpiRow[] = [];
  const seen = new Set<string>();
  const add = (name: string, unit: KpiUnit, cell: KpiCell, scale: string | null, growth: number | null, measure: string | null) => {
    // "P ostpaid ARPA": a capital split from its word by the release's markup.
    const label = name.replace(/\s+/g, " ").replace(/\b([A-Z]) (?=[a-z]{2,})/g, "$1").replace(/^(?:our|the|total)\s+/i, "").trim();
    // Revenue as a whole, or its growth, is the statements' own figure.
    // (At constant currency it is not: no statement carries that.)
    if (measure !== "Growth at constant currency" && /^(?:consolidated |total |net |company |reported )*(?:net )?(?:revenues?|sales)$/i.test(label)) return;
    const key = `text|${normalise(label)}|${measure ? normalise(measure) : ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ key, label: label[0].toUpperCase() + label.slice(1), section: null, unit, scale, values: [cell], excluded: new Set(), financial: false, headings: null, group: measure, quarterly: false, form: "text", growth });
  };
  for (const piece of text.split(/¶|(?<=[a-z0-9)%][.;])\s+(?=[A-Z])/)) {
    const sentence = piece.replace(/\s+/g, " ").trim();
    if (sentence.length < 12 || sentence.length > 400) continue;
    const constant = CONSTANT.exec(sentence);
    if (constant) {
      const name = constant[2];
      const value = Number(constant[4]) * (constant[3] === "decreased" ? -1 : 1);
      add(`${name}`, "percent", { value, decimals: constant[4].includes(".") ? 1 : 0 }, null, null, "Growth at constant currency");
      continue;
    }
    const rate = RATE.exec(sentence);
    if (rate) {
      const name = (rate[1] && rate[1].length <= 60 ? rate[1] : rate[2]).trim();
      // An operating measure's growth, or a line of business's revenue growth (Microsoft's Azure), which no statement carries.
      const business = NAMED_REVENUE.test(name);
      if (!(business || (OPERATING.test(name) && !STATEMENT.test(name))) || ADJUSTED.test(name)) continue;
      const sign = /decreased|declined|fell/.test(rate[3]) ? -1 : 1;
      add(name, "percent", { value: Number(rate[4]) * sign, decimals: rate[4].includes(".") ? 1 : 0 }, null, null, "Growth on the year");
      if (rate[6]) add(name, "percent", { value: Number(rate[6]) * (/down/.test(rate[5]) ? -1 : 1), decimals: rate[6].includes(".") ? 1 : 0 }, null, null, "Growth at constant currency");
      continue;
    }
    let level = LEVEL.exec(sentence);
    // "… of $24.3 billion, representing 21% growth": a figure introduced by "of", with its change on the year.
    if (!level) {
      const stated = STATED_OF.exec(sentence);
      if (stated && /representing \d/.test(stated[6] ?? "") && (BEYOND_STATEMENTS.test(stated[2]) || OPERATING.test(stated[2]))) level = stated;
    }
    if (!level) continue;
    const name = level[1] ?? level[2];
    const subject = level[2];
    // A count or a figure per unit, never an amount of the statements.
    const beyond = BEYOND_STATEMENTS.test(name) || BEYOND_STATEMENTS.test(subject);
    if (!beyond && (!(OPERATING.test(name) || OPERATING.test(subject)) || STATEMENT.test(name) || ADJUSTED.test(name) || STATEMENT.test(subject))) continue;
    const digits = level[4].replace(/,/g, "");
    const value = Number(digits);
    if (!Number.isFinite(value) || value <= 0) continue;
    const change = CHANGE.exec(level[6] ?? "");
    const growth = change ? Number(change[2] ?? change[4] ?? change[5]) * (/decrease|decline|fall|down/i.test(change[1] ?? change[3] ?? change[6] ?? "") ? -1 : 1) : null;
    const scale = level[5] ? `${level[5]}s` : null;
    add(name, level[3] || PRICED.test(name) ? "currency" : "count", { value, decimals: digits.includes(".") ? digits.length - digits.indexOf(".") - 1 : 0 }, scale, growth, null);
  }
  return rows;
}

/** Every operating row of the newer document that the older one, a year before, proves. */
export function anchorDocuments(newer: KpiRow[], older: KpiRow[]): KpiReading[] {
  const byKey = new Map(older.map((row) => [row.key, row]));
  const readings: KpiReading[] = [];
  const printed = new Set<string>();
  for (const row of newer) {
    // A row printed twice under one heading is two measures this reader cannot tell apart (a quarter, then six months).
    // A sentence was read as an operating figure already (kpiSentences); its name may be a statement line's (revenue at constant currency).
    if (row.key.includes("#") || (row.form !== "text" && !isOperating(row))) continue;
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
