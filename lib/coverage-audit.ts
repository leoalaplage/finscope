import { fetchLatestFiling, type LatestFiling } from "./adapters/sec";
import { KEY_VERSION } from "./data-version";
import { withheldMeasures, type IoCompanyView, type IoPeriod } from "./io/view";
import { datasetCache } from "./runtime-env";
import type { CompanyDataset } from "./types";
import { KNOWN_SUCCESSORS, UNIVERSE } from "./universe";

/**
 * What the site holds, checked every day, so that a hole is found before a reader finds it.
 *
 * Every data problem fixed so far was reported by a reader looking at a page:
 * Invesco's empty statistics, Copart's missing quarter, Hims's blank trailing
 * cash flow, Travelers without free cash flow. A version change that would
 * have stopped the index rebuilding for a week was caught only by reading the
 * code. This makes the same checks a person made by hand, on every company in
 * the index, and keeps the answer.
 *
 * Two halves. Each company is checked when it is built, from the very view its
 * page is drawn from, and the result is kept beside its dataset — so the check
 * costs nothing extra and can never disagree with the page. Once a day the
 * checks are gathered, set against what the company has filed with the SEC,
 * and compared with the day before.
 *
 * The first audit proved the point on its own: thirty-nine of the 298
 * companies it checked were a quarter behind their filings, because SEC
 * Company Facts had not carried reports filed seven weeks earlier.
 */

export const AUDIT_SHAPE = "a1";
export const auditKey = (ticker: string) => `audit:${AUDIT_SHAPE}.${KEY_VERSION}:${ticker.toUpperCase()}`;
export const AUDIT_REPORT_KEY = `audit-report:${AUDIT_SHAPE}`;

/** The measures a reader expects on every company page. */
export const AUDITED_MEASURES = ["revenue", "netIncome", "operatingCashFlow", "capitalExpenditures", "freeCashFlow", "dilutedShares"] as const;

/** The filed figures checked against a second source. */
export const SOURCED_MEASURES = ["revenue", "netIncome", "operatingCashFlow"] as const;

/** A latest figure moving by more than this on the same period, with no new filing, is worth a look. */
export const MOVE_THRESHOLD = 0.2;
/** How far a figure may sit from the SEC's own frame before it is called a disagreement. */
export const DISAGREEMENT_THRESHOLD = 0.02;
/** Company Facts carries a filing's figures a day or two after it is accepted. */
export const FILING_GRACE_DAYS = 2;
/** How often the gathered report is rebuilt. */
export const AUDIT_EVERY_MS = 20 * 3_600_000;

export interface PeriodMark { label: string; end: string; filed: string }

/** A figure on the latest annual period, with the filed concept it was read from. */
export interface SourcedFigure {
  measure: string;
  label: string;
  start: string | null;
  end: string;
  value: number;
  concept: string;
  accession: string | null;
}

export interface CompanyAudit {
  ticker: string;
  cik?: string;
  name: string;
  businessType: string | null;
  checkedAt: string;
  annual: PeriodMark | null;
  ttm: PeriodMark | null;
  /** Audited measures the latest year lacks, leaving out what this site withholds by design. */
  missingAnnual: string[];
  /** The same for the latest trailing period; empty for a filer with none (an annual-only foreign issuer). */
  missingTtm: string[];
  /** How many of the last eight trailing periods have no free cash flow, where it is not withheld. */
  recentTtmWithoutFcf: number;
  /** The latest period's audited figures, kept to notice a move on the next build. */
  values: Record<string, number | null>;
  moved: Array<{ measure: string; period: string; from: number; to: number }>;
  /** The latest year's filed figures, to be set against the SEC's frames. */
  sourced?: SourcedFigure[];
}

const mark = (period: IoPeriod | null | undefined): PeriodMark | null =>
  period ? { label: period.label, end: period.end, filed: period.filingDate } : null;

/**
 * The latest year's revenue, net income and operating cash flow, as filed.
 *
 * Only a figure the filer tagged directly, in dollars, under a US GAAP concept:
 * a sum or a derivation has no single filed figure to be checked against, and
 * the SEC's frames are published per US GAAP concept in dollars.
 */
export function sourcedFigures(dataset: CompanyDataset): SourcedFigure[] {
  const latest = dataset.periods
    .filter((period) => period.periodicity === "annual")
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
    .at(-1);
  if (!latest) return [];
  return SOURCED_MEASURES.flatMap((measure) => {
    const fact = latest.facts[measure];
    const status = fact?.provenance.status;
    if (fact?.value == null || fact.currency !== "USD" || !fact.provenance.concept.startsWith("us-gaap:")) return [];
    if (status !== "reported" && status !== "restated") return [];
    return [{
      measure, label: latest.label, start: fact.periodStart ?? latest.periodStart ?? null, end: fact.periodEnd,
      value: fact.value, concept: fact.provenance.concept, accession: fact.provenance.accession ?? null,
    }];
  });
}

export function auditCompany(view: IoCompanyView, previous: CompanyAudit | null, checkedAt = new Date().toISOString(), sourced?: SourcedFigure[]): CompanyAudit {
  const withheld = withheldMeasures(view.company.businessType);
  const expected = AUDITED_MEASURES.filter((key) => !withheld.has(key));
  const annual = view.annual.at(-1) ?? null;
  const ttm = view.ttm;
  const gaps = (period: IoPeriod) => expected.filter((key) => period.values[key] == null);
  const latest = ttm ?? annual;
  const values = Object.fromEntries(AUDITED_MEASURES.map((key) => [key, latest?.values[key] ?? null]));

  /*
   * A move is only a move on the same period.
   *
   * A new quarter changes every trailing figure, and that is the filing doing
   * its job. The same quarter reading a fifth differently after a rebuild is
   * the normalizer changing its mind, which is exactly what a version change
   * can do without anyone meaning it to.
   */
  const moved: CompanyAudit["moved"] = [];
  const before = previous ? previous.ttm ?? previous.annual : null;
  if (previous && latest && before?.label === latest.label) {
    for (const measure of expected) {
      const from = previous.values[measure];
      const to = values[measure];
      if (from == null || to == null || from === 0) continue;
      if (Math.abs(to - from) / Math.abs(from) > MOVE_THRESHOLD) moved.push({ measure, period: latest.label, from, to });
    }
  }

  return {
    ticker: view.company.ticker,
    cik: view.company.cik,
    name: view.company.name,
    businessType: view.company.businessType,
    checkedAt,
    annual: mark(annual),
    ttm: mark(ttm),
    missingAnnual: annual ? gaps(annual) : [...expected],
    missingTtm: ttm ? gaps(ttm) : [],
    recentTtmWithoutFcf: withheld.has("freeCashFlow") ? 0 : view.trailing.slice(-8).filter((period) => period.values.freeCashFlow == null).length,
    values,
    moved,
    ...(sourced ? { sourced } : {}),
  };
}

/** One row of an SEC frame: one company's figure for one concept over one calendar period. */
export interface FrameRow { cik: number; start?: string; end: string; val: number; accn: string }

const frameKey = (concept: string, year: number) => `${concept.replace(/^us-gaap:/, "")}|CY${year}`;

/**
 * The frames a set of checks needs.
 *
 * The SEC files a fiscal year under the calendar year it most nearly covers,
 * which for a year ending in June can be either, so both are asked for.
 */
export function framesNeeded(audits: Iterable<CompanyAudit>): string[] {
  const needed = new Set<string>();
  for (const audit of audits) {
    for (const figure of audit.sourced ?? []) {
      const year = Number(figure.end.slice(0, 4));
      needed.add(frameKey(figure.concept, year));
      needed.add(frameKey(figure.concept, year - 1));
    }
  }
  return [...needed].sort();
}

export interface Disagreement {
  ticker: string; measure: string; period: string; ours: number; filed: number; concept: string; accession: string;
  /**
   * The two differ by a factor of about a thousand or a million.
   *
   * The dry run over the index found five of these, and every one was the
   * frame's: Arista's 2025 net income sits in the SEC's frame at 3.5 thousand
   * dollars, FedEx's and Medtronic's at a few thousand, a filing having tagged
   * the figure in the wrong scale. They are kept on the list and not counted
   * as this site's error.
   */
  scale?: boolean;
  /**
   * The frame's figure comes from a different filing than this site's.
   *
   * The SEC compiles a frame from the newest filing that tags a figure, of any
   * form, and the dry run found that newest filing to be the wrong one: DaVita's
   * and TKO's 2025 net income in the frame is read from their proxy statements,
   * filed two months after the annual report — DaVita's is its profit including
   * minority interests, 1,079 million against the 747 million of its 10-K — and
   * Comfort Systems' 2025 revenue is a first-quarter figure a later 10-Q tagged
   * against the whole year. A figure read from its own annual report that
   * differs from one read out of another filing is listed, not counted.
   */
  otherFiling?: boolean;
}

/** Whether two figures differ by a power of a thousand rather than by an error of reading. */
export function differsByScale(ours: number, filed: number): boolean {
  if (ours === 0 || filed === 0 || Math.sign(ours) !== Math.sign(filed)) return false;
  const ratio = Math.abs(ours / filed);
  return [1e3, 1e6, 1e-3, 1e-6].some((power) => Math.abs(ratio / power - 1) < 0.05);
}

const daysApart = (left: string, right: string) => Math.abs(Date.parse(left) - Date.parse(right)) / 86_400_000;

/**
 * This site's latest-year figures against the SEC's own frames.
 *
 * A frame is the SEC's compilation of one concept across every filer for one
 * calendar period: the figure as filed, assembled by the SEC and not by this
 * application. Agreement says the normalizer read the filing it meant to;
 * disagreement is a figure picked from the wrong context, the wrong concept or
 * an older version of a restated year — the errors that are invisible on a
 * page because the number looks perfectly plausible.
 */
export function compareWithFrames(audits: Iterable<CompanyAudit>, frames: ReadonlyMap<string, FrameRow[]>): { compared: number; disagreements: Disagreement[] } {
  let compared = 0;
  const disagreements: Disagreement[] = [];
  for (const audit of audits) {
    if (!audit.cik) continue;
    const ciks = new Set([Number(audit.cik), Number(KNOWN_SUCCESSORS[audit.ticker]?.listed ?? audit.cik)]);
    for (const figure of audit.sourced ?? []) {
      const year = Number(figure.end.slice(0, 4));
      const row = [year, year - 1]
        .flatMap((candidate) => frames.get(frameKey(figure.concept, candidate)) ?? [])
        .find((entry) => ciks.has(entry.cik) && daysApart(entry.end, figure.end) <= 3
          && (!entry.start || !figure.start || daysApart(entry.start, figure.start) <= 3));
      if (!row) continue;
      compared += 1;
      if (Math.abs(figure.value - row.val) > Math.max(1, DISAGREEMENT_THRESHOLD * Math.abs(row.val))) {
        disagreements.push({
          ticker: audit.ticker, measure: figure.measure, period: figure.label, ours: figure.value, filed: row.val, concept: figure.concept, accession: row.accn,
          ...(differsByScale(figure.value, row.val) ? { scale: true } : {}),
          ...(figure.accession && figure.accession !== row.accn ? { otherFiling: true } : {}),
        });
      }
    }
  }
  return { compared, disagreements };
}

export interface AuditEntry { ticker: string; period: string; measures: string[] }
export interface StaleEntry { ticker: string; held: string | null; heldEnd: string | null; form: string; reportDate: string; filingDate: string }
export interface MoveEntry { ticker: string; measure: string; period: string; from: number; to: number }

export interface AuditTotals {
  notBuilt: number;
  missingFcfLatest: number;
  missingAnnual: number;
  missingTtm: number;
  recentTtmGaps: number;
  stale: number;
  moved: number;
  /** Companies with a latest-year figure disagreeing with the SEC's frame. Absent from reports before it existed. */
  disagree?: number;
}

export interface AuditReport {
  builtAt: string;
  members: number;
  checked: number;
  /** How many figures could be set against a frame. */
  compared?: number;
  totals: AuditTotals;
  /** The last earlier day's totals, and which of today's are worse. */
  previousTotals: AuditTotals | null;
  regressions: Array<keyof AuditTotals>;
  issues: {
    notBuilt: string[];
    missingFcfLatest: AuditEntry[];
    missingAnnual: AuditEntry[];
    missingTtm: AuditEntry[];
    recentTtmGaps: AuditEntry[];
    stale: StaleEntry[];
    moved: MoveEntry[];
    disagreements?: Disagreement[];
  };
  history: Array<{ date: string; totals: AuditTotals }>;
}

export function summariseAudits(
  members: ReadonlyArray<{ ticker: string }>,
  audits: ReadonlyMap<string, CompanyAudit>,
  filings: ReadonlyMap<string, LatestFiling | null>,
  previous: AuditReport | null,
  now = new Date(),
  checked: { compared: number; disagreements: Disagreement[] } = { compared: 0, disagreements: [] },
): AuditReport {
  const issues: AuditReport["issues"] = { notBuilt: [], missingFcfLatest: [], missingAnnual: [], missingTtm: [], recentTtmGaps: [], stale: [], moved: [], disagreements: checked.disagreements };
  const graceCutoff = new Date(now.getTime() - FILING_GRACE_DAYS * 86_400_000).toISOString().slice(0, 10);

  for (const { ticker } of members) {
    const audit = audits.get(ticker);
    if (!audit) { issues.notBuilt.push(ticker); continue; }
    const latest = audit.ttm ?? audit.annual;
    const latestMissing = audit.ttm ? audit.missingTtm : audit.missingAnnual;
    if (latest && latestMissing.includes("freeCashFlow")) issues.missingFcfLatest.push({ ticker, period: latest.label, measures: ["freeCashFlow"] });
    if (audit.annual && audit.missingAnnual.length) issues.missingAnnual.push({ ticker, period: audit.annual.label, measures: audit.missingAnnual });
    if (audit.ttm && audit.missingTtm.length) issues.missingTtm.push({ ticker, period: audit.ttm.label, measures: audit.missingTtm });
    if (audit.recentTtmWithoutFcf > 0) issues.recentTtmGaps.push({ ticker, period: `${audit.recentTtmWithoutFcf} of the last 8`, measures: ["freeCashFlow"] });

    /*
     * Behind the SEC, not behind a clock.
     *
     * A company is stale when it has filed a periodic report for a period later
     * than any this site holds — two days after filing, the time Company Facts
     * takes to carry the figures when it keeps up. Its own calendar decides, so
     * a company that reports once a year is never called late in the middle of
     * it.
     */
    const filing = filings.get(ticker);
    const heldEnd = [audit.annual?.end, audit.ttm?.end].filter((end): end is string => Boolean(end)).sort().at(-1) ?? null;
    if (filing && filing.reportDate > (heldEnd ?? "") && filing.filingDate <= graceCutoff) {
      issues.stale.push({ ticker, held: latest?.label ?? null, heldEnd, form: filing.form, reportDate: filing.reportDate, filingDate: filing.filingDate });
    }
    for (const move of audit.moved) issues.moved.push({ ticker, ...move });
  }

  const totals: AuditTotals = {
    notBuilt: issues.notBuilt.length,
    missingFcfLatest: issues.missingFcfLatest.length,
    missingAnnual: issues.missingAnnual.length,
    missingTtm: issues.missingTtm.length,
    recentTtmGaps: issues.recentTtmGaps.length,
    stale: issues.stale.length,
    moved: new Set(issues.moved.map((move) => move.ticker)).size,
    disagree: new Set(checked.disagreements.filter((entry) => !entry.scale && !entry.otherFiling).map((entry) => entry.ticker)).size,
  };
  const date = now.toISOString().slice(0, 10);
  const earlier = (previous?.history ?? []).filter((entry) => entry.date !== date);
  const previousTotals = earlier.at(-1)?.totals ?? null;
  const regressions = previousTotals
    ? (Object.keys(totals) as Array<keyof AuditTotals>).filter((key) => previousTotals[key] != null && (totals[key] ?? 0) > (previousTotals[key] ?? 0))
    : [];
  return {
    builtAt: now.toISOString(),
    members: members.length,
    checked: audits.size,
    compared: checked.compared,
    totals,
    previousTotals,
    regressions,
    issues,
    history: [...earlier, { date, totals }].slice(-90),
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SEC_HEADERS = { "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com", Accept: "application/json" };

/**
 * Gathers the day's report, if the last one is a day old.
 *
 * Run from the half-hourly timer, after the filing watch and the index slice,
 * so it needs no schedule of its own and heals itself after a missed day. It
 * reads one small check per company, asks the SEC for each company's latest
 * periodic report, and fetches the handful of frames the checks need — gently,
 * one request at a time, as the SEC asks.
 */
export async function refreshAuditReport(force = false, pauseMs = 120): Promise<AuditReport | null> {
  const cache = datasetCache();
  if (!cache) return null;
  const previous = await cache.get<AuditReport>(AUDIT_REPORT_KEY, "json").catch(() => null);
  if (!force && previous && Date.now() - Date.parse(previous.builtAt) < AUDIT_EVERY_MS) return null;

  const audits = new Map<string, CompanyAudit>();
  const filings = new Map<string, LatestFiling | null>();
  for (const member of UNIVERSE) {
    try {
      const audit = await cache.get<CompanyAudit>(auditKey(member.ticker), "json");
      if (audit) audits.set(member.ticker, audit);
    } catch { /* An unreadable check counts as no check. */ }
    try {
      filings.set(member.ticker, await fetchLatestFiling(member.cik));
    } catch {
      filings.set(member.ticker, null);
    }
    await wait(pauseMs);
  }

  // Only the rows for companies in the index are kept: a frame lists every filer.
  const wanted = new Set<number>();
  for (const audit of audits.values()) {
    if (audit.cik) wanted.add(Number(audit.cik));
    const listed = KNOWN_SUCCESSORS[audit.ticker]?.listed;
    if (listed) wanted.add(Number(listed));
  }
  const frames = new Map<string, FrameRow[]>();
  for (const key of framesNeeded(audits.values())) {
    const [tag, period] = key.split("|");
    try {
      const response = await fetch(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/${period}.json`, { headers: SEC_HEADERS });
      if (response.ok) {
        const frame = await response.json() as { data: FrameRow[] };
        frames.set(key, frame.data.filter((row) => wanted.has(row.cik)).map(({ cik, start, end, val, accn }) => ({ cik, start, end, val, accn })));
      }
    } catch { /* A frame the SEC does not answer compares nothing. */ }
    await wait(pauseMs);
  }

  const report = summariseAudits(UNIVERSE, audits, filings, previous, new Date(), compareWithFrames(audits.values(), frames));
  try {
    await cache.put(AUDIT_REPORT_KEY, JSON.stringify(report));
  } catch { /* Tomorrow's run writes it. */ }
  return report;
}

export async function readAuditReport(): Promise<AuditReport | null> {
  try {
    return (await datasetCache()?.get<AuditReport>(AUDIT_REPORT_KEY, "json")) ?? null;
  } catch {
    return null;
  }
}
