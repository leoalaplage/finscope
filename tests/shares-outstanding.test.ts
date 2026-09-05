import { describe, expect, it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { marketBasis, shareCount } from "../lib/market-basis";
import type { CompanyDataset, PricePoint } from "../lib/types";

/*
 * The share count a market capitalisation is built on, in three answers.
 *
 * The balance-sheet parenthetical is the count on the day the books closed and
 * is preferred wherever a filer publishes one. Where none does — a filer with
 * several share classes tags it per class, and nothing undimensioned reaches
 * this endpoint — the count on the cover of the report stands in: a real count
 * of real shares, dated the day the report was signed rather than the day the
 * period ended. It was read and then discarded for exactly that reason, because
 * the normalizer joins point-in-time facts to a period by exact date, and the
 * diluted weighted average silently took its place: 1.6% above Apple's real
 * count, 3.2% above JPMorgan's, 4.4% below Rivian's, and six per cent above
 * Booking's. The average is now the last resort rather than the second one, and
 * whichever answer is used says which one it is.
 */

const company: CompanyDataset["company"] = { name: "Apple Inc", ticker: "AAPL", cik: "0000320193", exchange: "NASDAQ", currency: "USD", sector: "Technology", description: "A fixture." };
const END = "2025-09-27";
const OUTSTANDING = 14_773_260_000;
const DILUTED = 15_004_697_000;
/** What the cover of the same report states, three weeks after the close. */
const COVER = 14_776_400_000;

type Unit = { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string };
const fact = (val: number, end: string, start?: string): Unit => ({ start, end, val, accn: "0000320193-25-000079", fy: 2025, fp: "FY", form: "10-K", filed: "2025-10-31" });

function build(extra: { gaapOutstanding?: boolean; coverPage?: boolean }) {
  const gaap: Record<string, { units: Record<string, Unit[]> }> = {
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [fact(416_161e6, END, "2024-09-29")] } },
    WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [fact(DILUTED, END, "2024-09-29")] } },
    CashAndCashEquivalentsAtCarryingValue: { units: { USD: [fact(35_934e6, END)] } },
    LongTermDebtCurrent: { units: { USD: [fact(12_350e6, END)] } },
    LongTermDebtNoncurrent: { units: { USD: [fact(78_328e6, END)] } },
  };
  if (extra.gaapOutstanding) gaap.CommonStockSharesOutstanding = { units: { shares: [fact(OUTSTANDING, END)] } };
  const facts: Record<string, unknown> = { "us-gaap": gaap };
  // The cover page states the count on the filing date, not the period end.
  if (extra.coverPage) facts.dei = { EntityCommonStockSharesOutstanding: { units: { shares: [fact(COVER, "2025-10-17")] } } };
  return normalizeSecPayload({ entityName: "Apple Inc", facts }, "AAPL", "2026-08-31", company);
}

const annual = (dataset: CompanyDataset) => dataset.periods.find((period) => period.periodicity === "annual")!;
const price: PricePoint = { close: 250, priceClose: 250, totalReturnClose: 250, adjustedClose: 250, date: "2026-08-28", requestedDate: "2026-08-28", currency: "USD", ticker: "AAPL", type: "split-adjusted close", fallback: "exact date", distanceDays: 0, sourceUrl: "yahoo" };

describe("period-end shares outstanding", () => {
  it("reads the balance-sheet count the filer states at its year end", () => {
    const year = annual(build({ gaapOutstanding: true, coverPage: true }));
    expect(year.facts.sharesOutstanding?.value).toBe(OUTSTANDING);
    expect(year.facts.sharesOutstanding?.provenance.concept).toBe("us-gaap:CommonStockSharesOutstanding");
    // And it is the count the market capitalisation is built on.
    const basis = marketBasis(year, price).basis!;
    expect(basis.sharesBasis).toBe("outstanding");
    expect(basis.sharesNote).toBeUndefined();
    expect(basis.marketCap).toBe(250 * OUTSTANDING);
  });

  it("reads the cover-page count where the filer publishes no parenthetical", () => {
    /*
     * A multi-class filer tags the parenthetical per class, so nothing
     * undimensioned reaches this endpoint and the cover of the report is the
     * only count there is. It is dated the day the report was signed — Apple's
     * is 17 October against a 27 September year end — so it matched no period
     * and was dropped, and an average over the whole year stood in for it.
     *
     * It is a real count of real shares, three thousandths of a percent from
     * Apple's own parenthetical against the 1.6% the average is away.
     */
    const year = annual(build({ coverPage: true }));
    expect(year.facts.sharesOutstanding?.value).toBe(COVER);
    expect(year.facts.sharesOutstanding?.provenance.concept).toBe("dei:EntityCommonStockSharesOutstanding");
    const counted = shareCount(year)!;
    expect(counted.shares).toBe(COVER);
    expect(counted.basis).toBe("cover-date");
    expect(counted.note).toContain("cover");
    expect(Math.abs(COVER / OUTSTANDING - 1)).toBeLessThan(.001);
    expect(DILUTED / OUTSTANDING - 1).toBeCloseTo(.0157, 3);
  });

  it("keeps the parenthetical where the filer publishes one", () => {
    // The cover count never displaces a count taken on the day the books
    // closed; it stands in for one, and only where there is none.
    const year = annual(build({ gaapOutstanding: true, coverPage: true }));
    expect(shareCount(year)!.basis).toBe("outstanding");
  });

  it("falls back to the diluted average only where no count exists at all", () => {
    const year = annual(build({}));
    expect(year.facts.sharesOutstanding?.value).toBeUndefined();
    const counted = shareCount(year)!;
    expect(counted.shares).toBe(DILUTED);
    expect(counted.basis).toBe("diluted");
    expect(counted.note).toContain("average");
  });
});
