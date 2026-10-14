import { filingEvents, type FilingEvent, type SubmissionsRecent } from "./adapters/filing-events";
import { secFetch } from "./adapters/sec-fetch";
import { cachedJson } from "./market-cache";

/**
 * A filer's events over two years (lib/adapters/filing-events.ts), from one
 * read of its SEC index kept a quarter of an hour: the EVT panel and the
 * alerts read the same copy.
 */
const SEC_AGENT = () => process.env.SEC_USER_AGENT || "FinScope research application contact@example.com";

/**
 * Forms a company's index lists whether it is the subject or the filer: Bank
 * of America files 13D amendments on its stakes in Nuveen's funds, and they
 * sit in its own index beside the ones filed about it. Only those whose
 * header names this company as the subject are kept — the eight newest,
 * checked one by one; older ones are left out rather than guessed.
 */
const THIRD_PARTY = /^(SC 13D|SCHEDULE 13D|SC TO-T)/;
const CHECKED = 8;

async function aboutThisCompany(cik: string, event: FilingEvent): Promise<boolean> {
  const response = await secFetch(event.url.replace(/-index\.htm$/, "-index-headers.html"), { headers: { "User-Agent": SEC_AGENT() } });
  if (!response.ok) { await response.body?.cancel(); return false; }
  const subject = (await response.text()).match(/<SUBJECT-COMPANY>[\s\S]*?<CIK>\s*0*(\d+)/)?.[1];
  return subject === String(Number(cik));
}

export async function companyEvents(cik: string): Promise<{ cik: string; events: FilingEvent[] }> {
  const padded = cik.padStart(10, "0");
  const { body } = await cachedJson(`events:v2:${padded}`, 900, async () => {
    const response = await secFetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" } });
    if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
    const recent = (await response.json() as { filings: { recent: SubmissionsRecent } }).filings.recent;
    const since = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
    const events = filingEvents(recent, padded, since);
    const thirdParty = events.filter((event) => THIRD_PARTY.test(event.form));
    const checked = new Set<string>();
    for (const event of thirdParty.slice(0, CHECKED)) {
      if (await aboutThisCompany(padded, event).catch(() => false)) checked.add(event.accession);
    }
    return { cik: padded, events: events.filter((event) => !THIRD_PARTY.test(event.form) || checked.has(event.accession)) };
  });
  return JSON.parse(body) as { cik: string; events: FilingEvent[] };
}
