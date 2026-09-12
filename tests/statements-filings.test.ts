import { describe, expect, it } from "vitest";
import { lastFiled } from "../components/io/Statements";
import type { IoPeriod } from "../lib/io/view";

/**
 * What the statements table is as current as.
 *
 * A company whose newest column is five months old is either a company that
 * has filed nothing since, or a site that has stopped looking, and until now
 * nothing on the page told the two apart. Copart's results were on the wire
 * two days before its figures here were questioned — and the statements were
 * exactly as current as the SEC's own copy, which is precisely what the reader
 * could not see.
 */
const period = (label: string, end: string): IoPeriod => ({
  label, end, publishedAt: end, currency: "USD", values: {},
} as IoPeriod);

describe("the period a company has last filed", () => {
  it("is the newest quarter when the filer reports quarterly", () => {
    const view = {
      annual: [period("FY2025", "2025-07-31")],
      quarterly: [period("Q2 FY2026", "2026-01-31"), period("Q3 FY2026", "2026-04-30")],
    };
    expect(lastFiled(view)?.label).toBe("Q3 FY2026");
  });

  it("falls back to the year where there are no quarters to have", () => {
    expect(lastFiled({ annual: [period("FY2025", "2025-12-31")], quarterly: [] })?.label).toBe("FY2025");
  });

  it("is nothing at all rather than a guess when neither exists", () => {
    expect(lastFiled({ annual: [], quarterly: [] })).toBeNull();
  });

  it("is what the filer filed, never the window this application computes", () => {
    /*
     * The trailing twelve months is the leftmost column of the table and the
     * most current statement of the business there is — and nobody filed it.
     * A reader asking what has been filed is asking about the filings.
     */
    const view = { annual: [], quarterly: [period("Q3 FY2026", "2026-04-30")], ttm: period("TTM Q3 FY2026", "2026-04-30") };
    expect(lastFiled(view)?.label).toBe("Q3 FY2026");
  });
});
