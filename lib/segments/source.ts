import { secFetch } from "../adapters/sec-fetch";
import { buildSegments, type SegmentData, type SegmentFiling } from "./build";
import { FILED_NAMES } from "../universe-names";
import { UNIVERSE } from "../universe";
import { buildCustomers, parseCustomerFacts, type CustomerFact } from "./customers";
import { parseLabels, parseSegmentFacts, type SegmentFact } from "./xbrl";

/**
 * A company's segments read from its last periodic reports on EDGAR.
 *
 * For each report: the filing's index, then its XBRL instance and its label
 * linkbase. Twenty-four reports reach back six years, and each states its
 * comparative period too, so the quarters run about seven years and a
 * trailing year's growth about five — twelve left GF's segment growth starting
 * in late 2024 for every company. A report
 * that cannot be read is skipped, never filled in; the reports read are
 * listed with the result.
 *
 * Heavy for a request — some seventy-five fetches and a few megabytes of XML each —
 * so it runs from the scheduled job and the result is stored.
 */

/** EDGAR turns away a share of requests from shared cloud addresses; a build waits longer for it than a page does. */
const PATIENT = [1000, 3000, 6000];
/**
 * And it is asked slowly. EDGAR allows ten requests a second per address, and
 * a Worker shares its address with others: forty requests in a burst can get
 * the address refused for a while, for the rest of the site's SEC reads too.
 */
const SPACING_MS = 250;
const pause = () => new Promise((resolve) => setTimeout(resolve, SPACING_MS));

const HEADERS = () => ({ "User-Agent": process.env.SEC_USER_AGENT || "Tenqay research application contact@example.com" });

interface IndexItem { name: string; size?: number | string }

/**
 * The twelve latest reports are always read; older ones only while the XML read
 * stays under this. A bank's instance runs to 15 MB — JPMorgan's two dozen
 * reports are some 380 MB, and the build ran out of the Worker's memory — where
 * most companies' are one to five.
 */
const ALWAYS_READ = 12;
const OLDER_BUDGET_BYTES = 160_000_000;

/**
 * The instance and labels of one filing: the inline filing's extracted
 * instance, or the classic instance document; the label linkbase, or the
 * schema where a filer embeds its linkbases there (Microsoft does).
 */
export function pickDocuments(names: string[]): { instance: string | null; labels: string | null } {
  const xml = names.filter((name) => name.toLowerCase().endsWith(".xml"));
  const instance = xml.find((name) => /_htm\.xml$/i.test(name))
    ?? xml.find((name) => !/(_cal|_def|_lab|_pre)\.xml$/i.test(name) && !/^FilingSummary\.xml$/i.test(name) && !/^MetaLinks/i.test(name))
    ?? null;
  const labels = xml.find((name) => /_lab\.xml$/i.test(name)) ?? names.find((name) => /\.xsd$/i.test(name)) ?? null;
  return { instance, labels };
}

const PERIODIC = new Set(["10-K", "10-Q", "20-F", "40-F"]);
interface Columns { form?: string[]; filingDate?: string[]; reportDate?: string[]; accessionNumber?: string[] }

/**
 * The company's last periodic reports, newest first. A bank files hundreds of
 * other forms, which push its 10-Qs off the submissions' first page, so the
 * older pages are read until enough reports are found. `before` keeps only
 * reports for periods ending earlier — a predecessor's, up to its successor's first.
 */
async function periodicReports(cik: string, limit: number, before?: string): Promise<SegmentFiling[]> {
  const base = "https://data.sec.gov/submissions/";
  const first = await secFetch(`${base}CIK${cik.padStart(10, "0")}.json`, { headers: { ...HEADERS(), Accept: "application/json" } }, PATIENT);
  if (!first.ok) throw new Error(`SEC returned ${first.status}.`);
  const body = await first.json() as { filings?: { recent?: Columns; files?: Array<{ name: string }> } };
  const out: SegmentFiling[] = [];
  const take = (columns: Columns | undefined) => {
    for (let index = 0; index < (columns?.form?.length ?? 0); index++) {
      const accession = columns!.accessionNumber?.[index];
      const reportDate = columns!.reportDate?.[index] ?? "";
      if (!PERIODIC.has(columns!.form![index]) || !accession || (before && !(reportDate && reportDate < before))) continue;
      out.push({ accession, form: columns!.form![index], reportDate, filed: columns!.filingDate?.[index] ?? "", ...(before ? { cik } : {}) });
    }
  };
  take(body.filings?.recent);
  for (const page of body.filings?.files ?? []) {
    if (out.length >= limit) break;
    const response = await secFetch(`${base}${page.name}`, { headers: { ...HEADERS(), Accept: "application/json" } }, PATIENT);
    if (!response.ok) { await response.body?.cancel(); break; }
    take(await response.json() as Columns);
  }
  return out.sort((left, right) => right.reportDate.localeCompare(left.reportDate) || right.filed.localeCompare(left.filed)).slice(0, limit);
}

async function text(url: string): Promise<string | null> {
  await pause();
  const response = await secFetch(url, { headers: HEADERS() }, PATIENT);
  if (!response.ok) { await response.body?.cancel(); return null; }
  return response.text();
}

/**
 * A successor's reports, then its predecessor's before them.
 *
 * A registrant that took over from another — a holding company put on top,
 * a change of domicile, a trust become a corporation — files under a new
 * identifier from that day, and the years before stay under the old one:
 * ExxonMobil Holdings had one 10-Q, Exxon Mobil Corporation the six years
 * before it. Where the successor's own reports fall short, the predecessor's
 * fill the rest, only for periods ending before the successor's first report:
 * a predecessor that goes on filing as a subsidiary (Apache under APA, Apollo
 * Asset Management under Apollo) reports a different company after that day,
 * and a report filed under both (Exxon's June 2026 quarter) is read once.
 */
/** The period of a company's first report: the predecessor's reports are those before it. */
const firstPeriod = (own: SegmentFiling[]) => own.reduce((oldest, report) => (report.reportDate && report.reportDate < oldest ? report.reportDate : oldest), "9999-12-31");

export function withPredecessor(own: SegmentFiling[], earlier: SegmentFiling[], limit: number): SegmentFiling[] {
  const first = firstPeriod(own);
  const held = new Set(own.map((report) => report.accession));
  const before = earlier.filter((report) => report.reportDate && report.reportDate < first && !held.has(report.accession));
  return [...own, ...before].slice(0, limit);
}

export async function fetchSegments(ticker: string, cik: string, limit = 24, predecessor?: string | null): Promise<SegmentData> {
  const own = await periodicReports(cik, limit);
  let reports = own;
  if (predecessor && own.length < limit) {
    try {
      reports = withPredecessor(own, await periodicReports(predecessor, limit - own.length, firstPeriod(own)), limit);
    } catch { /* The successor's own reports still stand. */ }
  }
  const facts: SegmentFact[] = [];
  const customerFacts: CustomerFact[] = [];
  const labels = new Map<string, string>();
  const read: SegmentFiling[] = [];
  let attempted = 0;
  let bytes = 0;
  // Newest first, so a member keeps the name the company gives it now.
  for (const [position, report] of reports.entries()) {
    // A predecessor's report is kept under the predecessor's identifier.
    const folder = `https://www.sec.gov/Archives/edgar/data/${Number(report.cik ?? cik)}/${report.accession.replace(/-/g, "")}`;
    attempted++;
    try {
      await pause();
      const index = await secFetch(`${folder}/index.json`, { headers: { ...HEADERS(), Accept: "application/json" } }, PATIENT);
      if (!index.ok) { await index.body?.cancel(); continue; }
      const items = ((await index.json()) as { directory?: { item?: IndexItem[] } }).directory?.item ?? [];
      const documents = pickDocuments(items.map((item) => item.name));
      const size = items.filter((item) => item.name === documents.instance || item.name === documents.labels).reduce((sum, item) => sum + (Number(item.size) || 0), 0);
      // Past the budget the older reports are not missed, they are not asked for.
      if (position >= ALWAYS_READ && bytes + size > OLDER_BUDGET_BYTES) { attempted--; break; }
      bytes += size;
      if (!documents.instance) continue;
      const instance = await text(`${folder}/${documents.instance}`);
      if (!instance) continue;
      const filing = { accession: report.accession, filed: report.filed, form: report.form };
      facts.push(...parseSegmentFacts(instance, filing));
      customerFacts.push(...parseCustomerFacts(instance, filing));
      if (documents.labels) {
        const linkbase = await text(`${folder}/${documents.labels}`);
        if (linkbase) for (const [member, name] of parseLabels(linkbase)) if (!labels.has(member)) labels.set(member, name);
      }
      read.push(report);
    } catch {
      // A report that cannot be read is left out; the list of reports read says so.
    }
  }
  const segments = buildSegments({ ticker, cik, facts, labels, filings: read });
  // The company's revenue a year, for a customer whose filing gives its revenue and no share.
  const totals = new Map((segments.series.find((series) => series.axis === "total" && series.measure === "revenue")?.annual ?? []).map((point) => [point.end, point.value]));
  const customers = buildCustomers(customerFacts, labels, KNOWN_COMPANIES, { self: ticker.toUpperCase(), totals });
  return { ...segments, customers, complete: read.length === attempted };
}

/** The index's members under every name they have filed under, for a customer's name to be matched against. */
const KNOWN_COMPANIES = UNIVERSE.map((member) => ({ ticker: member.ticker, name: member.name, aliases: FILED_NAMES[member.ticker] }));
