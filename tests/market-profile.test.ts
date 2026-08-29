import { describe, expect, it } from "vitest";
import { resolveMarketProfile, TICKER_PATTERN } from "../lib/market-profile";
import { companyByTicker } from "../lib/company-registry";

describe("resolving a company for market data", () => {
  it("prefers the registry, so a known company keeps its split history", () => {
    const apple = resolveMarketProfile("aapl");
    expect(apple).toBe(companyByTicker("AAPL"));
    expect(apple?.stockSplits?.length).toBeGreaterThan(0);
  });

  it("resolves a company the registry has never heard of", () => {
    /*
     * The bug this exists for. `/api/company/COST` returned a fully normalized
     * set of filings while `/api/price/COST` answered 404 "Ticker not
     * supported", because the price endpoints read the twenty-one-company
     * registry and the fundamentals endpoint read the SEC. So the first company
     * a reader added themselves loaded its financials and then showed no price,
     * no market capitalisation, no valuation multiple, no chart and no DCF.
     */
    const profile = resolveMarketProfile("COST");
    expect(profile?.ticker).toBe("COST");
    expect(profile?.yahooTicker).toBe("COST");
  });

  it("does not claim a split history it has not verified", () => {
    // A synthesised profile must never let a long per-share price series look
    // as vouched-for as a registry company's.
    const profile = resolveMarketProfile("COST");
    expect(profile?.stockSplits).toBeUndefined();
    expect(profile?.resolutionStatus).toBe("partial");
    expect(profile?.resolutionNote).toMatch(/split/i);
  });

  it("refuses anything that is not shaped like an exchange symbol", () => {
    // The symbol arrives in a path anyone may write, and is passed to an
    // upstream request.
    expect(resolveMarketProfile("<script>")).toBeNull();
    expect(resolveMarketProfile("")).toBeNull();
    expect(resolveMarketProfile("a very long symbol")).toBeNull();
  });

  it("keeps the dots and dashes real symbols carry", () => {
    expect(resolveMarketProfile("brk.b")?.ticker).toBe("BRK.B");
    expect(resolveMarketProfile("rds-a")?.ticker).toBe("RDS-A");
    expect(TICKER_PATTERN.test("BRK.B")).toBe(true);
  });
});

describe("caching market answers", () => {
  it("keeps today apart from a settled session", async () => {
    const { isToday, TODAY_SECONDS, SETTLED_SECONDS } = await import("../lib/market-cache");
    expect(isToday(new Date().toISOString().slice(0, 10))).toBe(true);
    expect(isToday("2020-01-02")).toBe(false);
    // A closing price for a past session is settled; today's is not, and
    // answering both with a day of caching froze the headline price for a
    // whole trading day.
    expect(TODAY_SECONDS).toBeLessThanOrEqual(600);
    expect(SETTLED_SECONDS).toBeGreaterThanOrEqual(3_600);
  });

  it("builds once and serves the stored body afterwards", async () => {
    const { cachedJson, marketKey } = await import("../lib/market-cache");
    const { setRuntimeBindings } = await import("../lib/runtime-env");
    const store = new Map<string, string>();
    setRuntimeBindings({ DATASET_CACHE: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => { store.set(key, value); },
    } });
    let built = 0;
    const build = async () => { built += 1; return { price: 12 }; };
    expect(await cachedJson("price:X:2020-01-02", 60, build)).toEqual({ body: '{"price":12}', hit: false });
    expect(await cachedJson("price:X:2020-01-02", 60, build)).toEqual({ body: '{"price":12}', hit: true });
    expect(built).toBe(1);
    expect(store.has(marketKey("price:X:2020-01-02"))).toBe(true);
    setRuntimeBindings({});
  });

  it("still answers when nothing is bound, as under a bare vite dev", async () => {
    const { cachedJson } = await import("../lib/market-cache");
    const { setRuntimeBindings } = await import("../lib/runtime-env");
    setRuntimeBindings({});
    expect(await cachedJson("price:X:2020-01-02", 60, async () => ({ price: 3 }))).toEqual({ body: '{"price":3}', hit: false });
  });
});
