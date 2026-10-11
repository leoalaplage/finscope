import { describe, expect, it } from "vitest";
import { fetchSecCompany } from "@/lib/adapters/sec";
import { identityFailures } from "@/lib/coverage-audit";
import { valueOf } from "@/lib/finance";
import type { FinancialPeriod, MetricKey } from "@/lib/types";

/**
 * FinScope's figures against each company's latest annual report, live.
 *
 * Skipped unless asked for, because it reads the SEC: `npm run reconcile`
 * checks the validation set below, `RECONCILE="AAPL KO" npm run reconcile`
 * any others. For each company, the latest fiscal year's core figures must
 * equal the raw facts of its own 10-K, 20-F or 40-F — under the concept the
 * engine read them from, so a period or context picked wrongly shows — and no
 * accounting identity may fail over the last five years.
 *
 * The set is the one FINANCIAL_DATA_AUDIT.md validates: a fiscal year ending
 * in June (MSFT), high margins (MA), negative equity and a split (BKNG, MCD),
 * mezzanine equity (SPGI), a July year-end (CPRT), a bank (JPM), a
 * conglomerate (BRK.B), a 20-F filer in euros (ASML) and an IFRS 40-F filer
 * in Canadian dollars (SU — Suncor; Schneider Electric files nothing with the
 * SEC).
 */
const SET = ["MSFT", "MA", "BKNG", "SPGI", "CPRT", "MCD", "JPM", "BRK.B", "ASML", "SU"];
const requested = process.env.RECONCILE;
const tickers = requested && requested !== "1" ? requested.split(/[\s,]+/).filter(Boolean) : SET;

const CORE: MetricKey[] = ["revenue", "netIncome", "operatingCashFlow", "totalAssets", "totalEquity", "cashAndEquivalents"];
const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "40-F"]);

interface RawFact { val: number; start?: string; end: string; form: string; filed: string }
type Tree = Record<string, Record<string, { units: Record<string, RawFact[]> }>>;

async function companyFacts(cik: string): Promise<Tree> {
  const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`, {
    headers: { "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com" },
  });
  return ((await response.json()) as { facts: Tree }).facts;
}

/** The value an annual report filed for a concept over a period, latest filing first. */
function filed(tree: Tree, concept: string, period: FinancialPeriod, currency: string): number | null {
  const [space, tag] = concept.split(":");
  const facts = tree[space]?.[tag]?.units?.[currency] ?? [];
  const match = facts
    .filter((fact) => fact.end === period.periodEnd && ANNUAL_FORMS.has(fact.form) && (!period.periodStart || !fact.start || fact.start === period.periodStart))
    .sort((left, right) => right.filed.localeCompare(left.filed))[0];
  return match?.val ?? null;
}

describe.skipIf(!requested)("reconciliation against the filings (live)", () => {
  for (const ticker of tickers) {
    it(`${ticker}: the latest year equals its annual report, and the identities hold`, async () => {
      const dataset = await fetchSecCompany(ticker);
      const tree = await companyFacts(dataset.company.cik);
      const year = dataset.periods.filter((period) => period.periodicity === "annual").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1)!;
      const gaps: string[] = [];
      for (const metric of CORE) {
        const fact = year.facts[metric];
        // A figure the engine calculated has no single filed counterpart; its inputs are checked instead.
        if (fact?.value == null || fact.provenance.status === "calculated" || !fact.provenance.concept.includes(":")) continue;
        const official = filed(tree, fact.provenance.concept, year, dataset.company.currency);
        if (official == null) continue;
        const gap = Math.abs(valueOf(year, metric)! - official) / Math.max(Math.abs(official), 1);
        if (gap > 0.005) gaps.push(`${metric}: ${valueOf(year, metric)} against ${official} filed (${(gap * 100).toFixed(2)}%)`);
      }
      expect(gaps, `${ticker} ${year.label}`).toEqual([]);
      const broken = identityFailures(dataset);
      expect(broken.map((failure) => `${failure.period} ${failure.invariant}`), `${ticker} identities`).toEqual([]);
    }, 120_000);
  }
});
