import { DEFAULT_WATCHLIST } from "./company-registry";
import { requestCompany } from "./dataset-cache";
import { datasetCache } from "./runtime-env";

/**
 * Putting a filing on screen in half an hour rather than in a day.
 *
 * The daily warm rebuilds every company once a day, which is the right cadence
 * for figures that change quarterly — except on the one day a quarter they
 * change. On that day a reader opens the page the company has just reported to
 * and finds the previous quarter, with nothing on screen admitting it. Waiting
 * for the next cron is a whole day of showing something that is no longer true.
 *
 * So: watch what is being filed. EDGAR publishes a feed of the filings it has
 * just accepted, one request for everybody, and almost every entry in it is
 * somebody else's company. When one of ours appears, it is remembered and
 * chased until the numbers behind it can actually be read — and only then is
 * that one company rebuilt.
 *
 * Chased rather than rebuilt on sight, because the filing and the data are two
 * events. EDGAR accepts the document first; the XBRL company facts this
 * application reads appear some minutes to some hours later. Rebuilding at the
 * first sight of a filing would rebuild the same unchanged dataset and then
 * wait a full day for the next run, which is the failure this is here to fix.
 */

/** The forms that carry statements. An 8-K is news; the figures come later. */
const WATCHED_FORMS = new Set(["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "40-F"]);

/** Where the outstanding filings are kept: one key, not one per company. */
export const FILING_WATCH_KEY = "filing-watch:v1";

/**
 * How long a filing is chased before it is given up on.
 *
 * Half-hourly runs, so twenty-four hours of chasing. If the facts have not
 * appeared by then the daily warm has had a turn anyway, and something is
 * wrong at the SEC's end that this cannot fix by asking again.
 */
const MAX_TRIES = 48;

/** How many companies one run may rebuild, for the reason `REBUILD_BUDGET` exists. */
const REBUILD_BUDGET = 2;

export interface RecentFiling {
  /** Unpadded, as the feed writes it. */
  cik: string;
  form: string;
  accession: string;
  /** The date EDGAR accepted it. */
  filed: string;
}

export interface Watch {
  accession: string;
  form: string;
  filed: string;
  /** How many runs have asked the SEC whether the facts are readable yet. */
  tries: number;
}

export type Watches = Record<string, Watch>;

const agent = () => process.env.SEC_USER_AGENT || "FinScope research application contact@example.com";

/**
 * The filings EDGAR has just accepted, from its own feed.
 *
 * Parsed rather than schema-validated: this is an Atom document whose entries
 * carry what they carry, and an entry this cannot read is one filing skipped,
 * not a run that fails. The daily warm is still behind all of it.
 */
export function parseCurrentFilings(xml: string): RecentFiling[] {
  const filings: RecentFiling[] = [];
  for (const entry of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const body = entry[1];
    // "10-Q - COMPANY NAME (0001045810) (Filer)". Split at the first " - "
    // rather than at the first dash: "10-K/A" has one of its own.
    const title = /<title>([\s\S]*?)<\/title>/.exec(body)?.[1] ?? "";
    const dash = title.indexOf(" - ");
    const form = dash > 0 ? title.slice(0, dash).trim() : undefined;
    const cik = /\((\d{4,10})\)/.exec(title)?.[1];
    const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(body)?.[1] ?? "";
    const accession = /AccNo:.*?([\d]{10}-[\d]{2}-[\d]{6})/.exec(summary.replace(/&lt;|&gt;|<[^>]*>/g, " "))?.[1];
    const filed = /Filed:.*?(\d{4}-\d{2}-\d{2})/.exec(summary.replace(/&lt;|&gt;|<[^>]*>/g, " "))?.[1];
    if (!form || !cik || !accession || !filed) continue;
    filings.push({ cik: String(Number(cik)), form: form.trim(), accession, filed });
  }
  return filings;
}

export async function fetchCurrentFilings(): Promise<RecentFiling[]> {
  // `type=10-` is a prefix match, so it also returns registration statements
  // like 10-12G; the form set below is what actually decides.
  const response = await fetch("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-&company=&dateb=&owner=include&count=100&output=atom", {
    headers: { "User-Agent": agent(), Accept: "application/atom+xml" },
  });
  if (!response.ok) throw new Error(`EDGAR returned ${response.status}.`);
  return parseCurrentFilings(await response.text());
}

/**
 * Which of these filings belong to companies this site holds.
 *
 * By CIK, never by name: "Alphabet Inc." files once and this site carries two
 * tickers against it, and a name match would find neither.
 */
export function coveredFilings(filings: RecentFiling[], watchlist = DEFAULT_WATCHLIST): Array<{ ticker: string; filing: RecentFiling }> {
  const byCik = new Map<string, string[]>();
  for (const company of watchlist) {
    if (!company.cik) continue;
    const key = String(Number(company.cik));
    byCik.set(key, [...(byCik.get(key) ?? []), company.ticker]);
  }
  const matched: Array<{ ticker: string; filing: RecentFiling }> = [];
  for (const filing of filings) {
    if (!WATCHED_FORMS.has(filing.form)) continue;
    for (const ticker of byCik.get(filing.cik) ?? []) matched.push({ ticker, filing });
  }
  return matched;
}

/**
 * The outstanding list after a run of the feed: what was already being chased,
 * plus what has just been filed.
 *
 * A newer filing replaces an older one for the same company and resets the
 * count: a 10-K/A filed the day after a 10-K is the thing to wait for now.
 */
export function withNewFilings(watches: Watches, matched: Array<{ ticker: string; filing: RecentFiling }>): Watches {
  const next: Watches = { ...watches };
  for (const { ticker, filing } of matched) {
    if (next[ticker]?.accession === filing.accession) continue;
    next[ticker] = { accession: filing.accession, form: filing.form, filed: filing.filed, tries: 0 };
  }
  return next;
}

/** Whether a watch has been chased for long enough to give up on. */
export const givenUp = (watch: Watch) => watch.tries >= MAX_TRIES;

/**
 * Whether the SEC can yet be read for this filing's numbers.
 *
 * Asks for one concept rather than the whole company: a companyfacts document
 * is megabytes and this is eighteen kilobytes, and the question is only
 * "has this accession reached the XBRL API". Total assets is reported by every
 * filer in every periodic report; a company that somehow does not tag it is
 * covered by the daily warm like everything else.
 */
export async function factsCarry(cik: string, accession: string): Promise<boolean> {
  const padded = cik.padStart(10, "0");
  const response = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${padded}/us-gaap/Assets.json`, {
    headers: { "User-Agent": agent(), Accept: "application/json" },
  });
  if (!response.ok) return false;
  const facts = await response.json() as { units?: Record<string, Array<{ accn?: string }>> };
  return Object.values(facts.units ?? {}).some((unit) => unit.some((fact) => fact.accn === accession));
}

async function readWatches(cache: KVNamespace | null): Promise<Watches> {
  try {
    const stored = await cache?.get(FILING_WATCH_KEY, "text");
    return stored ? JSON.parse(stored) as Watches : {};
  } catch {
    // An unreadable list costs this run, not the day: the warm still rebuilds.
    return {};
  }
}

export interface ChaseReport {
  /** Companies whose numbers had arrived and were rebuilt on the spot. */
  rebuilt: string[];
  /** Companies whose filing is known and whose facts are not readable yet. */
  waiting: string[];
  /** Companies chased for a day without the facts appearing. */
  abandoned: string[];
}

/**
 * One run: read the feed, note ours, and rebuild whatever is ready.
 *
 * Everything here is best effort. The daily warm is the guarantee; this only
 * makes the good case fast.
 */
export async function chaseFilings(origin: string): Promise<ChaseReport> {
  const cache = datasetCache();
  const report: ChaseReport = { rebuilt: [], waiting: [], abandoned: [] };

  let watches = await readWatches(cache);
  try {
    watches = withNewFilings(watches, coveredFilings(await fetchCurrentFilings()));
  } catch (error) {
    // A feed that will not answer leaves the outstanding list exactly as it
    // was, so nothing already being chased is forgotten.
    console.log(`[filing watch] feed unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const companies = new Map(DEFAULT_WATCHLIST.map((company) => [company.ticker, company]));
  for (const [ticker, watch] of Object.entries(watches)) {
    const company = companies.get(ticker);
    if (!company?.cik) { delete watches[ticker]; continue; }
    if (givenUp(watch)) { delete watches[ticker]; report.abandoned.push(ticker); continue; }
    if (report.rebuilt.length >= REBUILD_BUDGET) { report.waiting.push(ticker); continue; }

    let ready = false;
    try {
      ready = await factsCarry(company.cik, watch.accession);
    } catch {
      // Treated as "not yet": the next run asks again.
    }
    if (!ready) {
      watches[ticker] = { ...watch, tries: watch.tries + 1 };
      report.waiting.push(ticker);
      continue;
    }
    try {
      const response = await requestCompany(origin, ticker, true);
      await response.body?.cancel();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      delete watches[ticker];
      report.rebuilt.push(ticker);
    } catch (error) {
      // A refusal is the platform throttling us, not a broken company: the
      // filing stays on the list and the next run tries again.
      watches[ticker] = { ...watch, tries: watch.tries + 1 };
      report.waiting.push(ticker);
      console.log(`[filing watch] ${ticker} rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    // Kept for a day and a half, which outlives the longest chase.
    await cache?.put(FILING_WATCH_KEY, JSON.stringify(watches), { expirationTtl: 36 * 3_600 });
  } catch {
    // Best effort: a list that cannot be stored is rebuilt from the feed.
  }
  return report;
}
