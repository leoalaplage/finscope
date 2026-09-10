import { describe, expect, it, vi } from "vitest";
import { readTwice, readWithin, CACHE_READ_MS } from "../lib/dataset-cache";

/**
 * A cache read that is allowed to give up.
 *
 * The Worker's own logs caught this in production: about one request in ten to
 * a warm endpoint returned `outcome: canceled`, a wall time of exactly the
 * client's timeout, and a CPU time of nought or one millisecond. Nought
 * milliseconds of CPU over six seconds is a Worker parked on an await, and on
 * a cache hit the only await before the response is the KV read. It never
 * failed and never threw — it simply never settled, and the reader watched
 * "Reading the filings" until they closed the tab.
 */

const never = () => new Promise<string>(() => { /* the failure this exists for */ });
const slow = (ms: number, value: string) => new Promise<string>((resolve) => setTimeout(() => resolve(value), ms));

describe("a cache read with a ceiling", () => {
  it("gives back what a healthy read returns", async () => {
    await expect(readWithin(Promise.resolve("body"))).resolves.toBe("body");
  });

  it("gives up on a read that never settles", async () => {
    vi.useFakeTimers();
    try {
      const read = readWithin(never(), 2_000);
      await vi.advanceTimersByTimeAsync(2_001);
      await expect(read).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a slow read that is still going to answer", async () => {
    vi.useFakeTimers();
    try {
      const read = readWithin(slow(1_500, "late"), 2_000);
      await vi.advanceTimersByTimeAsync(1_600);
      await expect(read).resolves.toBe("late");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a rejection as a miss rather than throwing", async () => {
    // Every caller already knows how to walk the miss path; none of them are
    // written to catch a store that fails mid-read.
    await expect(readWithin(Promise.reject(new Error("kv")))).resolves.toBeNull();
  });

  it("leaves a hundred and fifty times the healthy latency", () => {
    // A warm read of this store answers in eight to fourteen milliseconds, so
    // nothing healthy is ever cut short.
    expect(CACHE_READ_MS).toBe(2_000);
  });
});

describe("the second chance", () => {
  it("asks again when the first attempt stalls", async () => {
    vi.useFakeTimers();
    try {
      const attempts: number[] = [];
      let call = 0;
      const read = readTwice(() => { call += 1; attempts.push(call); return call === 1 ? never() : Promise.resolve("body"); }, 2_000);
      await vi.advanceTimersByTimeAsync(2_001);
      await expect(read).resolves.toBe("body");
      // A stall is not a property of the key: the request after it answers in
      // nine milliseconds.
      expect(attempts).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not ask twice when the first attempt answers", async () => {
    let calls = 0;
    const value = await readTwice(() => { calls += 1; return Promise.resolve("body"); });
    expect(value).toBe("body");
    expect(calls).toBe(1);
  });

  it("calls it a miss when both attempts stall", async () => {
    vi.useFakeTimers();
    try {
      const read = readTwice(never, 2_000);
      await vi.advanceTimersByTimeAsync(4_002);
      await expect(read).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
