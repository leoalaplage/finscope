import { describe, expect, it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { marketBasis, shareCount } from "../lib/market-basis";
import type { CompanyDataset, PricePoint } from "../lib/types";

/*
 * The share count a market capitalisation is built on.
 *
 * Only the cover-page count was read, and it is dated the day the report is
 * filed — Apple's is 17 October against a 27 September year end — while the
 * annual normalizer anchors point facts to the period end. So it was extracted
 * and then discarded, six of the seven companies in the data audit had no share
 * count at all, and the diluted weighted average silently took its place: 1.6%
 * above Apple's real count, 3.2% above JPMorgan's, 4.4% below Rivian's.
 */

const company: CompanyDataset["company"] = { name: "Apple Inc", ticker: "AAPL", cik: "0000320193", exchange: "NASDAQ", currency: "USD", sector: "Technology", description: "A fixture." };
const END = "2025-09-27";
const OUTSTANDING = 14_773_260_000;
const DILUTED = 15_004_697_000;

type Unit = { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string };
const fact = (val: number, end: string, start?: string): Unit => ({ start, end, val, accn: "0000320193-25-000079", fy: 2025, fp: "FY", form: "10-K", filed: "2025-10-31" });

function build(extra: { gaapOutstanding?: boolean; coverPage?: boolean; coverEnd?: string; coverAccession?: string }) {
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
  if (extra.coverPage) facts.dei = { EntityCommonStockSharesOutstanding: { units: { shares: [{
    ...fact(14_776_400_000, extra.coverEnd ?? "2025-10-17"),
    accn: extra.coverAccession ?? "0000320193-25-000079",
  }] } } };
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

  it("uses the same filing's cover-page count on its actual observation date", () => {
    const year = annual(build({ coverPage: true }));
    expect(year.facts.sharesOutstanding?.value).toBe(14_776_400_000);
    expect(year.facts.sharesOutstanding?.periodEnd).toBe("2025-10-17");
    expect(year.facts.sharesOutstanding?.provenance.concept).toBe("dei:EntityCommonStockSharesOutstanding");
    expect(year.facts.sharesOutstanding?.provenance.note).toContain("not presented as a period-end balance");
    const counted = shareCount(year)!;
    expect(counted.basis).toBe("cover-date");
    expect(counted.note).toContain("2025-10-17");
    expect(marketBasis(year, price).basis?.marketCap).toBe(250 * 14_776_400_000);
  });

  it("does not borrow a cover count from another filing or a remote date", () => {
    expect(annual(build({ coverPage: true, coverAccession: "another-filing" })).facts.sharesOutstanding).toBeUndefined();
    expect(annual(build({ coverPage: true, coverEnd: "2026-10-17" })).facts.sharesOutstanding).toBeUndefined();
  });

  it("falls back to the diluted average only where no point-in-time count exists, and says so", () => {
    // A multi-class filer tags the count per class, so nothing undimensioned
    // reaches this endpoint and the average is all there is.
    const year = annual(build({}));
    expect(year.facts.sharesOutstanding?.value).toBeUndefined();
    const counted = shareCount(year)!;
    expect(counted.shares).toBe(DILUTED);
    expect(counted.basis).toBe("diluted");
    expect(counted.note).toContain("average");
    // The gap the silent substitution used to hide: 1.6% of Apple.
    expect(DILUTED / OUTSTANDING - 1).toBeCloseTo(.0157, 3);
  });
});
