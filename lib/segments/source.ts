import { secFetch } from "../adapters/sec-fetch";
import { buildSegments, type SegmentData, type SegmentFiling } from "./build";
import { parseLabels, parseSegmentFacts, type SegmentFact } from "./xbrl";

/**
 * A company's segments read from its last periodic reports on EDGAR.
 *
 * For each report: the filing's index, then its XBRL instance and its label
 * linkbase. Twelve reports reach back three years, and each states its
 * comparative period too, so the quarters run about four years. A report
 * that cannot be read is skipped, never filled in; the reports read are
 * listed with the result.
 *
 * Heavy for a request — some forty fetches and a few megabytes of XML each —
 * so it runs from the scheduled job and the result is stored.
 */

const HEADERS = () => ({ "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com" });

interface IndexItem { name: string }

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
 * older pages are read until enough reports are found.
 */
async function periodicReports(cik: string, limit: number): Promise<SegmentFiling[]> {
  const base = "https://data.sec.gov/submissions/";
  const first = await secFetch(`${base}CIK${cik.padStart(10, "0")}.json`, { headers: { ...HEADERS(), Accept: "application/json" } });
  if (!first.ok) throw new Error(`SEC returned ${first.status}.`);
  const body = await first.json() as { filings?: { recent?: Columns; files?: Array<{ name: string }> } };
  const out: SegmentFiling[] = [];
  const take = (columns: Columns | undefined) => {
    for (let index = 0; index < (columns?.form?.length ?? 0); index++) {
      const accession = columns!.accessionNumber?.[index];
      if (!PERIODIC.has(columns!.form![index]) || !accession) continue;
      out.push({ accession, form: columns!.form![index], reportDate: columns!.reportDate?.[index] ?? "", filed: columns!.filingDate?.[index] ?? "" });
    }
  };
  take(body.filings?.recent);
  for (const page of body.filings?.files ?? []) {
    if (out.length >= limit) break;
    const response = await secFetch(`${base}${page.name}`, { headers: { ...HEADERS(), Accept: "application/json" } });
    if (!response.ok) { await response.body?.cancel(); break; }
    take(await response.json() as Columns);
  }
  return out.sort((left, right) => right.reportDate.localeCompare(left.reportDate) || right.filed.localeCompare(left.filed)).slice(0, limit);
}

async function text(url: string): Promise<string | null> {
  const response = await secFetch(url, { headers: HEADERS() });
  if (!response.ok) { await response.body?.cancel(); return null; }
  return response.text();
}

export async function fetchSegments(ticker: string, cik: string, limit = 12): Promise<SegmentData> {
  const padded = cik.replace(/^0+/, "");
  const reports = await periodicReports(cik, limit);
  const facts: SegmentFact[] = [];
  const labels = new Map<string, string>();
  const read: SegmentFiling[] = [];
  // Newest first, so a member keeps the name the company gives it now.
  for (const report of reports) {
    const folder = `https://www.sec.gov/Archives/edgar/data/${padded}/${report.accession.replace(/-/g, "")}`;
    try {
      const index = await secFetch(`${folder}/index.json`, { headers: { ...HEADERS(), Accept: "application/json" } });
      if (!index.ok) { await index.body?.cancel(); continue; }
      const items = ((await index.json()) as { directory?: { item?: IndexItem[] } }).directory?.item ?? [];
      const documents = pickDocuments(items.map((item) => item.name));
      if (!documents.instance) continue;
      const instance = await text(`${folder}/${documents.instance}`);
      if (!instance) continue;
      const filing = { accession: report.accession, filed: report.filed, form: report.form };
      facts.push(...parseSegmentFacts(instance, filing));
      if (documents.labels) {
        const linkbase = await text(`${folder}/${documents.labels}`);
        if (linkbase) for (const [member, name] of parseLabels(linkbase)) if (!labels.has(member)) labels.set(member, name);
      }
      read.push(report);
    } catch {
      // A report that cannot be read is left out; the list of reports read says so.
    }
  }
  return buildSegments({ ticker, cik, facts, labels, filings: read });
}
