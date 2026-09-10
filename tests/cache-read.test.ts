import { describe, expect, it, vi } from "vitest";
import { readWithin, CACHE_READ_MS } from "../lib/dataset-cache";

/**
 * A cache read that is allowed to give up, and says whether it did.
 *
 * The Worker's own logs caught this in production: about one request in ten to
 * a warm endpoint returned `outcome: canceled`, a wall time of exactly the
 * client's timeout, and a CPU time of nought or one millisecond. Nought
 * milliseconds of CPU over six seconds is a Worker parked on an await, and on
 * a cache hit the only await before the response is the KV read. It never
 * failed and never threw — it simply never settled.
 */

const never = () => new Promise<string>(() => { /* the failure this exists for */ });
const slow = (ms: number, value: string) => new Promise<string>((resolve) => setTimeout(() => resolve(value), ms));

describe("a cache read with a ceiling", () => {
  it("gives back what a healthy read returns", async () => {
    await expect(readWithin(Promise.resolve("body"))).resolves.toEqual({ settled: true, value: "body" });
  });

  it("gives up on a read that never settles, and says so", async () => {
    vi.useFakeTimers();
    try {
      const read = readWithin(never(), 1_500);
      await vi.advanceTimersByTimeAsync(1_501);
      await expect(read).resolves.toEqual({ settled: false, value: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a slow read that is still going to answer", async () => {
    vi.useFakeTimers();
    try {
      const read = readWithin(slow(1_100, "late"), 1_500);
      await vi.advanceTimersByTimeAsync(1_200);
      await expect(read).resolves.toEqual({ settled: true, value: "late" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells an empty answer apart from no answer", async () => {
    /*
     * The distinction is the whole point. "The store said there is nothing
     * here" and "the store did not answer" call for opposite things: the first
     * is a miss and means build it, the second means ask again in a moment.
     * Conflating them sent a reader whose company was cached all along down
     * the build path — an SEC lookup, a claim, a handoff — for a key that
     * would have answered in nine milliseconds on the next try.
     */
    await expect(readWithin(Promise.resolve(null))).resolves.toEqual({ settled: true, value: null });
    vi.useFakeTimers();
    try {
      const read = readWithin(never(), 1_500);
      await vi.advanceTimersByTimeAsync(1_501);
      await expect(read).resolves.toEqual({ settled: false, value: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a rejection as an answered miss rather than throwing", async () => {
    // Every caller already knows how to walk the miss path; none of them are
    // written to catch a store that fails mid-read.
    await expect(readWithin(Promise.reject(new Error("kv")))).resolves.toEqual({ settled: true, value: null });
  });

  it("leaves a hundred times the healthy latency", () => {
    // A warm read of this store answers in eight to fourteen milliseconds, so
    // nothing well is ever cut short — and the budget is one read rather than
    // several, because two retries and a fallback added to eight seconds,
    // which is a hang by another name.
    expect(CACHE_READ_MS).toBe(1_500);
  });
});
