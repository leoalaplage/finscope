import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_SECONDS, datasetKey, KEY_VERSION, warmWatchlist } from "../lib/dataset-cache";
import { setRuntimeBindings } from "../lib/runtime-env";

const ORIGIN = "https://finscope.test";

/** A KV double that only needs get/put for this code path. */
function cacheDouble(warm: string[] = []) {
  const store = new Map(warm.map((ticker) => [datasetKey(ticker), "{}"]));
  return { store, get: vi.fn(async (key: string) => store.get(key) ?? null), put: vi.fn() };
}

describe("dataset cache keys", () => {
  it("namespaces by version and normalizes the ticker", () => {
    expect(datasetKey("aapl")).toBe(`company:${KEY_VERSION}:AAPL`);
    expect(datasetKey("AAPL")).toBe(datasetKey("aapl"));
  });

  it("keeps a dataset for a day, because filings change quarterly at most", () => {
    expect(CACHE_SECONDS).toBe(86_400);
  });
});

describe("scheduled warm-up", () => {
  beforeEach(() => setRuntimeBindings({}));

  it("fetches each company once, in order, through the public endpoint", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => { seen.push(url.pathname); return new Response("{}", { status: 200 }); }));
    const report = await warmWatchlist(ORIGIN, ["AAPL", "MSFT"]);
    expect(seen).toEqual(["/api/company/AAPL", "/api/company/MSFT"]);
    expect(report.warmed).toEqual(["AAPL", "MSFT"]);
    expect(report.failed).toEqual([]);
  });

  it("skips a company already stored under the current version", async () => {
    setRuntimeBindings({ DATASET_CACHE: cacheDouble(["AAPL"]) });
    const call = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", call);
    const report = await warmWatchlist(ORIGIN, ["AAPL", "MSFT"]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(report.warmed).toEqual(["AAPL", "MSFT"]);
  });

  it("retries a refused company once, since a refusal is usually a busy isolate", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { attempts += 1; return new Response("", { status: attempts === 1 ? 503 : 200 }); }));
    const report = await warmWatchlist(ORIGIN, ["AAPL"]);
    expect(attempts).toBe(2);
    expect(report.warmed).toEqual(["AAPL"]);
  });

  it("records a company that fails twice and carries on with the rest", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) =>
      url.pathname.endsWith("MSFT") ? new Response("", { status: 503 }) : new Response("{}", { status: 200 })));
    const report = await warmWatchlist(ORIGIN, ["AAPL", "MSFT", "V"]);
    expect(report.warmed).toEqual(["AAPL", "V"]);
    expect(report.failed).toEqual([{ ticker: "MSFT", reason: "HTTP 503" }]);
  });

  it("survives a network error rather than abandoning the batch", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("AAPL")) throw new Error("connection reset");
      return new Response("{}", { status: 200 });
    }));
    const report = await warmWatchlist(ORIGIN, ["AAPL", "MSFT"]);
    expect(report.failed).toEqual([{ ticker: "AAPL", reason: "connection reset" }]);
    expect(report.warmed).toEqual(["MSFT"]);
  });
});
