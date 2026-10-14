import { describe, expect, it } from "vitest";
import { peerTable } from "../lib/peers";

const row = (ticker: string, sector: string, values: Record<string, number | null>) => ({ ticker, name: ticker, sector, values }) as never;

describe("a company against its sector", () => {
  const feed = { rows: [
    row("AAA", "Software", { "Market Cap": 300, "EV/EBIT": 20, "EV/FCF": 25, "FCF Yield": 4, forwardPe: 22, peg: 2 }),
    row("BBB", "Software", { "Market Cap": 200, "EV/EBIT": 30, "EV/FCF": 35, "FCF Yield": 3, forwardPe: 30, peg: 3 }),
    row("CCC", "Software", { "Market Cap": 100, "EV/EBIT": 40, "EV/FCF": -10, "FCF Yield": 2, forwardPe: 40, peg: null }),
    row("DDD", "Banking", { "Market Cap": 500, "EV/EBIT": 5 }),
  ] };

  it("ranks each measure among the sector, cheapest first, and leaves a loss out", () => {
    const table = peerTable(feed, "AAA")!;
    expect(table.sector).toBe("Software");
    expect(table.members).toBe(3);
    const ebit = table.metrics.find((metric) => metric.key === "EV/EBIT")!;
    expect(ebit).toMatchObject({ company: 20, median: 30, cheaperThan: 1, count: 3 });
    // A higher yield is the cheaper one.
    expect(table.metrics.find((metric) => metric.key === "FCF Yield")!.cheaperThan).toBe(1);
    // CCC's negative EV/FCF is a loss, not a cheap price.
    expect(table.metrics.find((metric) => metric.key === "EV/FCF")!.count).toBe(2);
    expect(table.peers.map((peer) => peer.ticker)).toEqual(["AAA", "BBB", "CCC"]);
  });
});
