import { describe, expect, it } from "vitest";
import type { Bars } from "@/lib/io/indicators";
import { allHold, backtest, cleanConditions, computeSeries, holds, readSeries, readSnapshot, snapshotOf, type Condition, type Field } from "@/lib/term/rules";

const DAY = 86_400;
/** Bars that open at the previous close, so a fill at the next open is the signal bar's close. */
function bars(closes: number[], spread = 0.5): Bars {
  return {
    t: closes.map((_, index) => index * DAY),
    o: closes.map((close, index) => (index ? closes[index - 1] : close)),
    h: closes.map((close, index) => Math.max(close, index ? closes[index - 1] : close) + spread),
    l: closes.map((close, index) => Math.min(close, index ? closes[index - 1] : close) - spread),
    c: closes,
    v: closes.map(() => 1000),
  };
}

const reader = (values: Partial<Record<Field, [number, number]>>) => (field: Field, back: number) => values[field]?.[back] ?? null;

describe("conditions", () => {
  it("compare a field with a number or another field", () => {
    expect(holds({ left: "rsi14", op: "<", right: 30 }, reader({ rsi14: [25, 40] }))).toBe(true);
    expect(holds({ left: "close", op: ">", right: "ema200" }, reader({ close: [10, 9], ema200: [11, 11] }))).toBe(false);
  });

  it("cross only on the bar where the order changes", () => {
    const up = { left: "ema20", op: "crossesAbove", right: "ema50" } as Condition;
    expect(holds(up, reader({ ema20: [11, 9], ema50: [10, 10] }))).toBe(true);
    expect(holds(up, reader({ ema20: [11, 10.5], ema50: [10, 10] }))).toBe(false);
    expect(holds({ left: "close", op: "crossesBelow", right: 10 }, reader({ close: [9, 10] }))).toBe(true);
  });

  it("treat a missing value as not holding, and an empty rule as holding nowhere", () => {
    expect(holds({ left: "rsi14", op: "<", right: 30 }, reader({}))).toBe(false);
    expect(allHold([], reader({ rsi14: [10, 10] }))).toBe(false);
  });

  it("read patterns as appearing or not", () => {
    expect(holds({ left: "hammer", op: "is" }, reader({ hammer: [1, 0] }))).toBe(true);
    expect(holds({ left: "hammer", op: "is" }, reader({ hammer: [0, 1] }))).toBe(false);
  });

  it("drop what storage hands back wrong", () => {
    expect(cleanConditions([
      { left: "rsi14", op: "<", right: 30 },
      { left: "rsi14", op: "is" },
      { left: "hammer", op: "is" },
      { left: "nonsense", op: ">", right: 1 },
      { left: "close", op: ">", right: "ema200" },
      { left: "close", op: ">", right: "ema999" },
    ])).toEqual([{ left: "rsi14", op: "<", right: 30 }, { left: "hammer", op: "is" }, { left: "close", op: ">", right: "ema200" }]);
  });
});

describe("series and snapshots", () => {
  it("compute returns, ranges and distances", () => {
    const series = computeSeries(bars([10, 11, 12, 11, 10, 12, 14, 13, 12, 15]));
    expect(series.chg1[1]).toBeCloseTo(10);
    expect(series.chg5[9]).toBeCloseTo((15 / 10 - 1) * 100);
    expect(series.high52[9]).toBeCloseTo(15.5);
    expect(series.fromHigh52[9]).toBeCloseTo((15 / 15.5 - 1) * 100);
    expect(series.volumeRatio[9]).toBeNull();
  });

  it("keep the last two bars of every field for the scanner", () => {
    const series = computeSeries(bars(Array.from({ length: 30 }, (_, index) => 100 + index)));
    const snapshot = snapshotOf(series);
    expect(snapshot.close).toEqual([129, 128]);
    expect(readSnapshot(snapshot)("chg1", 0)).toBeCloseTo((129 / 128 - 1) * 100, 3);
  });
});

describe("backtest", () => {
  // Rises from 10 to 14, falls to 9, rises to 13.
  const closes = [10, 10, 11, 12, 13, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13];
  const series = bars(closes, 0.2);
  const computed = computeSeries(series);
  const entry: Condition[] = [{ left: "close", op: "crossesAbove", right: 10.5 }];
  const exit: Condition[] = [{ left: "close", op: "crossesBelow", right: 12.5 }];

  it("acts on the next bar's open and marks a final open position at the close", () => {
    const result = backtest(series, computed, entry, exit)!;
    // Signal at bar 2 (close 11) → buy bar 3 open = 11. Exit signal bar 7 (12 < 12.5 after 13) → sell bar 8 open = 12.
    // Signal at bar 12 (11) → buy bar 13 open = 11, still open at the last close 13.
    expect(result.trades.map((trade) => [trade.entryPrice, trade.exitPrice, trade.reason])).toEqual([[11, 12, "rule"], [11, 13, "open"]]);
    expect(result.totalReturn).toBeCloseTo((12 / 11) * (13 / 11) - 1);
    expect(result.winRate).toBe(1);
    expect(result.benchmarkReturn).toBeCloseTo(13 / 10 - 1);
  });

  it("stops out at the level, cautiously when a bar touches both", () => {
    const result = backtest(series, computed, entry, [], { stopLoss: 0.05 })!;
    // Bought at 11; the stop at 10.45 is touched on the fall (bar 9's low).
    expect(result.trades[0].reason).toBe("stop");
    expect(result.trades[0].exitPrice).toBeCloseTo(10.45);
  });

  it("takes costs off both sides", () => {
    const free = backtest(series, computed, entry, exit)!;
    const costly = backtest(series, computed, entry, exit, { costBps: 10 })!;
    expect(costly.trades[0].return).toBeCloseTo((12 * 0.999) / (11 / 0.999) - 1);
    expect(costly.totalReturn).toBeLessThan(free.totalReturn);
  });

  it("measures the worst fall of the equity curve", () => {
    const result = backtest(series, computed, [{ left: "close", op: ">", right: 0 }], [])!;
    expect(result.maxDrawdown).toBeCloseTo(9 / 14 - 1);
  });

  it("reads conditions on the bar asked about", () => {
    expect(allHold(entry, readSeries(computed, 2))).toBe(true);
    expect(allHold(entry, readSeries(computed, 3))).toBe(false);
  });
});

describe("the scanner's universe", () => {
  it("reads members never read first, then the oldest past six hours", async () => {
    const { nextTechnicals, yahooSymbol, ROW_SHAPE } = await import("@/lib/term/tech-universe");
    const now = new Date("2026-10-11T12:00:00Z");
    const fresh = new Date("2026-10-11T10:00:00Z").toISOString();
    const old = new Date("2026-10-11T01:00:00Z").toISOString();
    const older = new Date("2026-10-10T20:00:00Z").toISOString();
    const { UNIVERSE } = await import("@/lib/universe");
    const rows = UNIVERSE.slice(0, UNIVERSE.length).map((member, index) => ({
      ticker: member.ticker, name: member.name, asOf: 0, values: {}, shape: ROW_SHAPE,
      builtAt: index === 0 ? old : index === 1 ? older : fresh,
    }));
    const table = { builtAt: fresh, members: UNIVERSE.length, rows: rows.slice(0, -1) };
    expect(nextTechnicals(table, 3, now)).toEqual([UNIVERSE.at(-1)!.ticker, UNIVERSE[1].ticker, UNIVERSE[0].ticker]);
    expect(yahooSymbol("BF.B")).toBe("BF-B");
  });
});

describe("members with no history", () => {
  it("are set aside for a day and do not hold the table open", async () => {
    const { isWhole, nextTechnicals, ROW_SHAPE } = await import("@/lib/term/tech-universe");
    const { UNIVERSE } = await import("@/lib/universe");
    const now = new Date("2026-10-11T12:00:00Z");
    const fresh = now.toISOString();
    const gone = UNIVERSE[0].ticker;
    const rows = UNIVERSE.slice(1).map((member) => ({ ticker: member.ticker, name: member.name, asOf: 0, values: {}, builtAt: fresh, shape: ROW_SHAPE }));
    const table = { builtAt: fresh, members: UNIVERSE.length, rows, unreadable: { [gone]: new Date("2026-10-11T08:00:00Z").toISOString() } };
    expect(isWhole(table, now)).toBe(true);
    expect(nextTechnicals(table, 5, now)).toEqual([]);
    expect(isWhole(table, new Date("2026-10-12T12:00:00Z"))).toBe(false);
  });
});

describe("a new snapshot shape", () => {
  it("reads rows of an older shape again before stale ones, and keeps the table open until they are", async () => {
    const { isWhole, nextTechnicals, ROW_SHAPE } = await import("@/lib/term/tech-universe");
    const { UNIVERSE } = await import("@/lib/universe");
    const now = new Date("2026-10-11T12:00:00Z");
    const rows = UNIVERSE.map((member, index) => ({
      ticker: member.ticker, name: member.name, asOf: 0, values: {},
      builtAt: index === 1 ? new Date("2026-10-10T01:00:00Z").toISOString() : now.toISOString(),
      shape: index === 0 ? undefined : ROW_SHAPE,
    }));
    const table = { builtAt: now.toISOString(), members: UNIVERSE.length, rows };
    expect(nextTechnicals(table, 2, now)).toEqual([UNIVERSE[0].ticker, UNIVERSE[1].ticker]);
    expect(isWhole(table, now)).toBe(false);
  });
});

describe("yearly returns", () => {
  it("measure the year to date from the last close of the year before", () => {
    const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
    const t = [day("2025-12-30"), day("2025-12-31"), day("2026-01-02"), day("2026-06-01")];
    const c = [90, 100, 102, 120];
    const series = computeSeries({ t, o: c, h: c, l: c, c, v: [1, 1, 1, 1] });
    expect(series.chgYtd[2]).toBeCloseTo(2);
    expect(series.chgYtd[3]).toBeCloseTo(20);
    expect(series.chgYtd[0]).toBeNull();
  });
});

describe("RS rating", () => {
  it("ranks the weighted three-, six- and twelve-month return across the index, 1 to 99", async () => {
    const { rsRatings } = await import("@/lib/term/rules");
    const row = (quarter: number, half: number, year: number) => ({ values: { chg60: [quarter, quarter] as [number, number], chg126: [half, half] as [number, number], chg252: [year, year] as [number, number] } });
    const ratings = rsRatings([row(-10, -10, -10), row(0, 0, 0), row(10, 10, 10), row(30, 30, 30), { values: {} }]);
    expect(ratings.map((pair) => pair[0])).toEqual([1, 25, 50, 75, null]);
  });
});
