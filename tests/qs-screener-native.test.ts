import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QS_METRICS, QS_PILLARS, detectCapDivisor, naturalDirection, resultsToCsv, scoreColour, scoreInk, screen, sectorsOf, sortRowsBy } from "../lib/qs/screener";

/**
 * The engine lives in two places and must never differ between them.
 *
 * `lib/qs` is what the application imports and bundles; `public/qs/js` is what
 * the standalone screener loads as a static asset. Neither can import the
 * other — one is source, the other is served — so the guarantee that they are
 * the same engine is this test rather than a module boundary. A change made to
 * one copy and not the other fails here, before anyone can discover it as two
 * different scores for the same company.
 */
describe("the QS engine has exactly one implementation", () => {
  for (const file of ["qs-config.js", "qs-engine.js", "qs-parse.js"]) {
    it(`${file} is byte-identical in lib/qs and public/qs/js`, () => {
      const bundled = readFileSync(new URL(`../lib/qs/${file}`, import.meta.url), "utf8");
      const served = readFileSync(new URL(`../public/qs/js/${file}`, import.meta.url), "utf8");
      expect(bundled).toBe(served);
    });
  }

  it("keeps the scoring configuration out of the React layer", () => {
    // Weights, anchors, thresholds and alert rules belong to the engine. A copy
    // of any of them in the component is a second source of truth.
    const component = readFileSync(new URL("../components/QsScreener.tsx", import.meta.url), "utf8");
    for (const leak of ["ANCRES_ABSOLUES", "POIDS_PILIERS", "GRILLE_NOTES", "REGLES_ALERTES", "WINSOR_"]) {
      expect(component).not.toContain(leak);
    }
  });
});

/**
 * A small universe with known answers.
 *
 * Five companies, each stated plainly enough that the ordering is arguable from
 * the inputs alone: the one with the best returns, margins and cheapest cash
 * multiples should not be fourth. The point is not the exact score — that moves
 * with any anchor change, legitimately — but that the pipeline runs end to end
 * and that the parts which must never move have not.
 */
const TABLE = [
  "Ticker,Sector,Market Cap,ROIC,ROIC 5Yr Avg,Operating Margin,FCF Margin 5Yr Avg,FCF / Net Income,Gross Margin 5Yr Avg,Shares Outstanding 5Y CAGR,SBC to Revenue,Net Debt / EBITDA,EBIT / Interest Expense,Current Ratio,Long-term Debt to Assets,OCF/Capex,Revenue 5Y CAGR,FCF 5Y CAGR,Net Income 5Y CAGR,EV/EBIT,EV/FCF,FCF Yield",
  "GOOD,Payments,400,32,30,45,38,110,80,-2.0,2.0,0.1,40,1.6,0.10,12,16,17,18,16,19,6.0",
  "MID,Software,300,18,17,28,20,95,65,0.5,6.0,0.8,18,1.2,0.25,4,10,9,11,26,31,3.2",
  "WEAK,Industrials,120,7,6,11,4,70,52,3.5,9.5,3.4,3,0.9,0.55,1.2,3,2,1,38,52,1.4",
  "MIDB,Media,260,20,19,30,22,99,60,0.1,4.0,0.5,25,1.4,0.20,5,11,10,12,24,29,3.6",
  "MIDC,Healthcare,180,15,14,24,17,90,58,0.8,3.0,1.1,14,1.1,0.30,3,8,7,9,28,34,2.9",
].join("\n");

describe("scoring a table natively", () => {
  it("ranks the strongest company first and the weakest last", () => {
    const result = screen(TABLE);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0].Ticker).toBe("GOOD");
    expect(result.rows.at(-1)!.Ticker).toBe("WEAK");
    // Every pillar is scored for every company: this table fills all of them
    // except the two forward-looking metrics, which no source here carries.
    for (const row of result.rows) {
      for (const pillar of QS_PILLARS) expect(row.piliers[pillar]).not.toBeNull();
    }
  });

  it("reports the forward-looking metrics as missing without counting them against anyone", () => {
    /*
     * The application holds no analyst estimates and must not invent any. The
     * reader still has to be told the column is absent, because it makes the
     * run incomparable with one where it was present — so it stays in
     * `missing`.
     *
     * What changed is that it no longer counts as a hole. A column no company
     * in the universe carries is not missing data, it is a column this source
     * does not produce, and charging every company for the same absence is how
     * complete filers came out unrated: the two forward metrics alone are eight
     * per cent of the weight, which put native coverage under the floor before
     * any company-specific gap.
     */
    const result = screen(TABLE);
    expect(result.missing).toContain("RevFwd3");
    expect(result.missing).toContain("FwdP_FCF");
    expect(result.rows[0].couverture).toBe(1);
    expect(result.rows[0].note).not.toBe("NR");
  });

  it("penalises alerts in the risk-adjusted score only", () => {
    const result = screen(TABLE);
    const weak = result.all.find((row) => row.Ticker === "WEAK")!;
    expect(weak.alertes).toBeGreaterThan(0);
    expect(weak.conviction).toBeLessThan(weak.total!);
    const good = result.all.find((row) => row.Ticker === "GOOD")!;
    expect(good.alertes).toBe(0);
    expect(good.conviction).toBe(good.total);
  });

  it("applies a preset and a filter without touching the engine's arithmetic", () => {
    const plain = screen(TABLE);
    const purist = screen(TABLE, { preset: "quality-purist" });
    // Same companies, same universe, different weighting of the same pillars.
    expect(purist.weights.Quality).toBe(55);
    expect(purist.all.map((row) => row.Ticker).sort()).toEqual(plain.all.map((row) => row.Ticker).sort());
    for (const pillar of QS_PILLARS) {
      const before = plain.all.find((row) => row.Ticker === "GOOD")!.piliers[pillar];
      const after = purist.all.find((row) => row.Ticker === "GOOD")!.piliers[pillar];
      expect(after).toBe(before);
    }
    const filtered = screen(TABLE, { top: 2 });
    expect(filtered.rows).toHaveLength(2);
    expect(filtered.all).toHaveLength(5);
  });

  it("refuses a table it cannot read, with the parser's own message", () => {
    expect(() => screen("no,header,here")).toThrow();
    expect(() => screen("Name,Value\nfoo,1")).toThrow(/Ticker/);
  });

  it("lists the sectors actually present", () => {
    expect(sectorsOf(screen(TABLE).all)).toEqual(["Healthcare", "Industrials", "Media", "Payments", "Software"]);
  });
});

describe("rendering the scores", () => {
  it("keeps the printed dashboard's red-yellow-green scale", () => {
    expect(scoreColour(0)).toBe("rgb(248, 105, 107)");
    expect(scoreColour(50)).toBe("rgb(255, 235, 132)");
    expect(scoreColour(100)).toBe("rgb(99, 190, 123)");
    // Out of range is clamped, not wrapped.
    expect(scoreColour(140)).toBe(scoreColour(100));
    expect(scoreColour(null)).toBe("var(--qs-empty)");
  });

  it("puts dark ink on the light half of the scale and light ink on the dark", () => {
    expect(scoreInk(50)).toBe("#141414");
    expect(scoreInk(0)).toBe("#ffffff");
  });

  it("exports the detail the table keeps folded away", () => {
    const csv = resultsToCsv(screen(TABLE).rows);
    const [header, first] = csv.split("\n");
    expect(header).toContain("Strengths");
    expect(header).toContain("Weaknesses");
    expect(header).toContain("Alert detail");
    expect(first.startsWith("1,GOOD,Payments")).toBe(true);
  });

  it("offers every metric the engine weights", () => {
    expect(QS_METRICS.length).toBeGreaterThan(20);
    expect(new Set(QS_METRICS.map((metric) => metric.pilier))).toEqual(new Set(QS_PILLARS));
  });
});

describe("ordering the table by a column", () => {
  it("opens a column in the direction that puts its best rows on top", () => {
    // The engine already knows which way each ranking reads; a header must not
    // decide it a second time and disagree.
    expect(naturalDirection("total")).toBe("desc");
    expect(naturalDirection("alertes")).toBe("asc");
    expect(naturalDirection("ticker")).toBe("asc");
  });

  it("sorts both ways, and keeps companies with no value at the bottom of each", () => {
    const rows = screen(TABLE).all;
    const down = sortRowsBy(rows, "Value", "desc").map((row) => row.Ticker);
    const up = sortRowsBy(rows, "Value", "asc").map((row) => row.Ticker);
    expect(down).toEqual([...up].reverse());
    expect(down[0]).not.toBe(down.at(-1));
  });

  it("never promotes a missing value by reversing", () => {
    const rows = screen(TABLE).all;
    // WEAK carries no interest-coverage figure in this table, so its sector
    // rank is the column with a genuine absence: whichever way it points, an
    // absent value stays last rather than becoming the winner.
    const blanked = rows.map((row) => row.Ticker === "WEAK" ? { ...row, total: null } : row);
    for (const direction of ["asc", "desc"] as const) {
      expect(sortRowsBy(blanked, "total", direction).at(-1)!.Ticker).toBe("WEAK");
    }
  });

  it("sorts text columns alphabetically rather than numerically", () => {
    const rows = screen(TABLE).all;
    expect(sortRowsBy(rows, "ticker", "asc").map((row) => row.Ticker))
      .toEqual([...rows.map((row) => row.Ticker)].sort());
  });
});

describe("reading a market-cap column in whatever unit it was pasted in", () => {
  it("leaves a column already in billions alone", () => {
    // Every figure this application generates is in billions already.
    expect(detectCapDivisor([400, 300, 120, 260, 180])).toBe(1);
    expect(detectCapDivisor([4579, 3188, 48])).toBe(1);
  });

  it("recognises whole dollars, which is how most exports state it", () => {
    // 4.58e12 dollars is Apple; read as billions it would be 4.6 billion
    // billion, which is what printed "4579000000.0T" on screen.
    expect(detectCapDivisor([4.58e12, 3.19e12, 4.8e10])).toBe(1e9);
  });

  it("recognises millions", () => {
    expect(detectCapDivisor([4_580_000, 3_190_000, 48_000])).toBe(1e3);
  });

  it("says nothing, and divides by nothing, when there is no cap at all", () => {
    expect(detectCapDivisor([null, null])).toBe(1);
    expect(detectCapDivisor([])).toBe(1);
  });

  it("converts the column and tells the reader it did", () => {
    const inDollars = TABLE.split("\n").map((line, index) => {
      if (index === 0) return line;
      const cells = line.split(",");
      cells[2] = String(Number(cells[2]) * 1e9);
      return cells.join(",");
    }).join("\n");
    const result = screen(inDollars);
    const plain = screen(TABLE);
    // The same companies, the same scores, the cap back in billions.
    expect(result.all.map((row) => row.Cap)).toEqual(plain.all.map((row) => row.Cap));
    expect(result.all.map((row) => row.total)).toEqual(plain.all.map((row) => row.total));
    expect(result.warnings.join(" ")).toMatch(/converted to billions/);
    expect(plain.warnings.join(" ")).not.toMatch(/converted to billions/);
  });
});
