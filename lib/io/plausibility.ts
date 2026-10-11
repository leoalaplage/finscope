import type { IoCompanyView, IoPeriod } from "./view";

/**
 * Figures no business produces, looked for in what a page is about to draw.
 *
 * The coverage audit asks whether a figure is there; this asks whether it can
 * be right. Every check here is one a reader made by hand and reported: a
 * share count that drops to a quarter and comes back (a fourth quarter
 * subtracted across a split), a revenue line that halves for one quarter (a
 * year restated for a spin-off, its nine months not), a return on equity of
 * 2,400% (a base that has all but vanished), a trailing year that disagrees
 * with the annual report it ends on, a bank whose revenue stops in 2023.
 *
 * Run on every company when it is built (lib/coverage-audit.ts), so the daily
 * report says how many companies carry something implausible and which —
 * found before a reader finds it. Only the last five years are judged: they
 * are what a page opens on, and a finding there is one to act on.
 */

export interface Finding {
  check: "spike" | "ratio" | "ttm-vs-annual" | "shares-mismatch" | "missing-revenue" | "margin";
  period: string;
  detail: string;
}

const SPIKE_MEASURES = ["revenue", "costOfRevenue", "operatingExpenses", "dilutedShares", "sharesOutstanding", "totalAssets"];
const SHARE_MEASURES = new Set(["dilutedShares", "sharesOutstanding"]);
const RATIO_LIMITS: Record<string, number> = { roic: 1.5, returnOnEquity: 2, returnOnAssets: 1, cashReturnOnCapital: 1.5 };
const MARGINS = ["grossMargin", "operatingMargin", "netMargin"];
const YEARS = 5;

const value = (period: IoPeriod | undefined, key: string) => {
  const figure = period?.values[key];
  return figure == null || !Number.isFinite(figure) ? null : figure;
};
const short = (figure: number) => Math.abs(figure) >= 1e9 ? `${(figure / 1e9).toFixed(2)}bn` : Math.abs(figure) >= 1e6 ? `${(figure / 1e6).toFixed(1)}m` : figure.toFixed(2);

export function plausibilityFindings(company: IoCompanyView): Finding[] {
  const findings: Finding[] = [];
  const view = { ...company, annual: company.annual ?? [], quarterly: company.quarterly ?? [], trailing: company.trailing ?? [] };
  const latest = [view.ttm?.end, view.annual.at(-1)?.end].filter((end): end is string => Boolean(end)).sort().at(-1);
  if (!latest) return findings;
  const since = `${Number(latest.slice(0, 4)) - YEARS}${latest.slice(4)}`;
  const recent = (periods: IoPeriod[]) => periods.filter((period) => period.end > since);

  // A figure out of line with both neighbours, which agree with each other.
  for (const [periods, all] of [[recent(view.quarterly), view.quarterly], [recent(view.annual), view.annual]] as const) {
    for (const period of periods) {
      const index = all.indexOf(period);
      const before = all[index - 1]; const after = all[index + 1];
      if (!before || !after) continue;
      for (const key of SPIKE_MEASURES) {
        const here = value(period, key); const a = value(before, key); const b = value(after, key);
        if (here == null || a == null || b == null || a <= 0 || b <= 0 || here <= 0) continue;
        const low = Math.min(a, b); const high = Math.max(a, b);
        const band = SHARE_MEASURES.has(key) ? 1.6 : 2.2;
        if (high / low > 1.5) continue;
        if (here > high * band || here < low / band) findings.push({ check: "spike", period: period.label, detail: `${key} ${short(here)} between ${short(a)} and ${short(b)}` });
      }
    }
  }

  for (const period of [...recent(view.annual), ...recent(view.trailing)]) {
    for (const [key, limit] of Object.entries(RATIO_LIMITS)) {
      const ratio = value(period, key);
      if (ratio != null && Math.abs(ratio) > limit) findings.push({ check: "ratio", period: period.label, detail: `${key} ${(ratio * 100).toFixed(0)}%` });
    }
  }
  for (const period of [...recent(view.annual), ...recent(view.trailing), ...recent(view.quarterly)]) {
    for (const key of MARGINS) {
      const margin = value(period, key);
      if (margin != null && (margin > 1.0001 || margin < -5)) findings.push({ check: "margin", period: period.label, detail: `${key} ${(margin * 100).toFixed(0)}%` });
    }
  }

  // A trailing year ending where a fiscal year ends is that year.
  const trailing = new Map(view.trailing.map((period) => [period.end, period]));
  for (const year of recent(view.annual)) {
    const ttm = trailing.get(year.end);
    for (const key of ["revenue", "netIncome", "operatingCashFlow"]) {
      const filed = value(year, key); const summed = value(ttm, key);
      if (filed == null || summed == null || filed === 0) continue;
      if (Math.abs(filed - summed) / Math.max(Math.abs(filed), Math.abs(summed)) > 0.03) {
        findings.push({ check: "ttm-vs-annual", period: year.label, detail: `${key} filed ${short(filed)}, trailing ${short(summed)}` });
      }
    }
  }

  // The weighted count and the count outstanding describe the same shares.
  for (const period of view.quarterly.slice(-8)) {
    const diluted = value(period, "dilutedShares"); const outstanding = value(period, "sharesOutstanding");
    if (diluted && outstanding && Math.max(diluted / outstanding, outstanding / diluted) > 2.5) {
      findings.push({ check: "shares-mismatch", period: period.label, detail: `diluted ${short(diluted)}, outstanding ${short(outstanding)}` });
    }
  }

  const missing = view.quarterly.slice(-8).filter((period) => value(period, "revenue") == null).map((period) => period.label);
  if (missing.length) findings.push({ check: "missing-revenue", period: missing.join(", "), detail: `${missing.length} of the last 8 quarters without revenue` });

  return findings;
}
