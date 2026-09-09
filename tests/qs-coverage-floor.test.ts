import { describe, expect, it } from "vitest";
import { screen, QS_COVERAGE_FLOOR, QS_METRICS } from "../lib/qs/screener";
import * as cfg from "../lib/qs/qs-config.js";

/**
 * What the coverage floor is for, and what it is not for.
 *
 * It exists so that a letter is never struck from a third of the model — a
 * bank, whose leverage, margins and cash conversion mean nothing as this model
 * means them, is left unrated rather than graded on the fragments that happen
 * to compute. It does not exist to fail a complete company that is missing a
 * measure or two.
 *
 * At 75% the two were the same rule. Booking, with all four pillars answered,
 * lost its grade the day a ninth measure was added to Quality: the company had
 * not changed, the denominator had. The floor is 70% so that adding a measure
 * to the model costs a well-described company points rather than its letter.
 */

const PILLAR_OF = new Map(QS_METRICS.map((metric) => [metric.cle, metric.pilier]));
const ANCHORS = cfg.ANCRES_ABSOLUES as Record<string, number[]>;
const NATIVE = QS_METRICS.filter((metric) => !["RevFwd3", "FwdP_FCF"].includes(metric.cle));

/** The header a pasted table would carry for a metric, as the parser reads it. */
const headerFor = (key: string) =>
  (cfg.METRIQUES as Array<{ cle: string; entetes: string[] }>).find((metric) => metric.cle === key)!.entetes[1]
  ?? (cfg.METRIQUES as Array<{ cle: string; entetes: string[] }>).find((metric) => metric.cle === key)!.entetes[0];

/**
 * A universe carrying every native measure, and one company inside it.
 *
 * The second row matters: a measure no company in the table carries is out of
 * the universe's reach and is renormalised away rather than counted as a hole.
 * A company is only short of coverage relative to a table that does carry the
 * columns it lacks — which is the situation a real screener run is in.
 */
function tableOf(keys: string[]) {
  const all = NATIVE.map((metric) => metric.cle);
  const headers = ["Ticker", "Sector", ...all.map(headerFor)];
  const row = (ticker: string, carried: string[]) =>
    [ticker, "Software", ...all.map((key) => carried.includes(key) ? String(ANCHORS[key][1]) : "")].join(",");
  return [headers.join(","), row("AAA", keys), row("REF", all)].join("\n");
}

describe("the coverage floor", () => {
  it("stands at seventy per cent", () => {
    expect(QS_COVERAGE_FLOOR).toBe(0.7);
  });

  it("grades a company that is missing a measure or two", () => {
    // Everything filed except the two heaviest measures in Quality — a real
    // gap, not a different kind of company.
    const kept = NATIVE.filter((metric) => !["ROIC5", "OpM"].includes(metric.cle)).map((metric) => metric.cle);
    const company = screen(tableOf(kept)).all.find((row) => row.Ticker === "AAA")!;
    expect(company.couverture).toBeGreaterThan(QS_COVERAGE_FLOOR);
    expect(company.note).not.toBe("NR");
  });

  it("still withholds a grade from a company only a third of the model fits", () => {
    // What a bank looks like to this model: the balance-sheet measures answer,
    // and almost nothing else does.
    const health = NATIVE.filter((metric) => PILLAR_OF.get(metric.cle) === "Health").map((metric) => metric.cle);
    const company = screen(tableOf(health)).all.find((row) => row.Ticker === "AAA")!;
    expect(company.couverture).toBeLessThan(QS_COVERAGE_FLOOR);
    expect(company.note).toBe("NR");
  });

  it("grades the band the drop opened, between seventy and seventy-five", () => {
    /*
     * The regression itself, stated as the band it turns on.
     *
     * Booking sat at 76.4% coverage and was graded. A ninth measure was added
     * to Quality, its coverage fell to 73.9%, and it lost its letter — the
     * company had not changed, the denominator had. Any company in this band is
     * described well enough to judge; what the floor is for is the company that
     * is not described at all.
     */
    const all = NATIVE.map((metric) => metric.cle);
    // Drop measures, heaviest first, until the company lands in the band.
    const dropped: string[] = [];
    let company = screen(tableOf(all)).all.find((row) => row.Ticker === "AAA")!;
    for (const metric of [...NATIVE].sort((left, right) => right.poids - left.poids)) {
      if (company.couverture < 0.75) break;
      dropped.push(metric.cle);
      company = screen(tableOf(all.filter((key) => !dropped.includes(key)))).all.find((row) => row.Ticker === "AAA")!;
    }
    expect(company.couverture).toBeLessThan(0.75);
    expect(company.couverture).toBeGreaterThanOrEqual(0.7);
    expect(company.note).not.toBe("NR");
    expect(company.total).not.toBeNull();
  });

});
