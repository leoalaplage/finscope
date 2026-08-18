import { describe, expect, it } from "vitest";
import {
  buildLots, firstTradeDate, flowsByDate, positionsFromTransactions, shareTimeline,
  sharesOn, sortTransactions, totalRealised, transactionsFromPositions, type Transaction,
} from "../lib/transactions";
import { holdingsSeries, sharesAsOf, timeWeightedSeries } from "../lib/portfolio";

const buy = (ticker: string, date: string, shares: number, price: number, fee?: number): Transaction =>
  ({ id: `${ticker}-b-${date}-${shares}`, ticker, date, kind: "buy", shares, price, ...(fee ? { fee } : {}) });
const sell = (ticker: string, date: string, shares: number, price: number, fee?: number): Transaction =>
  ({ id: `${ticker}-s-${date}-${shares}`, ticker, date, kind: "sell", shares, price, ...(fee ? { fee } : {}) });

describe("replaying a book", () => {
  it("averages the cost of what is still held", () => {
    const lots = buildLots([buy("AAPL", "2024-01-02", 10, 100), buy("AAPL", "2024-06-03", 10, 200)]);
    expect(lots.AAPL.shares).toBe(20);
    expect(lots.AAPL.averageCost).toBeCloseTo(150, 6);
    expect(lots.AAPL.costBasis).toBeCloseTo(3000, 6);
  });

  it("banks the profit on a sale and takes it out of the cost basis", () => {
    const lots = buildLots([buy("AAPL", "2024-01-02", 10, 100), sell("AAPL", "2024-09-02", 4, 180)]);
    expect(lots.AAPL.shares).toBe(6);
    // Sold at 180 what cost 100: 4 x 80 banked, and the six left still cost 100.
    expect(lots.AAPL.realised).toBeCloseTo(320, 6);
    expect(lots.AAPL.averageCost).toBeCloseTo(100, 6);
    expect(lots.AAPL.costBasis).toBeCloseTo(600, 6);
  });

  it("counts a fee as part of the cost and against the proceeds", () => {
    const bought = buildLots([buy("V", "2024-01-02", 10, 100, 20)]);
    expect(bought.V.costBasis).toBeCloseTo(1020, 6);
    const sold = buildLots([buy("V", "2024-01-02", 10, 100), sell("V", "2024-02-02", 10, 100, 15)]);
    expect(sold.V.realised).toBeCloseTo(-15, 6);
  });

  it("forgets the old cost when a position is closed and opened again", () => {
    // Remembering it would price the new position off a holding that is gone.
    const lots = buildLots([
      buy("MSFT", "2023-01-03", 5, 100), sell("MSFT", "2023-06-01", 5, 150),
      buy("MSFT", "2024-01-03", 5, 400),
    ]);
    expect(lots.MSFT.shares).toBe(5);
    expect(lots.MSFT.averageCost).toBeCloseTo(400, 6);
    expect(lots.MSFT.realised).toBeCloseTo(250, 6);
  });

  it("clamps a sale of more than is held instead of going short", () => {
    const lots = buildLots([buy("NVDA", "2024-01-02", 3, 100), sell("NVDA", "2024-03-02", 10, 120)]);
    expect(lots.NVDA.shares).toBe(0);
    expect(lots.NVDA.realised).toBeCloseTo(60, 6);
  });

  it("replays in date order however the rows were entered", () => {
    const out = sortTransactions([buy("A", "2024-05-01", 1, 10), buy("A", "2024-01-01", 1, 5)]);
    expect(out.map((entry) => entry.date)).toEqual(["2024-01-01", "2024-05-01"]);
  });

  it("ignores a malformed row rather than discarding the history around it", () => {
    const rows = [buy("AAPL", "2024-01-02", 10, 100), { id: "x", ticker: "AAPL", date: "nope", kind: "buy", shares: 5, price: 1 } as Transaction];
    expect(buildLots(rows).AAPL.shares).toBe(10);
  });

  it("offers only what is still held as a position", () => {
    const held = positionsFromTransactions([buy("AAPL", "2024-01-02", 10, 100), sell("AAPL", "2024-02-02", 10, 120), buy("V", "2024-03-02", 2, 250)]);
    expect(held.map((position) => position.ticker)).toEqual(["V"]);
  });

  it("totals what every sale banked", () => {
    expect(totalRealised([
      buy("AAPL", "2024-01-02", 10, 100), sell("AAPL", "2024-02-02", 10, 110),
      buy("V", "2024-01-02", 10, 100), sell("V", "2024-02-02", 10, 90),
    ])).toBeCloseTo(0, 6);
  });
});

describe("holdings through time", () => {
  const book = [buy("AAPL", "2024-01-02", 10, 100), buy("AAPL", "2024-03-01", 10, 150), sell("AAPL", "2024-06-03", 5, 200)];

  it("knows what was held on a date, not just today", () => {
    expect(sharesOn(book, "AAPL", "2023-12-31")).toBe(0);
    expect(sharesOn(book, "AAPL", "2024-01-02")).toBe(10);
    expect(sharesOn(book, "AAPL", "2024-04-01")).toBe(20);
    expect(sharesOn(book, "AAPL", "2024-12-31")).toBe(15);
  });

  it("collapses a day's trades to that day's closing position", () => {
    // A daily price series cannot speak to the order of trades within a day.
    const timeline = shareTimeline([buy("V", "2024-02-01", 5, 10), sell("V", "2024-02-01", 2, 12)]);
    expect(timeline.V).toEqual([{ date: "2024-02-01", shares: 3 }]);
  });

  it("reads a share count off the timeline the same way", () => {
    const timeline = shareTimeline(book);
    expect(sharesAsOf(timeline.AAPL, "2024-02-01")).toBe(10);
    expect(sharesAsOf(timeline.AAPL, "2024-07-01")).toBe(15);
    expect(sharesAsOf(timeline.AAPL, "2020-01-01")).toBe(0);
    expect(sharesAsOf(undefined, "2024-01-01")).toBe(0);
  });

  it("starts the book at its first trade", () => {
    expect(firstTradeDate(book)).toBe("2024-01-02");
    expect(firstTradeDate([])).toBeNull();
  });
});

describe("the value line", () => {
  it("values each date with the shares held on it, not with today's", () => {
    // The whole reason transactions carry a date: with a fixed share count this
    // book would be drawn as though the second purchase had always been there.
    const timeline = shareTimeline([buy("AAPL", "2024-01-02", 10, 100), buy("AAPL", "2024-01-04", 10, 100)]);
    const histories = { AAPL: [
      { date: "2024-01-02", value: 100 }, { date: "2024-01-03", value: 110 },
      { date: "2024-01-04", value: 120 }, { date: "2024-01-05", value: 130 },
    ] };
    expect(holdingsSeries(timeline, histories, "2024-01-02")).toEqual([
      { date: "2024-01-02", value: 1000 },
      { date: "2024-01-03", value: 1100 },
      { date: "2024-01-04", value: 2400 },
      { date: "2024-01-05", value: 2600 },
    ]);
  });

  it("skips a date a holding cannot be priced on rather than carrying yesterday", () => {
    const timeline = shareTimeline([buy("A", "2024-01-02", 1, 1), buy("B", "2024-01-02", 1, 1)]);
    const histories = {
      A: [{ date: "2024-01-02", value: 10 }, { date: "2024-01-03", value: 11 }],
      B: [{ date: "2024-01-02", value: 20 }],
    };
    expect(holdingsSeries(timeline, histories, "2024-01-02").map((point) => point.date)).toEqual(["2024-01-02"]);
  });

  it("begins nothing before the first trade", () => {
    const timeline = shareTimeline([buy("A", "2024-06-03", 1, 1)]);
    const histories = { A: [{ date: "2024-01-02", value: 10 }, { date: "2024-06-03", value: 12 }] };
    expect(holdingsSeries(timeline, histories, "2024-06-03").map((point) => point.date)).toEqual(["2024-06-03"]);
  });
});

describe("return against deposits", () => {
  it("does not call a deposit a gain", () => {
    // Ten thousand becomes twenty because nine thousand was paid in. The value
    // doubled; the book returned ten percent, and only the flows say so.
    const values = [{ date: "2024-01-02", value: 10_000 }, { date: "2024-01-03", value: 20_000 }];
    const flows = new Map([["2024-01-03", 9_000]]);
    const twr = timeWeightedSeries(values, flows);
    expect(twr.at(-1)!.value).toBeCloseTo(110, 6);
  });

  it("does not call a withdrawal a loss", () => {
    const values = [{ date: "2024-01-02", value: 10_000 }, { date: "2024-01-03", value: 5_000 }];
    const flows = new Map([["2024-01-03", -5_000]]);
    expect(timeWeightedSeries(values, flows).at(-1)!.value).toBeCloseTo(100, 6);
  });

  it("chains plain growth when nothing is paid in or out", () => {
    const values = [{ date: "d1", value: 100 }, { date: "d2", value: 110 }, { date: "d3", value: 121 }];
    expect(timeWeightedSeries(values, new Map()).at(-1)!.value).toBeCloseTo(121, 6);
  });

  it("counts a buy as money in and a sale as money out", () => {
    const flows = flowsByDate([buy("A", "2024-01-02", 10, 100, 5), sell("A", "2024-02-02", 4, 150, 3)]);
    expect(flows.get("2024-01-02")).toBeCloseTo(1005, 6);
    expect(flows.get("2024-02-02")).toBeCloseTo(-597, 6);
  });

  it("catches a flow that falls between two observations", () => {
    // Weekly bars land on week boundaries and trades land on weekdays. Matching
    // the flow date to the bar date exactly found nothing, so a purchase was
    // chained in as a gain: this is the regression that produced a 93% week.
    const values = [{ date: "2024-01-05", value: 10_000 }, { date: "2024-01-12", value: 20_000 }];
    const flows = new Map([["2024-01-08", 9_000]]);
    expect(timeWeightedSeries(values, flows).at(-1)!.value).toBeCloseTo(110, 6);
  });

  it("does not count a flow dated on or before the opening observation", () => {
    // The opening purchase is what creates the first value; subtracting it
    // again would report the book down by its own starting capital.
    const values = [{ date: "2024-01-05", value: 10_000 }, { date: "2024-01-12", value: 11_000 }];
    expect(timeWeightedSeries(values, new Map([["2024-01-05", 10_000]])).at(-1)!.value).toBeCloseTo(110, 6);
  });

  it("has nothing to say about a book of one day", () => {
    expect(timeWeightedSeries([{ date: "d1", value: 100 }], new Map())).toEqual([{ date: "d1", value: 100 }]);
    expect(timeWeightedSeries([], new Map())).toEqual([]);
  });
});

describe("migrating a dateless portfolio", () => {
  it("keeps the holdings and marks the date as invented", () => {
    const migrated = transactionsFromPositions([{ ticker: "aapl", shares: 10, cost: 150 }], "2026-08-18");
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({ ticker: "AAPL", shares: 10, price: 150, kind: "buy", date: "2026-08-18", migrated: true });
  });

  it("drops a holding with no shares in it", () => {
    expect(transactionsFromPositions([{ ticker: "A", shares: 0 }], "2026-08-18")).toEqual([]);
  });
});
