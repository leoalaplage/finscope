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

export interface BacklogPoint { end: string; value: number; filed: string; form: string }

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
  return { currency, points: currency ? latestByDate(body.units?.[currency] ?? []) : [] };
}
