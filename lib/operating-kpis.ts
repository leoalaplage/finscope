import { anchorDocuments, isOperating, kpiRank, kpiRows, kpiSentences, normalise, type KpiCell, type KpiReading, type KpiRow, type KpiUnit } from "./adapters/kpi-tables";
import { releaseDocuments } from "./adapters/earnings-release";
import { secFetch } from "./adapters/sec-fetch";
import { describeKpi } from "./kpi-names";
import { cachedJson } from "./market-cache";
import { datasetCache } from "./runtime-env";

/**
 * KPI: what a company runs itself by — members, deliveries, restaurants,
 * passengers, RevPAR, comparable sales — quarter by quarter, read from its
 * earnings releases (8-K, Item 2.02) and its 10-Qs and proven document
 * against document a year apart (lib/adapters/kpi-tables.ts).
 *
 * The newest quarter comes from the release the day it is filed, weeks before
 * the 10-Q; it is marked as such until the 10-Q is filed. A figure two
 * readings disagree on is left out. A series is shown only once two
 * different years have proven it, so a row that happened to repeat a number
 * once is not taken for a measure.
 */

const SEC_AGENT = () => process.env.SEC_USER_AGENT || "Tenqay research application contact@example.com";
const DAY = 86_400_000;
/** Ten years of quarters, as far as the documents still print the same rows: the releases and 10-Qs of each. */
const RELEASES = 40;
const QUARTERLIES = 30;
const YEARS_BACK = 10;
const MAX_SERIES = 24;

export type KpiSource = "release" | "10-Q";

export interface KpiFiling { accession: string; filed: string; /** The filing's folder on EDGAR. */ base: string; primary: string | null }

export interface KpiDocument {
  /** The first filing's, which names the document. */
  accession: string;
  form: KpiSource;
  filed: string;
  /** The quarter the document reports. */
  end: string;
  /**
   * The filings read as one: a 10-Q, or the quarter's releases — two at most,
   * the first and the last, since a company that publishes its month's sales
   * under Item 2.02 (Costco) files its results under it too.
   */
  filings: KpiFiling[];
}

export interface KpiPoint { end: string; value: number; decimals: number; source: KpiSource; url: string; filed: string; early: boolean }

export interface OperatingKpi {
  id: string;
  /** What it measures, whose and on what basis, put together from what the company prints (lib/kpi-names.ts). */
  name: string;
  unit: KpiUnit;
  scale: string | null;
  /** After the figure: what a count counts ("stores", "sq ft") or the unit of a price ("¢"). Absent from older readings. */
  suffix?: string | null;
  points: KpiPoint[];
}

export interface OperatingKpis {
  cik: string;
  builtAt: string;
  kpis: OperatingKpi[];
  documents: number;
  /** Documents EDGAR did not hand over this time. */
  unread: number;
  /** The newest quarter's release, read before its 10-Q, where there is one. */
  early: { end: string; filed: string; url: string } | null;
}

interface Recent { form: string[]; filingDate: string[]; reportDate: string[]; accessionNumber: string[]; items?: string[]; primaryDocument?: string[] }

/** An older page of the filer's index added after the recent one, filing by filing. */
export function appendFilings(recent: Recent, page: Partial<Recent>): void {
  const count = page.accessionNumber?.length ?? 0;
  for (let index = 0; index < count; index++) {
    recent.form.push(page.form?.[index] ?? ""); recent.filingDate.push(page.filingDate?.[index] ?? ""); recent.reportDate.push(page.reportDate?.[index] ?? "");
    recent.accessionNumber.push(page.accessionNumber![index]); recent.items?.push(page.items?.[index] ?? ""); recent.primaryDocument?.push(page.primaryDocument?.[index] ?? "");
  }
}

/**
 * The index's recent page holds a year or a thousand filings: three years for Walmart, whose officers file Form 4s
 * all year. Its older pages, newest first, are read until ten years are covered.
 */
async function withOlderFilings(recent: Recent, files: Array<{ name: string }>): Promise<void> {
  const horizon = iso(Date.now() - YEARS_BACK * 365.25 * DAY);
  for (const file of files.slice(0, 4)) {
    const oldest = recent.filingDate.reduce((earliest, date) => (date && date < earliest ? date : earliest), "9999");
    if (oldest <= horizon) return;
    try {
      const response = await secFetch(`https://data.sec.gov/submissions/${file.name}`, { headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" } });
      if (!response.ok) { await response.body?.cancel(); return; }
      appendFilings(recent, await response.json() as Partial<Recent>);
    } catch { return; }
  }
}

const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const days = (later: string, earlier: string) => (Date.parse(later) - Date.parse(earlier)) / DAY;

/** The quarter after the last one filed: three calendar months on from a month's end, thirteen weeks from any other day. */
export function nextQuarterEnd(end: string): string {
  const date = new Date(`${end}T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate() === date.getUTCDate();
  if (!monthEnd) return iso(date.getTime() + 91 * DAY);
  return iso(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 4, 0));
}

/**
 * The documents to read: a quarter's releases — filed from five days to a
 * hundred after its end (Delta reports in nine) — and the 10-Qs.
 */
export function kpiDocuments(recent: Recent, cik: string): KpiDocument[] {
  const base = (accession: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/`;
  const ends = [...new Set(recent.form.flatMap((form, index) => ((form === "10-Q" || form === "10-K") && recent.reportDate[index] ? [recent.reportDate[index]] : [])))].sort().reverse();
  if (!ends.length) return [];
  // The quarters a release can report: those filed, the one after the last, and the same quarters one and two years
  // back for a filer whose index of recent filings reaches less than two years (JPMorgan files 26,000 a year).
  const yearBack = (end: string, years: number) => {
    const date = new Date(`${end}T00:00:00Z`);
    const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate() === date.getUTCDate();
    return monthEnd ? iso(Date.UTC(date.getUTCFullYear() - years, date.getUTCMonth() + 1, 0)) : iso(date.getTime() - years * 364 * DAY);
  };
  const known = [...new Set([nextQuarterEnd(ends[0]), ...ends, ...ends.flatMap((end) => [yearBack(end, 1), yearBack(end, 2)])])].sort().reverse();
  const quarterlies: KpiDocument[] = [];
  const releases = new Map<string, KpiFiling[]>();
  for (let index = 0; index < recent.form.length; index++) {
    const form = recent.form[index];
    const accession = recent.accessionNumber[index];
    const filed = recent.filingDate[index];
    if (!accession || !filed) continue;
    const filing: KpiFiling = { accession, filed, base: base(accession), primary: recent.primaryDocument?.[index] || null };
    if (form === "10-Q" && recent.reportDate[index] && quarterlies.length < QUARTERLIES) {
      quarterlies.push({ accession, form: "10-Q", filed, end: recent.reportDate[index], filings: [filing] });
    }
    if (form !== "8-K" || !(recent.items?.[index] ?? "").split(",").map((item) => item.trim()).includes("2.02")) continue;
    const end = known.find((candidate) => days(filed, candidate) >= 5 && days(filed, candidate) <= 100);
    if (!end) continue;
    const held = releases.get(end) ?? [];
    releases.set(end, [...held, filing]);
  }
  const quarters = [...releases.entries()].sort((left, right) => right[0].localeCompare(left[0])).slice(0, RELEASES);
  return [
    ...quarters.map(([end, filings]): KpiDocument => {
      // The index runs newest first: the quarter's first release is the last met, its latest the first.
      const chosen = filings.length > 1 ? [filings.at(-1)!, filings[0]] : filings;
      return { accession: chosen[0].accession, form: "release", filed: chosen[0].filed, end, filings: chosen };
    }),
    ...quarterlies,
  ];
}

/** Each document with the one a year before it, of the same kind. */
export function yearApart(documents: KpiDocument[]): Array<[KpiDocument, KpiDocument]> {
  const pairs: Array<[KpiDocument, KpiDocument]> = [];
  for (const newer of documents) {
    const older = documents.find((candidate) => candidate.form === newer.form && Math.abs(days(newer.end, candidate.end) - 365) <= 20);
    if (older) pairs.push([newer, older]);
  }
  return pairs;
}

/**
 * A year to date read as quarters: within each fiscal year, every quarter
 * forty per cent and more above the one before (six months on three, nine on
 * six), at least twice.
 */
export function yearToDate(points: Map<string, KpiPoint>): boolean {
  const sorted = [...points.values()].sort((left, right) => left.end.localeCompare(right.end));
  let steps = 0;
  for (let index = 1; index < sorted.length; index++) {
    const gap = days(sorted[index].end, sorted[index - 1].end);
    if (gap < 80 || gap > 100) continue;
    const before = sorted[index - 1].value, after = sorted[index].value;
    if (!(before > 0 && after > 0)) return false;
    if (after / before < 1.4) return false;
    steps++;
  }
  return steps >= 2;
}

interface Building { family: KpiSource; reading: KpiReading; points: Map<string, KpiPoint>; disputed: Set<string>; proofs: Set<string> }

/**
 * Pure: the proven rows of every pair, as series. A quarter two readings give
 * different figures for is dropped from its series; a series proven by fewer
 * than two different years is dropped; two series that are the same figures
 * under two names (a release's "TRASM", a 10-Q's "Total revenue per available
 * seat mile") are one.
 */
export function assembleKpis(pairs: Array<{ newer: KpiDocument; older: KpiDocument; readings: KpiReading[]; url: (document: KpiDocument) => string }>, filedEnds: Set<string>): OperatingKpi[] {
  const series = new Map<string, Building>();
  // Read before its 10-Q: a quarter after the last one filed. One the filer's index no longer reaches (JPMorgan's,
  // a year deep) was filed long ago, whether or not the index still lists it.
  const lastFiled = [...filedEnds].sort().at(-1) ?? "";
  for (const { newer, older, readings, url } of pairs) {
    for (const reading of readings) {
      const id = `${newer.form}|${reading.key}|${reading.measure ?? ""}`;
      const entry = series.get(id) ?? { family: newer.form, reading, points: new Map(), disputed: new Set(), proofs: new Set() };
      series.set(id, entry);
      entry.proofs.add(newer.end);
      const add = (document: KpiDocument, cell: KpiCell) => {
        if (entry.disputed.has(document.end)) return;
        const held = entry.points.get(document.end);
        if (held && held.value !== cell.value) { entry.points.delete(document.end); entry.disputed.add(document.end); return; }
        if (held && held.source === "release") return;
        entry.points.set(document.end, {
          end: document.end, value: cell.value, decimals: cell.decimals, source: document.form, url: url(document), filed: document.filed,
          early: document.form === "release" && !filedEnds.has(document.end) && document.end > lastFiled,
        });
      };
      add(newer, reading.current);
      add(older, reading.yearAgo);
    }
  }
  const proven = [...series.values()].filter((entry) => entry.proofs.size >= 2 && entry.points.size >= 3 && !yearToDate(entry.points));
  // A 10-Q's figure that a release prints differently under the same name is not the quarter's.
  const releaseFigures = new Map<string, Map<string, number>>();
  for (const entry of proven.filter((candidate) => candidate.family === "release")) {
    const name = normalise(entry.reading.label);
    const held = releaseFigures.get(name) ?? new Map<string, number>();
    for (const [end, point] of entry.points) held.set(end, point.value);
    releaseFigures.set(name, held);
  }
  const consistent = proven.filter((entry) => entry.family === "release" || ![...entry.points].some(([end, point]) => {
    const released = releaseFigures.get(normalise(entry.reading.label))?.get(end);
    return released != null && released !== point.value;
  }));
  // One measure, two names: the same figures at two or more quarters and none different.
  const kept: Building[] = [];
  for (const entry of consistent.sort((left, right) => Number(left.family !== "release") - Number(right.family !== "release"))) {
    const twin = kept.find((other) => {
      const shared = [...entry.points.keys()].filter((end) => other.points.has(end));
      return shared.length >= 2 && shared.every((end) => other.points.get(end)!.value === entry.points.get(end)!.value);
    });
    // Or one measure whose label gained or lost a parenthesis between documents, never printed differently.
    const core = (building: Building) => `${building.reading.section ?? ""}|${normalise(building.reading.label.replace(/\([^)]*\)/g, " "))}|${building.reading.unit}`;
    const renamed = twin ? null : kept.find((other) => core(other) === core(entry) && [...entry.points].every(([end, point]) => !other.points.has(end) || other.points.get(end)!.value === point.value));
    const into = twin ?? renamed;
    if (!into) { kept.push(entry); continue; }
    // The same figures read from a sentence and from a table: the table says their scale (Uber's MAPCs "in millions").
    if (!into.reading.scale && entry.reading.scale && !entry.reading.dollarScale) into.reading = { ...into.reading, scale: entry.reading.scale };
    if (renamed) for (const end of entry.proofs) renamed.proofs.add(end);
    for (const [end, point] of entry.points) if (!into.points.has(end) && !into.disputed.has(end)) into.points.set(end, point);
  }
  // Named the same way for every company; a figure whose text says nothing of what it measures is not shown.
  const described: Array<{ entry: Building; description: NonNullable<ReturnType<typeof describeKpi>> }> = [];
  // A measure the company stopped printing a year or more before its latest filing is history, not a KPI (Apple's
  // iPhone units, last printed in 2018).
  const newest = kept.reduce((latest, entry) => [...entry.points.keys()].reduce((at, end) => (end > at ? end : at), latest), lastFiled);
  for (const entry of kept) {
    const last = [...entry.points.keys()].sort().at(-1) ?? "";
    if (newest && days(newest, last) > 370) continue;
    const { label, section, caption, measure, unit, scale, dollarScale } = entry.reading;
    const description = describeKpi({ caption, section, label, measure, unit, scale, dollarScale, values: [...entry.points.values()].map((point) => point.value) });
    if (!description) continue;
    // Two rows that come out under one name are one measure printed twice (a release and its supplement): one card.
    // A measure that came to be printed "at period end" from one year to the next is the same measure.
    const plain = (name: string) => name.replace(/ · end of quarter$/, "");
    const same = described.find((other) => plain(other.description.name) === plain(description.name) && other.description.unit === description.unit);
    if (same) {
      if (!same.description.scale && description.scale) same.description = { ...same.description, scale: description.scale };
      if (![...entry.points].some(([end, point]) => same.entry.points.has(end) && same.entry.points.get(end)!.value !== point.value)) {
        for (const [end, point] of entry.points) if (!same.entry.points.has(end)) same.entry.points.set(end, point);
      }
      continue;
    }
    described.push({ entry, description });
  }
  /*
   * The best first, and five at most under one heading: a hotel group's forty brands, room by room, would
   * otherwise fill the page before its RevPAR. Within a rank, the order the documents print them in.
   */
  const perHeading = new Map<string, number>();
  const perLabel = new Map<string, number>();
  const chosen = described
    .map((item, index) => ({ ...item, index, rank: kpiRank(item.entry.reading) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .filter(({ entry }) => {
      // And three at most of one label under different headings: "Rooms" brand after brand.
      const label = normalise(entry.reading.label);
      const sameLabel = (perLabel.get(label) ?? 0) + 1;
      perLabel.set(label, sameLabel);
      if (sameLabel > 3) return false;
      const heading = normalise(entry.reading.section ?? entry.reading.measure ?? "");
      if (!heading) return true;
      const count = (perHeading.get(heading) ?? 0) + 1;
      perHeading.set(heading, count);
      return count <= 5;
    });
  return chosen.slice(0, MAX_SERIES).map(({ entry, description }) => ({
    id: `${entry.family}|${entry.reading.key}|${entry.reading.measure ?? ""}`,
    name: description.name, unit: description.unit, scale: description.scale, suffix: description.suffix,
    points: [...entry.points.values()].sort((left, right) => left.end.localeCompare(right.end)),
  }));
}

/** The operating rows of one document, kept by accession: a filing does not change. */
type StoredRow = Omit<KpiRow, "excluded"> & { excluded: number[] };

/**
 * The SEC asks for ten requests a second at most: one every hundred and
 * twenty-five milliseconds, across everything this invocation reads.
 */
let nextSlot = 0;
async function paced(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 125;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function filingRows(filing: KpiFiling, release: boolean): Promise<{ rows: KpiRow[]; url: string } | null> {
  const cache = datasetCache();
  // v5: each row carries its table's caption (the heading above it), and a change with no subject takes the row above's.
  // v4: measures under their own column heading, figures stated in sentences, quarterly trends tables, constant-currency
  // growth and business metrics printed in statement tables (kept rows are filtered by isOperating before they are stored).
  const key = `kpi-rows:v5:${filing.accession}`;
  const stored = await cache?.get<{ rows: StoredRow[]; url: string }>(key, "json").catch(() => null);
  if (stored) return { url: stored.url, rows: stored.rows.map((row) => ({ ...row, excluded: new Set(row.excluded) })) };
  const headers = { "User-Agent": SEC_AGENT() };
  let names: string[];
  if (!release) names = filing.primary ? [filing.primary] : [];
  else {
    await paced();
    const index = await secFetch(`${filing.base}index.json`, { headers: { ...headers, Accept: "application/json" } });
    if (!index.ok) { await index.body?.cancel(); return null; }
    const listing = await index.json() as { directory?: { item?: Array<{ name: string; size?: string | number }> } };
    names = releaseDocuments(listing.directory?.item ?? [], filing.primary).slice(0, 2);
  }
  const rows: KpiRow[] = [];
  for (const name of names) {
    await paced();
    const response = await secFetch(`${filing.base}${name}`, { headers: { ...headers, Accept: "text/html" } });
    if (!response.ok) { await response.body?.cancel(); return null; }
    const html = (await response.text()).slice(0, 8_000_000);
    rows.push(...kpiRows(html));
    // A release says some of its figures in sentences only (Meta's daily active people).
    if (release) rows.push(...kpiSentences(html));
  }
  // The older document of a pair is matched by key: keep every row that could be one end of a reading. A 10-Q's
  // table that does not say it reports the quarter may be the year to date (United's statistics: the period is
  // in the sentence above the table).
  const kept = rows.filter((row) => !row.key.includes("#") && (row.form === "text" || isOperating(row)) && (release || row.quarterly || row.form === "single"));
  const url = names[0] ? `${filing.base}${names[0]}` : filing.base;
  await cache?.put(key, JSON.stringify({ url, rows: kept.map((row) => ({ ...row, excluded: [...row.excluded] })) }), { expirationTtl: 180 * 86_400 }).catch(() => undefined);
  return { rows: kept, url };
}

/** A document's rows: its filings', the first one's where both print a row. */
async function documentRows(document: KpiDocument): Promise<{ rows: KpiRow[]; url: string } | null> {
  const parts: Array<{ rows: KpiRow[]; url: string }> = [];
  for (const filing of document.filings) {
    const part = await filingRows(filing, document.form === "release");
    if (part) parts.push(part);
  }
  if (!parts.length) return null;
  const seen = new Set<string>();
  const rows = parts.flatMap((part) => part.rows.filter((row) => !seen.has(row.key) && (seen.add(row.key), true)));
  return { rows, url: parts[0].url };
}

/**
 * The earnings releases further back than a filer's index of recent filings
 * reaches. That index holds a year or a thousand filings, whichever is more:
 * a bank that files tens of thousands of prospectuses a year (JPMorgan) has a
 * year of it, four releases and no quarter a year apart to prove anything
 * against. EDGAR's list of the company's 8-Ks, with their items, reaches back
 * years in one request; its releases are added to the index read.
 */
async function withEarlierReleases(recent: Recent, cik: string): Promise<void> {
  const oldest = recent.filingDate.reduce((earliest, date) => (date && date < earliest ? date : earliest), "9999");
  if (days(iso(Date.now()), oldest) > 800) return;
  try {
    const response = await secFetch(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=8-K&dateb=&owner=include&count=100&output=atom`, { headers: { "User-Agent": SEC_AGENT(), Accept: "application/atom+xml" } });
    if (!response.ok) { await response.body?.cancel(); return; }
    const feed = await response.text();
    const held = new Set(recent.accessionNumber);
    for (const entry of feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      const accession = /<accession-number>([^<]+)</.exec(entry[1])?.[1];
      const filed = /<filing-date>([^<]+)</.exec(entry[1])?.[1];
      const items = /<items-desc>([^<]+)</.exec(entry[1])?.[1] ?? "";
      if (!accession || !filed || held.has(accession) || !/\b2\.02\b/.test(items) || /<filing-type>8-K\/A</.test(entry[1])) continue;
      held.add(accession);
      recent.form.push("8-K"); recent.filingDate.push(filed); recent.reportDate.push(""); recent.accessionNumber.push(accession);
      recent.items?.push("2.02"); recent.primaryDocument?.push("");
    }
  } catch { /* the year the index holds is read as before */ }
}

const GENERIC = new Set(["segment", "segments", "net", "sales", "revenue", "revenues", "total", "number", "of", "growth", "ex-fx", "on", "the", "year", "ttm", "y/y", "consolidated", "and", "in", "thousands", "millions", "billions"]);

/**
 * What a figure belongs to, by the first word of its name that says so: Amazon's "AWS Segment · Net sales · growth
 * ex-FX" and "AWS segment sales · Growth on the year" are both AWS's; "Net Sales · Advertising services" is the
 * advertising business's, the heading "Net Sales" naming nothing of its own.
 */
export function kpiFamily(name: string): string {
  for (const part of name.split(" · ")) {
    const words = part.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9&/\- ]/g, " ").split(/\s+/).filter((word) => word && !GENERIC.has(word));
    if (words.length) return words[0];
  }
  return name.toLowerCase();
}

export { tidyName } from "./kpi-names";

/** A company's operating figures, rebuilt when it files a release or a 10-Q and kept until then. */
export async function operatingKpis(cik: string): Promise<OperatingKpis> {
  const padded = cik.padStart(10, "0");
  // v3: ten years of documents, from the index's older pages where its recent one is shorter.
  const { body: listed } = await cachedJson(`kpi-documents:v3:${padded}`, 1800, async () => {
    const response = await secFetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" } });
    if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
    const { filings } = await response.json() as { filings: { recent: Recent; files?: Array<{ name: string }> } };
    const recent = filings.recent;
    await withOlderFilings(recent, filings.files ?? []);
    await withEarlierReleases(recent, padded);
    const filedEnds = recent.form.flatMap((form, index) => ((form === "10-Q" || form === "10-K") && recent.reportDate[index] ? [recent.reportDate[index]] : []));
    return { documents: kpiDocuments(recent, padded), filedEnds };
  });
  const { documents, filedEnds } = JSON.parse(listed) as { documents: KpiDocument[]; filedEnds: string[] };
  const basis = documents.map((document) => document.accession.slice(-8)).join("");
  // v10: ten years of quarters, and a series read twice keeps the scale its table states. v9: names, units and suffixes from lib/kpi-names.ts, and rows told apart by their table's caption. v8: a quarter is "before its 10-Q" only after the last one filed. v7: two overlapping quarters prove a table of six and more, and names are tidied. v6: the readings of kpi-rows v4 (sentences, measure columns, quarterly trends). v5: tables of six quarters and more, and headcounts printed under a "$ in millions" heading (Amazon's employees), and no "Other ·" before a name.
  const { body } = await cachedJson(`operating-kpis:v10:${padded}:${basis.length > 200 ? basis.slice(0, 200) : basis}`, 30 * 86_400, async (): Promise<OperatingKpis> => {
    const pairs = yearApart(documents);
    const needed = [...new Map(pairs.flat().map((document) => [document.accession, document])).values()];
    const read = new Map<string, { rows: KpiRow[]; url: string }>();
    const queue = [...needed];
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const document = queue.shift()!;
        const rows = await documentRows(document).catch(() => null);
        if (rows) read.set(document.accession, rows);
      }
    }));
    // EDGAR turned every request away: that is not a company without operating figures.
    if (needed.length && !read.size) throw new Error("EDGAR did not answer just now.");
    const url = (document: KpiDocument) => read.get(document.accession)?.url ?? document.filings[0]?.base ?? "";
    const readings = pairs.flatMap(([newer, older]) => {
      const left = read.get(newer.accession), right = read.get(older.accession);
      return left && right ? [{ newer, older, readings: anchorDocuments(left.rows, right.rows), url }] : [];
    });
    const ends = new Set(filedEnds);
    const kpis = assembleKpis(readings, ends);
    const newest = documents.filter((document) => document.form === "release").sort((left, right) => right.end.localeCompare(left.end))[0];
    return {
      cik: padded, builtAt: new Date().toISOString(), kpis, documents: read.size, unread: needed.length - read.size,
      early: newest && !ends.has(newest.end) && kpis.some((kpi) => kpi.points.at(-1)?.early) ? { end: newest.end, filed: newest.filed, url: url(newest) } : null,
    };
  // A document EDGAR did not hand over is asked for again in a minute, not in a month.
  }, (value) => (value.unread ? "partial" : value.documents ? "full" : "empty"));
  return JSON.parse(body) as OperatingKpis;
}
