import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_SECONDS, datasetKey, KEY_VERSION, missingTickers, requestedTickers, summaryKey, WATCHLIST_LIMIT, warmSomeMissing, warmWatchlist } from "../lib/dataset-cache";
import { COVERED_TICKERS, DEFAULT_WATCHLIST } from "../lib/company-registry";
import { setRuntimeBindings } from "../lib/runtime-env";

const ORIGIN = "https://finscope.test";
/** The warm asks through a Request now, so tests read the path back off it. */
const path = (request: Request) => new URL(request.url).pathname;
/** The real pacing exists to avoid platform throttling, not to slow tests. */
const INSTANT = { paceMs: 0, retryMs: 0, retries: 2 };

/**
 * A KV double that only needs get/put for this code path.
 *
 * `get` honours the type argument, because the code under test relies on it:
 * presence is probed with `"stream"` precisely so that a five-megabyte dataset
 * is never pulled into memory to answer a yes/no question, and a double that
 * hands back a string either way would let that regress unnoticed.
 */
function cacheDouble(warm: string[] = [], digested = warm) {
  const store = new Map<string, string>([
    ...warm.map((ticker) => [datasetKey(ticker), "{}"] as const),
    ...digested.map((ticker) => [summaryKey(ticker), "{}"] as const),
  ]);
  return {
    store,
    get: vi.fn(async (key: string, type?: string) => {
      const value = store.get(key);
      if (value == null) return null;
      if (type !== "stream") return value;
      return new Response(value).body;
    }),
    put: vi.fn(),
  };
}

describe("dataset cache keys", () => {
  it("namespaces by version and normalizes the ticker", () => {
    expect(datasetKey("aapl")).toBe(`company:${KEY_VERSION}:AAPL`);
    expect(datasetKey("AAPL")).toBe(datasetKey("aapl"));
  });

  it("keeps a dataset far longer than the warm-up interval, so a missed run is survivable", () => {
    // The margin is the point, not the absolute number: a lifetime equal to the
    // refresh interval expires every key exactly when its replacement is due,
    // so one skipped cron empties the watchlist. See CACHE_SECONDS.
    expect(CACHE_SECONDS).toBeGreaterThanOrEqual(6 * 86_400);
  });
});

describe("scheduled warm-up", () => {
  beforeEach(() => setRuntimeBindings({}));

  it("fetches each company once, in order, through the public endpoint", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => { seen.push(path(request)); return new Response("{}", { status: 200 }); }));
    const report = await warmWatchlist(ORIGIN, ["AAPL", "MSFT"], INSTANT);
    expect(seen).toEqual(["/api/company/AAPL", "/api/company/MSFT"]);
    expect(report.warmed).toEqual(["AAPL", "MSFT"]);
    expect(report.failed).toEqual([]);
  });

  it("skips a company already stored under the current version", async () => {
    setRuntimeBindings({ DATASET_CACHE: cacheDouble(["AAPL"]) });
    const call = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", call);
    const report = await warmWatchlist(ORIGIN, ["AAPL", "MSFT"], INSTANT);
    expect(call).toHaveBeenCalledTimes(1);
    expect(report.warmed).toEqual(["AAPL", "MSFT"]);
  });

  it("revisits a company whose dataset predates the watchlist digest", async () => {
    // Stored, but with nothing for the home page to read. Skipping it on the
    // strength of the dataset alone would leave that card empty for good.
    setRuntimeBindings({ DATASET_CACHE: cacheDouble(["AAPL", "MSFT"], ["MSFT"]) });
    const seen: string[] = [];
    const call = vi.fn(async (request: Request) => { seen.push(path(request)); return new Response("{}", { status: 200 }); });
    vi.stubGlobal("fetch", call);
    await warmWatchlist(ORIGIN, ["AAPL", "MSFT"], INSTANT);
    expect(seen).toEqual(["/api/company/AAPL"]);
  });

  it("retries a refused company once, since a refusal is usually a busy isolate", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { attempts += 1; return new Response("", { status: attempts === 1 ? 503 : 200 }); }));
    const report = await warmWatchlist(ORIGIN, ["AAPL"], INSTANT);
    expect(attempts).toBe(2);
    expect(report.warmed).toEqual(["AAPL"]);
  });

  it("records a company that fails twice and carries on with the rest", async () => {
    vi.stubGlobal("fetch", vi.fn(async (request: Request) =>
      path(request).endsWith("MSFT") ? new Response("", { status: 503 }) : new Response("{}", { status: 200 })));
    const report = await warmWatchlist(ORIGIN, ["AAPL", "MSFT", "V"], INSTANT);
    expect(report.warmed).toEqual(["AAPL", "V"]);
    expect(report.failed).toEqual([{ ticker: "MSFT", reason: "HTTP 503" }]);
  });

  it("survives a network error rather than abandoning the batch", async () => {
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      if (path(request).endsWith("AAPL")) throw new Error("connection reset");
      return new Response("{}", { status: 200 });
    }));
    const report = await warmWatchlist(ORIGIN, ["AAPL", "MSFT"], INSTANT);
    expect(report.failed).toEqual([{ ticker: "AAPL", reason: "connection reset" }]);
    expect(report.warmed).toEqual(["MSFT"]);
  });

  it("never pulls a whole dataset into memory to decide whether it is cached", () => {
    // A presence probe that reads the value costs five megabytes a company. See
    // isCached: this is the guard against that returning by accident.
    const cache = cacheDouble(["AAPL"]);
    setRuntimeBindings({ DATASET_CACHE: cache });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    return warmWatchlist(ORIGIN, ["AAPL"], INSTANT).then(() => {
      const datasetReads = cache.get.mock.calls.filter(([key]) => key === datasetKey("AAPL"));
      expect(datasetReads).not.toHaveLength(0);
      for (const [, type] of datasetReads) expect(type).toBe("stream");
    });
  });
});

describe("filling the cache on the way to serving a request", () => {
  beforeEach(() => setRuntimeBindings({}));

  it("reports the companies with no usable entry, digest included", async () => {
    setRuntimeBindings({ DATASET_CACHE: cacheDouble(["AAPL", "MSFT"], ["AAPL"]) });
    const missing = await missingTickers(["AAPL", "MSFT", "V"]);
    // MSFT has a dataset but no digest, which is no use to a watchlist card.
    expect(missing).toEqual(["MSFT", "V"]);
  });

  it("builds only a bounded batch, so one request cannot run away with the isolate", async () => {
    setRuntimeBindings({ DATASET_CACHE: cacheDouble() });
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => { seen.push(path(request)); return new Response("{}", { status: 200 }); }));
    const report = await warmSomeMissing(ORIGIN, 2);
    expect(seen).toHaveLength(2);
    expect(report.warmed).toHaveLength(2);
  });

  it("claims a company before building it, so concurrent requests do not duplicate the work", async () => {
    const cache = cacheDouble();
    setRuntimeBindings({ DATASET_CACHE: cache });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await warmSomeMissing(ORIGIN, 1);
    const claims = cache.put.mock.calls.filter(([key]) => String(key).startsWith("warming:"));
    expect(claims).toHaveLength(1);
    // The claim must outlive the build by enough to cover KV's read lag.
    expect((claims[0][2] as { expirationTtl: number }).expirationTtl).toBeGreaterThanOrEqual(60);
  });

  it("skips a company another request has already claimed", async () => {
    const cache = cacheDouble();
    const first = DEFAULT_WATCHLIST.filter((company) => company.resolutionStatus !== "unresolved")[0].ticker;
    cache.store.set(`warming:${KEY_VERSION}:${first}`, "1");
    setRuntimeBindings({ DATASET_CACHE: cache });
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => { seen.push(path(request)); return new Response("{}", { status: 200 }); }));
    await warmSomeMissing(ORIGIN, 1);
    expect(seen).not.toContain(`/api/company/${first}`);
    expect(seen).toHaveLength(1);
  });

  it("does nothing at all once every company is cached", async () => {
    const all = DEFAULT_WATCHLIST.filter((company) => company.resolutionStatus !== "unresolved").map((company) => company.ticker);
    setRuntimeBindings({ DATASET_CACHE: cacheDouble(all) });
    const call = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", call);
    const report = await warmSomeMissing(ORIGIN);
    expect(call).not.toHaveBeenCalled();
    expect(report).toEqual({ warmed: [], failed: [] });
  });

  it("warms the companies the reader asked about, which the registry has never heard of", async () => {
    // The bug this exists for: a company added by hand was in no list on the
    // server, so nothing ever built it and its card stayed empty however many
    // times "Load all" was pressed.
    setRuntimeBindings({ DATASET_CACHE: cacheDouble() });
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => { seen.push(path(request)); return new Response("{}", { status: 200 }); }));
    await warmSomeMissing(ORIGIN, 2, ["ZZZZ", "YYYY"]);
    expect(seen).toEqual(["/api/company/ZZZZ", "/api/company/YYYY"]);
  });

  it("records a refusal instead of throwing into the request that triggered it", async () => {
    setRuntimeBindings({ DATASET_CACHE: cacheDouble() });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const report = await warmSomeMissing(ORIGIN, 1);
    expect(report.warmed).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].reason).toBe("HTTP 503");
  });

  it("invokes itself through the service binding, not the hostname", async () => {
    // The whole point of the binding. A plain fetch at this Worker's own
    // hostname does not re-enter the Worker — it lands on the static asset
    // store and answers 404 — so a warm built on the global fetch filled
    // nothing at all in production. See selfFetcher.
    setRuntimeBindings({
      DATASET_CACHE: cacheDouble(),
      SELF: { fetch: vi.fn(async () => new Response("{}", { status: 200 })) },
    });
    const global = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", global);
    const report = await warmSomeMissing(ORIGIN, 1);
    expect(global).not.toHaveBeenCalled();
    expect(report.warmed).toHaveLength(1);
  });

  it("falls back to the global fetch where nothing is bound, as under vite dev", async () => {
    setRuntimeBindings({ DATASET_CACHE: cacheDouble() });
    const global = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", global);
    const report = await warmSomeMissing(ORIGIN, 1);
    expect(global).toHaveBeenCalledTimes(1);
    expect(report.warmed).toHaveLength(1);
  });

  it("stays inert without a cache binding rather than fetching into the void", async () => {
    const call = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", call);
    expect(await warmSomeMissing(ORIGIN)).toEqual({ warmed: [], failed: [] });
    expect(await missingTickers()).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("the watchlist a reader asks about", () => {
  it("is theirs, not the built-in one", () => {
    expect(requestedTickers("nvda,zzzz", COVERED_TICKERS)).toEqual(["NVDA", "ZZZZ"]);
  });

  it("falls back to the built-in list when the client says nothing, as an older one does", () => {
    expect(requestedTickers(null, COVERED_TICKERS)).toBe(COVERED_TICKERS);
    expect(requestedTickers("", COVERED_TICKERS)).toBe(COVERED_TICKERS);
    expect(requestedTickers(" , ,", COVERED_TICKERS)).toBe(COVERED_TICKERS);
  });

  it("is bounded, because it arrives in a query string anyone may write", () => {
    expect(requestedTickers("AAPL,<script>,AAPL, a very long symbol ", COVERED_TICKERS)).toEqual(["AAPL"]);
    const many = Array.from({ length: WATCHLIST_LIMIT + 20 }, (_, index) => `T${index}`).join(",");
    expect(requestedTickers(many, COVERED_TICKERS)).toHaveLength(WATCHLIST_LIMIT);
  });

  it("keeps the dots and dashes real symbols carry", () => {
    expect(requestedTickers("brk.b,rds-a", COVERED_TICKERS)).toEqual(["BRK.B", "RDS-A"]);
  });
});
