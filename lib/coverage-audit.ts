import { fetchLatestFiling, type LatestFiling } from "./adapters/sec";
import { KEY_VERSION } from "./data-version";
import { withheldMeasures, type IoCompanyView, type IoPeriod } from "./io/view";
import { datasetCache } from "./runtime-env";
import { UNIVERSE } from "./universe";

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
 */

export const AUDIT_SHAPE = "a1";
export const auditKey = (ticker: string) => `audit:${AUDIT_SHAPE}.${KEY_VERSION}:${ticker.toUpperCase()}`;
export const AUDIT_REPORT_KEY = `audit-report:${AUDIT_SHAPE}`;

/** The measures a reader expects on every company page. */
export const AUDITED_MEASURES = ["revenue", "netIncome", "operatingCashFlow", "capitalExpenditures", "freeCashFlow", "dilutedShares"] as const;

/** A latest figure moving by more than this on the same period, with no new filing, is worth a look. */
export const MOVE_THRESHOLD = 0.2;
/** Company Facts carries a filing's figures a day or two after it is accepted. */
export const FILING_GRACE_DAYS = 2;
/** How often the gathered report is rebuilt. */
export const AUDIT_EVERY_MS = 20 * 3_600_000;

export interface PeriodMark { label: string; end: string; filed: string }

export interface CompanyAudit {
  ticker: string;
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
}

const mark = (period: IoPeriod | null | undefined): PeriodMark | null =>
  period ? { label: period.label, end: period.end, filed: period.filingDate } : null;

export function auditCompany(view: IoCompanyView, previous: CompanyAudit | null, checkedAt = new Date().toISOString()): CompanyAudit {
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
  };
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
}

export interface AuditReport {
  builtAt: string;
  members: number;
  checked: number;
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
  };
  history: Array<{ date: string; totals: AuditTotals }>;
}

export function summariseAudits(
  members: ReadonlyArray<{ ticker: string }>,
  audits: ReadonlyMap<string, CompanyAudit>,
  filings: ReadonlyMap<string, LatestFiling | null>,
  previous: AuditReport | null,
  now = new Date(),
): AuditReport {
  const issues: AuditReport["issues"] = { notBuilt: [], missingFcfLatest: [], missingAnnual: [], missingTtm: [], recentTtmGaps: [], stale: [], moved: [] };
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
     * takes to carry the figures. Its own calendar decides, so a company that
     * reports once a year is never called late in the middle of it.
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
  };
  const date = now.toISOString().slice(0, 10);
  const earlier = (previous?.history ?? []).filter((entry) => entry.date !== date);
  const previousTotals = earlier.at(-1)?.totals ?? null;
  const regressions = previousTotals
    ? (Object.keys(totals) as Array<keyof AuditTotals>).filter((key) => totals[key] > (previousTotals[key] ?? 0))
    : [];
  return {
    builtAt: now.toISOString(),
    members: members.length,
    checked: audits.size,
    totals,
    previousTotals,
    regressions,
    issues,
    history: [...earlier, { date, totals }].slice(-90),
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gathers the day's report, if the last one is a day old.
 *
 * Run from the half-hourly timer, after the filing watch and the index slice,
 * so it needs no schedule of its own and heals itself after a missed day. It
 * reads one small check per company and asks the SEC for each company's
 * latest periodic report — gently, one at a time, as the SEC asks.
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
  const report = summariseAudits(UNIVERSE, audits, filings, previous);
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
