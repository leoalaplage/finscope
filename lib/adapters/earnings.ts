import { z } from "zod";
import { secFetch } from "./sec-fetch";
import { namesQuarterEnd, readReleaseFigures, releaseDocuments, type ReleaseAnchors, type ReleaseCheck, type ReleaseFigures } from "./earnings-release";

const SEC_AGENT = () => process.env.SEC_USER_AGENT || "Tenkay research application contact@example.com";

const EarningsSubmissionsSchema = z.object({
  filings: z.object({
    recent: z.object({
      form: z.array(z.string()),
      filingDate: z.array(z.string()),
      reportDate: z.array(z.string()),
      accessionNumber: z.array(z.string()),
      items: z.array(z.string()).optional(),
      primaryDocument: z.array(z.string()).optional(),
    }),
  }),
});

interface RecentSubmissions {
  form: string[];
  filingDate: string[];
  reportDate: string[];
  accessionNumber: string[];
  items?: string[];
  primaryDocument?: string[];
}

export interface EarningsReleaseFiling {
  form: "8-K" | "8-K/A";
  filingDate: string;
  reportDate: string | null;
  accession: string;
  sourceUrl: string;
  /** The 8-K's own cover document, which carries no figures. */
  primaryDocument?: string | null;
  /** The quarter's headline figures, read from the release where they could be proven (lib/adapters/earnings-release.ts). */
  reading?: ReleaseReading | null;
}

/** What a press release was read for, and what it proved. */
export interface ReleaseReading {
  /** "Q3 FY2026". */
  quarter: string;
  /** The quarter's expected end. */
  periodEnd: string;
  /** The year-ago quarter the figures were proven against, as filed. */
  yearAgo: string;
  figures: ReleaseFigures;
  /** The documents read, in order. */
  documents: Array<{ name: string; url: string }>;
  status: "preliminary-unaudited";
}

/** What a release is read against: the quarter it should be for, from the filed figures (lib/io/release-anchors.ts). */
export interface ReleaseTarget {
  label: string;
  end: string;
  quarter: { number: number; fiscalYear: number };
  yearAgoLabel: string;
  anchors: ReleaseAnchors;
  check: ReleaseCheck;
}

const FilingIndexSchema = z.object({
  directory: z.object({
    item: z.array(z.object({
      name: z.string(),
      size: z.union([z.string(), z.number()]).optional(),
    })),
  }),
});

const earningsItem = (items: string | undefined) =>
  (items ?? "").split(",").map((item) => item.trim()).includes("2.02");

/**
 * The latest domestic earnings announcement in a filer's recent SEC index.
 *
 * Item 2.02 means "Results of Operations and Financial Condition". Looking
 * for that item rather than merely taking the newest 8-K is essential: a
 * company can file an acquisition, executive change or other current report
 * minutes after its earnings release, as Copart did in September 2026.
 */
export function latestEarningsRelease(recent: RecentSubmissions, cik: string): EarningsReleaseFiling | null {
  for (let index = 0; index < recent.form.length; index += 1) {
    const form = recent.form[index];
    if ((form !== "8-K" && form !== "8-K/A") || !earningsItem(recent.items?.[index])) continue;
    const accession = recent.accessionNumber[index];
    const filingDate = recent.filingDate[index];
    if (!accession || !filingDate) continue;
    const digits = accession.replace(/\D/g, "");
    if (digits.length !== 18) continue;
    return {
      form,
      filingDate,
      reportDate: recent.reportDate[index] || null,
      accession,
      sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${digits}/`,
      primaryDocument: recent.primaryDocument?.[index] || null,
    };
  }
  return null;
}

/**
 * The release's documents, read against the quarter they should report.
 *
 * At most four documents, the press release first; each cut at six
 * megabytes, which is past the statements in any of them. A document that
 * does not speak of the quarter expected is not read.
 */
export async function readRelease(filing: EarningsReleaseFiling, target: ReleaseTarget): Promise<ReleaseReading | null> {
  const indexResponse = await secFetch(`${filing.sourceUrl}index.json`, {
    headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" },
  });
  if (!indexResponse.ok) throw new Error(`SEC returned ${indexResponse.status}.`);
  const names = releaseDocuments(FilingIndexSchema.parse(await indexResponse.json()).directory.item, filing.primaryDocument ?? null);
  const documents: Array<{ name: string; html: string }> = [];
  for (const name of names) {
    const response = await secFetch(`${filing.sourceUrl}${name}`, { headers: { "User-Agent": SEC_AGENT(), Accept: "text/html" } });
    if (!response.ok) { await response.body?.cancel(); continue; }
    const html = (await response.text()).slice(0, 6_000_000);
    if (namesQuarterEnd(html, target.end, target.quarter)) documents.push({ name, html });
  }
  const figures = readReleaseFigures(documents, target.anchors, target.check);
  return {
    quarter: target.label,
    periodEnd: target.end,
    yearAgo: target.yearAgoLabel,
    figures,
    documents: documents.map((document) => ({ name: document.name, url: `${filing.sourceUrl}${document.name}` })),
    status: "preliminary-unaudited",
  };
}

/** Read the filing index, not the Company Facts feed that trails the release. */
export async function fetchLatestEarningsRelease(cik: string): Promise<EarningsReleaseFiling | null> {
  const padded = cik.padStart(10, "0");
  const response = await secFetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  const recent = EarningsSubmissionsSchema.parse(await response.json()).filings.recent;
  return latestEarningsRelease(recent, padded);
}

/** Every earnings release in a filer's recent index, newest first, as filing dates. */
export function earningsReleaseDates(recent: RecentSubmissions): string[] {
  const dates = new Set<string>();
  for (let index = 0; index < recent.form.length; index += 1) {
    const form = recent.form[index];
    if ((form === "8-K" || form === "8-K/A") && earningsItem(recent.items?.[index]) && recent.filingDate[index]) {
      dates.add(recent.filingDate[index]);
    }
  }
  return [...dates].sort().reverse();
}

export interface ExpectedRelease { date: string; from: string; to: string; gapDays: number }

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * When the next release should come, from when the last ones did.
 *
 * Not a date anyone announced, and not an analyst's: the median gap between a
 * filer's last few earnings 8-Ks, added to the latest one, with a window of a
 * week either side. A company that reports quarterly lands within a few days
 * of the same week every year, which is all a calendar of the reader's own list
 * needs to say. Anything that does not look quarterly — two releases, or gaps
 * outside two to four months — gets no expectation rather than a wrong one.
 */
export function expectedNextRelease(dates: string[]): ExpectedRelease | null {
  const times = dates.slice(0, 5).map((date) => Date.parse(`${date}T12:00:00Z`)).filter(Number.isFinite);
  if (times.length < 3) return null;
  const gaps = times.slice(0, -1).map((time, index) => (time - times[index + 1]) / DAY_MS).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)];
  if (gap < 60 || gap > 125) return null;
  const expected = times[0] + gap * DAY_MS;
  return { date: isoDay(expected), from: isoDay(expected - 7 * DAY_MS), to: isoDay(expected + 7 * DAY_MS), gapDays: Math.round(gap) };
}

/** The filing dates of a filer's earnings releases, from its SEC submissions index. */
export async function fetchEarningsDates(cik: string): Promise<string[]> {
  const padded = cik.padStart(10, "0");
  const response = await secFetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  return earningsReleaseDates(EarningsSubmissionsSchema.parse(await response.json()).filings.recent);
}
