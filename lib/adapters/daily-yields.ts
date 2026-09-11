/**
 * Government yields from the institutions that publish them, once a day.
 *
 * Yahoo quotes the four US Treasury yields as instruments and carries nothing
 * for any other government: every ticker that looks like a Bund, a gilt or a
 * JGB resolves to something else or to nothing. So everywhere else the source
 * is the central bank or finance ministry that strikes the number itself, read
 * in whatever form it publishes — six formats for seven feeds, because no two
 * of them agree on what a date looks like.
 *
 * What they have in common is the thing that matters on screen: each is struck
 * once a business day, and each is published some hours or a day after the
 * fact. That is stated beside every figure rather than smoothed over — a
 * reading dated yesterday sitting unlabelled in a row of live ones is exactly
 * the silent substitution this application does not make.
 *
 * Every feed comes back as the same thing: dated observations, oldest first,
 * reaching back far enough to draw five years. What a chart or a strip does
 * with them is the same code whichever bank they came from.
 */

import { readZipEntry, readZipText } from "../zip";
import type { MarketRange, MarketWindow } from "./intraday";

export interface Observation {
  /** ISO date the reading was struck for. */
  date: string;
  /** Per cent a year, as the publisher states it. */
  value: number;
}

export type DailyFeed =
  /** The ECB's euro-area yield curve (AAA-rated, Svensson fit). */
  | { kind: "ecb"; key: string }
  /** The Bundesbank's curve for listed Federal securities (Svensson fit). */
  | { kind: "bundesbank"; key: string }
  /**
   * The Bank of England's nominal spot curve, at a maturity in years.
   *
   * Read from the spreadsheet the Bank publishes each day rather than from its
   * statistical database, which answers a machine only for the last few weeks
   * and returns a server error for anything older. The spreadsheet holds the
   * current month alone, so this feed keeps what it has read — see
   * `recentOnly` below.
   */
  | { kind: "boe"; maturity: string }
  /** Japan's Ministry of Finance, constant-maturity JGB yields. */
  | { kind: "mof"; tenor: string }
  /** Banco de España's secondary-market government bond yields. */
  | { kind: "bde"; series: string }
  /** The Bank of Canada's Valet API. */
  | { kind: "boc"; series: string }
  /** The Reserve Bank of Australia's statistical table F2. */
  | { kind: "rba"; series: string };

/**
 * Why a single session cannot be drawn, in the words the panel shows.
 *
 * A refusal rather than an error: nothing has gone wrong upstream, the series
 * simply does not exist at that resolution. Named here so the route can say it
 * before spending a request finding out.
 */
export const DAILY_NO_INTRADAY = "This yield is published once a day, so there is no line inside a single session. Choose a longer window.";

/** Whether a window has enough readings in it to be a line. */
export const drawsDaily = (range: MarketRange) => range !== "1D";

/* --- Reading the formats -------------------------------------------------- */

/**
 * One CSV line, split on commas outside quotes, quotes removed.
 *
 * Every publisher here quotes some fields and not others, and two of them put
 * commas inside quoted descriptions. Splitting on every comma would shift a
 * description across three columns and a value onto the wrong heading.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell); cell = "";
    } else cell += character;
  }
  cells.push(cell);
  return cells.map((each) => each.trim());
}

const lines = (text: string) => text.replace(/^\uFEFF/, "").split(/\r?\n/);

/**
 * A published figure, or nothing.
 *
 * Every publisher has its own way of saying "no reading": a full stop, an
 * underscore, a dash, an empty field. None of them is a zero, and `Number("")`
 * is — which is how a holiday becomes a yield of nought per cent.
 */
function reading(raw: string | undefined): number | null {
  const text = raw?.trim();
  if (!text || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (year: number, month: number, day: number) =>
  year > 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${year}-${pad(month)}-${pad(day)}` : null;

const ENGLISH_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SPANISH_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "03 Aug 2026", "09-Sep-2026", "09 SEP 2026" — a day, a month word, a year. */
function wordDate(text: string, months: string[]) {
  const match = /^(\d{1,2})[ -]([A-Za-z]{3})[ -](\d{4})$/.exec(text.trim());
  if (!match) return null;
  const month = months.indexOf(match[2].toLowerCase()) + 1;
  return iso(Number(match[3]), month, Number(match[1]));
}

const sorted = (observations: Observation[]) => {
  // Oldest first, one reading per date. A merge of two files can overlap by a
  // day; the later file is the later word on it.
  const byDate = new Map<string, number>();
  for (const observation of observations) byDate.set(observation.date, observation.value);
  return [...byDate].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * The column a header names, in a table whose first row is headers.
 *
 * Found by name rather than by position everywhere. A column added or removed
 * upstream would otherwise shift a positional read onto the wrong field — the
 * failure that looks like data rather than like an error.
 */
function column(header: string[], name: string) {
  return header.findIndex((cell) => cell.toUpperCase() === name.toUpperCase());
}

/** The ECB's SDMX CSV: `TIME_PERIOD` and `OBS_VALUE` columns, ISO dates. */
export function parseEcbCsv(text: string): Observation[] {
  const rows = lines(text).filter(Boolean).map(splitCsvLine);
  if (rows.length < 2) return [];
  const when = column(rows[0], "TIME_PERIOD");
  const what = column(rows[0], "OBS_VALUE");
  if (when < 0 || what < 0) return [];
  const out: Observation[] = [];
  for (const row of rows.slice(1)) {
    const value = reading(row[what]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(row[when] ?? "") && value != null) out.push({ date: row[when], value });
  }
  return sorted(out);
}

/** The Bundesbank's CSV: nine lines of metadata, then `date,value,flag`, "." for none. */
export function parseBundesbankCsv(text: string): Observation[] {
  const out: Observation[] = [];
  for (const line of lines(text)) {
    const row = splitCsvLine(line);
    const value = reading(row[1]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(row[0] ?? "") && value != null) out.push({ date: row[0], value });
  }
  return sorted(out);
}

/** Japan's Ministry of Finance: a title line, then `Date,1Y,2Y…`, dates written "2026/9/10". */
export function parseMofCsv(text: string, tenor: string): Observation[] {
  const rows = lines(text).map(splitCsvLine);
  const headerAt = rows.findIndex((row) => row[0] === "Date");
  if (headerAt < 0) return [];
  const what = column(rows[headerAt], tenor);
  if (what < 0) return [];
  const out: Observation[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(row[0] ?? "");
    const date = match ? iso(Number(match[1]), Number(match[2]), Number(match[3])) : null;
    const value = reading(row[what]);
    if (date && value != null) out.push({ date, value });
  }
  return sorted(out);
}

/** Banco de España: series codes in the first row, dates written "09 SEP 2026", "_" for none. */
export function parseBdeCsv(text: string, series: string): Observation[] {
  const rows = lines(text).map(splitCsvLine);
  const what = rows.length ? column(rows[0], series) : -1;
  if (what < 0) return [];
  const out: Observation[] = [];
  for (const row of rows.slice(1)) {
    const date = wordDate(row[0] ?? "", SPANISH_MONTHS);
    const value = reading(row[what]);
    if (date && value != null) out.push({ date, value });
  }
  return sorted(out);
}

/** The Bank of Canada's Valet JSON: `observations[].d` and `observations[][series].v`. */
export function parseBocJson(payload: unknown, series: string): Observation[] {
  const observations = (payload as { observations?: Array<Record<string, unknown>> })?.observations;
  if (!Array.isArray(observations)) return [];
  const out: Observation[] = [];
  for (const row of observations) {
    const date = typeof row.d === "string" ? row.d : "";
    const value = reading((row[series] as { v?: string } | undefined)?.v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && value != null) out.push({ date, value });
  }
  return sorted(out);
}

/** The RBA's table F2: metadata rows, a `Series ID` row naming the columns, dates written "09-Sep-2026". */
export function parseRbaCsv(text: string, series: string): Observation[] {
  const rows = lines(text).map(splitCsvLine);
  const ids = rows.find((row) => row[0] === "Series ID");
  const what = ids ? column(ids, series) : -1;
  if (what < 0) return [];
  const out: Observation[] = [];
  for (const row of rows) {
    const date = wordDate(row[0] ?? "", ENGLISH_MONTHS);
    const value = reading(row[what]);
    if (date && value != null) out.push({ date, value });
  }
  return sorted(out);
}

/** An Excel serial day as an ISO date: day nought is the thirtieth of December 1899. */
function excelDate(serial: number) {
  if (!(serial > 20_000 && serial < 80_000)) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

const unescapeXml = (text: string) => text
  .replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * The Bank of England's spot-curve worksheet: one maturity, every dated row.
 *
 * The sheet is laid out for a person: a title, a row of maturities in years
 * headed "years:", then one row per business day with the date as an Excel
 * serial in the first column. The maturity row is found by its label and the
 * column by its heading, so a sheet with an extra row of notes above, or a
 * half-year added to the curve, still reads the ten-year column and not its
 * neighbour.
 */
export function parseBoeSpotSheet(sheetXml: string, sharedStringsXml: string | null, maturity: string): Observation[] {
  const strings = sharedStringsXml ? [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => unescapeXml(match[1])) : [];
  const rows = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells = new Map<string, string>();
    for (const cell of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const raw = /<v>([\s\S]*?)<\/v>/.exec(cell[3] ?? "")?.[1];
      if (raw == null) continue;
      if (/\bt="e"/.test(cell[2])) continue;
      cells.set(cell[1], /\bt="s"/.test(cell[2]) ? strings[Number(raw)] ?? "" : raw);
    }
    return cells;
  });

  const heading = rows.find((cells) => cells.get("A")?.trim().toLowerCase() === "years:");
  const wanted = Number(maturity);
  const at = heading ? [...heading].find(([letter, value]) => letter !== "A" && Number(value) === wanted)?.[0] : undefined;
  if (!at) return [];

  const out: Observation[] = [];
  for (const cells of rows) {
    const date = excelDate(Number(cells.get("A")));
    const value = reading(cells.get(at));
    if (date && value != null) out.push({ date, value });
  }
  return sorted(out);
}

const asBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/**
 * The worksheet a workbook names, found the way a spreadsheet program finds it.
 *
 * The workbook lists sheets by name and relationship id; its relationships file
 * maps each id to a path. Guessing `sheet5.xml` from the order the tabs appear
 * in would read the forward curve the day the Bank adds a tab in front of it.
 */
async function worksheet(xlsx: ArrayBuffer, isWanted: (name: string) => boolean) {
  const workbook = await readZipText(xlsx, (name) => name === "xl/workbook.xml");
  const relations = await readZipText(xlsx, (name) => name === "xl/_rels/workbook.xml.rels");
  if (!workbook || !relations) return null;
  const sheet = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((tag) => ({
    name: unescapeXml(/\bname="([^"]*)"/.exec(tag[0])?.[1] ?? ""),
    id: /\br:id="([^"]*)"/.exec(tag[0])?.[1],
  })).find((each) => isWanted(each.name));
  if (!sheet?.id) return null;
  const target = [...relations.matchAll(/<Relationship\b[^>]*>/g)]
    .map((tag) => ({ id: /\bId="([^"]*)"/.exec(tag[0])?.[1], target: /\bTarget="([^"]*)"/.exec(tag[0])?.[1] }))
    .find((each) => each.id === sheet.id)?.target;
  if (!target) return null;
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  return readZipText(xlsx, (name) => name === path);
}

/* --- Fetching ------------------------------------------------------------- */

/** Some publishers refuse a request with no agent; every one of them accepts an honest one. */
const HEADERS = { "User-Agent": "FinScope/1.0 (+https://finscope-financial-research.leoalaplage.workers.dev)" };

/** How much history each feed is asked for: five years to draw, and a month of margin. */
export function historyStart(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear() - 5, now.getUTCMonth() - 1, 1));
  return start.toISOString().slice(0, 10);
}

async function text(url: string, what: string) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${what} returned ${response.status}.`);
  return response.text();
}

/**
 * Whether a feed publishes only its latest stretch rather than its history.
 *
 * The Bank of England's spreadsheet holds the current month and nothing else.
 * What it has shown is kept as it is read, so the series grows a day at a time
 * rather than forgetting last month on the first of this one; a window the
 * kept series does not yet reach is refused rather than drawn short.
 */
export const recentOnly = (feed: DailyFeed) => feed.kind === "boe";

/**
 * Five years of one feed, oldest first.
 *
 * Two publishers put history and the current month in different files — the
 * Ministry of Finance keeps everything up to last month in one and this month
 * in another — so those two are read together and merged. The others answer a
 * start date directly, or publish one file small enough to read whole.
 */
export async function readDailyYields(feed: DailyFeed, since = historyStart()): Promise<Observation[]> {
  let observations: Observation[];
  switch (feed.kind) {
    case "ecb":
      observations = parseEcbCsv(await text(
        `https://data-api.ecb.europa.eu/service/data/YC/${feed.key}?format=csvdata&detail=dataonly&startPeriod=${since}`, "The ECB data portal"));
      break;
    case "bundesbank":
      observations = parseBundesbankCsv(await text(
        `https://api.statistiken.bundesbank.de/rest/data/BBSIS/${feed.key}?format=csv&lang=en&startPeriod=${since}`, "The Bundesbank"));
      break;
    case "boe": {
      const response = await fetch("https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/latest-yield-curve-data.zip", { headers: HEADERS });
      if (!response.ok) throw new Error(`The Bank of England returned ${response.status}.`);
      const workbook = await readZipEntry(await response.arrayBuffer(), (name) => /nominal daily data current month\.xlsx$/i.test(name));
      if (!workbook) throw new Error("The Bank of England's archive no longer carries the nominal curve under the name it had.");
      const book = asBuffer(workbook);
      const [sheet, strings] = await Promise.all([
        worksheet(book, (name) => /spot curve/i.test(name) && !/short/i.test(name)),
        readZipText(book, (name) => name === "xl/sharedStrings.xml"),
      ]);
      if (!sheet) throw new Error("The Bank of England's workbook no longer has a spot-curve sheet.");
      observations = parseBoeSpotSheet(sheet, strings, feed.maturity);
      break;
    }
    case "mof": {
      const base = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate";
      const [history, current] = await Promise.all([
        text(`${base}/historical/jgbcme_all.csv`, "Japan's Ministry of Finance"),
        text(`${base}/jgbcme.csv`, "Japan's Ministry of Finance"),
      ]);
      observations = sorted([...parseMofCsv(history, feed.tenor), ...parseMofCsv(current, feed.tenor)]);
      break;
    }
    case "bde":
      observations = parseBdeCsv(await text(
        "https://www.bde.es/webbe/es/estadisticas/compartido/datos/csv/ti_1_3.csv", "Banco de España"), feed.series);
      break;
    case "boc": {
      const response = await fetch(`https://www.bankofcanada.ca/valet/observations/${feed.series}/json?start_date=${since}`, { headers: HEADERS });
      if (!response.ok) throw new Error(`The Bank of Canada returned ${response.status}.`);
      observations = parseBocJson(await response.json(), feed.series);
      break;
    }
    case "rba":
      observations = parseRbaCsv(await text(
        "https://www.rba.gov.au/statistics/tables/csv/f2-data.csv", "The Reserve Bank of Australia"), feed.series);
      break;
  }
  const kept = observations.filter((observation) => observation.date >= since);
  if (!kept.length) throw new Error("The publisher returned no readings for this series.");
  return kept;
}

/* --- What a strip and a chart need ---------------------------------------- */

/** The latest reading and the one before it, which is all a figure needs. */
export function latestReading(observations: Observation[]) {
  const last = observations.at(-1);
  if (!last) return null;
  const before = observations.at(-2);
  return { rate: last.value, previous: before?.value ?? null, date: last.date };
}

/** Noon UTC on a published date, which is a stamp rather than a claim about a time. */
const stamp = (date: string) => Math.floor(Date.parse(`${date}T12:00:00Z`) / 1_000);

/** The date a calendar window opens, counted back from the last reading. */
function opening(last: string, range: MarketRange) {
  const [year, month, day] = last.split("-").map(Number);
  const back = { "1M": [0, 1], "6M": [0, 6], "1Y": [1, 0], "5Y": [5, 0] }[range as "1M"];
  if (!back) return null;
  return new Date(Date.UTC(year - back[0], month - 1 - back[1], day)).toISOString().slice(0, 10);
}

/**
 * One series over a chosen window, in the shape the index panels already draw.
 *
 * Returning a `MarketWindow` rather than a shape of its own is what lets a
 * gilt open in exactly the same panel as an oil price and an equity index.
 *
 * The window is measured from the last reading before it opened, which is what
 * "over the past month" means — the dashed line is where the yield stood a
 * month ago, and a month ago is not the first point of the month. Counted in
 * calendar time rather than in readings, because Tokyo and London do not keep
 * the same holidays and "a month" should be the same month on both panels.
 * Five sessions is the exception and is counted in sessions, as it is for
 * every other panel on the page.
 */
export function dailyWindow(observations: Observation[], name: string, range: MarketRange, symbol: string): MarketWindow {
  if (!drawsDaily(range)) throw new Error(DAILY_NO_INTRADAY);
  const last = observations.at(-1);
  if (!last) throw new Error("The publisher returned no readings for this series.");

  let drawn: Observation[];
  let base: Observation | undefined;
  if (range === "5D") {
    drawn = observations.slice(-5);
    base = observations.at(-6);
  } else {
    const from = opening(last.date, range)!;
    drawn = observations.filter((observation) => observation.date > from);
    base = observations.filter((observation) => observation.date <= from).at(-1);
  }
  /*
   * A window the series does not reach is refused, not drawn short.
   *
   * A line that covers seven weeks under a "1Y" heading would put a year's
   * label on seven weeks' move, and the headline change beside it would be a
   * figure for a period nobody asked about. Only a series that publishes its
   * latest stretch alone can get here; the reader is told how far it goes.
   */
  if (!base) {
    throw new Error(`This series reaches back only to ${observations[0].date}, so a ${range} window cannot be drawn yet.`);
  }
  const baseline = base.value;
  const points = drawn.map((observation) => ({ time: stamp(observation.date), label: observation.date, close: observation.value }));
  const lastValue = points.at(-1)?.close ?? null;

  return {
    symbol,
    name,
    // Nothing on the panel reads this, and a yield is not priced in anything.
    currency: "",
    timezone: "UTC",
    range,
    points,
    baseline,
    last: lastValue,
    change: lastValue != null && baseline != null ? lastValue - baseline : null,
    changePercent: lastValue != null && baseline != null && baseline !== 0 ? (lastValue - baseline) / baseline : null,
    // A published curve does not trade, so it is never open.
    open: false,
    asOf: stamp(last.date),
    sessionDate: last.date,
  };
}
