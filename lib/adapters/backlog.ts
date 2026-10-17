import { secFetch } from "./sec-fetch";

/**
 * A company's backlog, as it files it: the remaining performance obligations
 * under ASC 606 — revenue contracted and not yet recognised — at each
 * balance-sheet date.
 *
 * It is one concept, read from the SEC's per-concept endpoint rather than from
 * the normalized dataset, because only some filers state it (software, cloud,
 * defence, aerospace) and carrying it through the engine would mean rebuilding
 * every stored company for a line most of them leave blank. A balance restated
 * in a later filing is read as restated: for each date the latest filing wins.
 */

export interface BacklogPoint {
  end: string; value: number; filed: string; form: string;
  /** Read from the filing's text, where the company states the figure without tagging it. */
  text?: boolean;
}

const CONCEPT = "RevenueRemainingPerformanceObligation";
const HEADERS = () => ({
  "User-Agent": process.env.SEC_USER_AGENT || "Tenqay research application contact@example.com",
  Accept: "application/json",
});

interface ConceptAnswer { units?: Record<string, Array<{ end?: string; val?: number; filed?: string; form?: string }>> }

/** The latest-filed value for every date, oldest first. */
export function latestByDate(facts: Array<{ end?: string; val?: number; filed?: string; form?: string }>): BacklogPoint[] {
  const byEnd = new Map<string, BacklogPoint>();
  for (const fact of facts) {
    if (!fact.end || fact.val == null || !Number.isFinite(fact.val) || fact.val < 0) continue;
    const held = byEnd.get(fact.end);
    const filed = fact.filed ?? "";
    if (!held || filed > held.filed) byEnd.set(fact.end, { end: fact.end, value: fact.val, filed, form: fact.form ?? "" });
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SCALES: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

/**
 * Pure: the remaining performance obligations a filing's text states for its
 * own balance-sheet date, where the company writes the figure without tagging
 * it (Amazon since mid-2020: "commitments not yet recognized were approximately
 * $496 billion as of June 30, 2026"). Read only from a sentence about
 * performance obligations, and only at the filing's own date, so a figure for
 * another date or another measure is never taken.
 */
export function backlogFromText(html: string, reportDate: string): number | null {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#8217;|&rsquo;/gi, "'").replace(/\s+/g, " ");
  const [year, month, day] = reportDate.split("-").map(Number);
  const found: number[] = [];
  const near = /performance obligations?/gi;
  for (let hit = near.exec(text); hit; hit = near.exec(text)) {
    const passage = text.slice(hit.index, hit.index + 700);
    const figure = /\$\s?([\d,]+(?:\.\d+)?)\s*(thousand|million|billion|trillion)\b[^.$]{0,60}?\bas of\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(passage);
    if (!figure) continue;
    const [, amount, scale, monthName, dayText, yearText] = figure;
    if (MONTHS.indexOf(monthName.toLowerCase()) + 1 !== month || Number(dayText) !== day || Number(yearText) !== year) continue;
    const value = Number(amount.replace(/,/g, "")) * SCALES[scale.toLowerCase()];
    if (Number.isFinite(value) && value > 0) found.push(value);
  }
  // Several figures for the date (a total and a part of it): the largest is the total.
  return found.length ? Math.max(...found) : null;
}

interface Recent { form: string[]; reportDate: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] }

/** How many periodic filings past the last tagged figure are read for one in their text: six years. */
const TEXT_FILINGS = 24;

export async function fetchBacklog(cik: string): Promise<{ currency: string | null; points: BacklogPoint[] }> {
  const padded = cik.padStart(10, "0");
  const response = await secFetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${padded}/us-gaap/${CONCEPT}.json`, { headers: HEADERS() });
  // A filer that has never tagged the concept: an answer, not a failure.
  if (response.status === 404) return { currency: null, points: [] };
  if (!response.ok) throw new Error(`SEC concept endpoint answered ${response.status}.`);
  const body = await response.json() as ConceptAnswer;
  const units = Object.keys(body.units ?? {});
  // One currency; the filer's own if it is not dollars.
  const currency = units.includes("USD") ? "USD" : units[0] ?? null;
  const points = currency ? latestByDate(body.units?.[currency] ?? []) : [];
  if (currency !== "USD" || !points.length) return { currency, points };

  /*
   * A company that tagged its backlog and then stopped, while still stating
   * it: the quarters since are read from the text of their 10-Q and 10-K.
   */
  const last = points[points.length - 1].end;
  try {
    const submissions = await secFetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: HEADERS() });
    if (!submissions.ok) return { currency, points };
    const recent = (await submissions.json() as { filings?: { recent?: Recent } }).filings?.recent;
    if (!recent) return { currency, points };
    const later = recent.form
      .map((form, index) => ({ form, end: recent.reportDate[index], filed: recent.filingDate[index], accession: recent.accessionNumber[index], document: recent.primaryDocument[index] }))
      .filter((filing) => (filing.form === "10-Q" || filing.form === "10-K") && filing.end > last && filing.document)
      .sort((a, b) => b.end.localeCompare(a.end))
      .slice(0, TEXT_FILINGS);
    // Only when the tag has gone quiet for more than two quarters: a filer that tags it every quarter is read as tagged.
    if (!later.length || (Date.parse(later[0].end) - Date.parse(last)) / 86_400_000 < 200) return { currency, points };
    const read = await Promise.all(later.map(async (filing) => {
      const page = await secFetch(`https://www.sec.gov/Archives/edgar/data/${Number(padded)}/${filing.accession.replace(/-/g, "")}/${filing.document}`, { headers: HEADERS() });
      if (!page.ok) return null;
      const value = backlogFromText(await page.text(), filing.end);
      return value == null ? null : { end: filing.end, value, filed: filing.filed, form: filing.form, text: true } satisfies BacklogPoint;
    }));
    const extra = read.filter((point): point is NonNullable<typeof point> => point != null);
    return { currency, points: [...points, ...extra].sort((a, b) => a.end.localeCompare(b.end)) };
  } catch {
    return { currency, points };
  }
}
