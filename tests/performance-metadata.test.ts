import { describe, expect, it } from "vitest";
import { performanceMetadata } from "../lib/performance-metadata";
import { resolveMarketProfile } from "../lib/market-profile";
import { fallbackSummaryKeys, summaryKey } from "../lib/dataset-cache";

describe("performance metadata during cache migrations", () => {
  it("recovers META shares from the supported prior summary", async () => {
    const result = await performanceMetadata(resolveMarketProfile("META")!, 760,
      async (key) => key === fallbackSummaryKeys("META")[0] ? { shares: 2_566_043_836, qs: { Sector: "Communication services" } } : null,
      async () => null);
    expect(result.marketCap).toBe(760 * 2_566_043_836);
    expect(result.sector).toBe("Communication services");
  });
  it("recovers a custom ticker's sector without replacing newer valid shares", async () => {
    const result = await performanceMetadata(resolveMarketProfile("CUSTOM")!, 20,
      async (key) => key === summaryKey("CUSTOM") ? { shares: 100, qs: { Sector: "Unclassified" } }
        : { shares: 80, qs: { Sector: "Software" } }, async () => null);
    expect(result).toMatchObject({ sector: "Software", marketCap: 2000 });
  });
  it("uses the served universe when individual summaries are absent or unreadable", async () => {
    const result = await performanceMetadata(resolveMarketProfile("CUSTOM")!, 20,
      async () => { throw new Error("unavailable"); }, async () => ({ name: "Custom", qsPrice: { shares: 200 }, qs: { Sector: "Energy" } }));
    expect(result).toEqual({ name: "Custom", sector: "Energy", marketCap: 4000 });
  });
  it("does not invent capitalization or sector when all sources are missing", async () => {
    const result = await performanceMetadata(resolveMarketProfile("CUSTOM")!, 20, async () => null, async () => null);
    expect(result.marketCap).toBeNull();
    expect(result.sector).toBe("Unclassified");
  });
});
