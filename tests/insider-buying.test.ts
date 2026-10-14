import { describe, expect, it } from "vitest";
import { insiderClusters, type InsiderPurchase } from "../lib/insider-buying";

const buy = (ticker: string, owner: string, date: string, value = 100_000): InsiderPurchase => ({
  ticker, cik: "1", owner, role: "Director", date, filed: date, shares: 1000, price: value / 1000, value, sharesAfter: null, url: "u",
});

describe("insider buying clusters", () => {
  it("needs two different insiders of one company within a fortnight", () => {
    const clusters = insiderClusters([
      buy("AAA", "Jane Doe", "2026-09-01"), buy("AAA", "John Roe", "2026-09-10"), buy("AAA", "Max Poe", "2026-09-12"),
      buy("BBB", "Ann Lee", "2026-09-01"), buy("BBB", "Ann Lee", "2026-09-05"),
      buy("CCC", "Bo Wu", "2026-08-01"), buy("CCC", "Cy Ng", "2026-09-01"),
    ]);
    expect(clusters.map((cluster) => cluster.ticker)).toEqual(["AAA"]);
    expect(clusters[0]).toMatchObject({ buyers: 3, from: "2026-09-01", to: "2026-09-12", value: 300_000 });
  });
});
