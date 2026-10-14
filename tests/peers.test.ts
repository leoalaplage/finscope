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

describe("a lender against its sector", () => {
  it("is read on earnings and book, with return on equity ranked higher-is-better", () => {
    const feed = { rows: [
      row("BAC", "Banking", { "Market Cap": 350, "P/E": 12, "P/B": 1.2, "P/TBV": 1.6, ROE: 10, "Dividend Yield": 2.5, forwardPe: 10.5 }),
      row("JPM", "Banking", { "Market Cap": 880, "P/E": 15, "P/B": 2.4, "P/TBV": 2.9, ROE: 17, "Dividend Yield": 2.0, forwardPe: 13.4 }),
      row("C", "Banking", { "Market Cap": 210, "P/E": 11, "P/B": 0.9, "P/TBV": 1.0, ROE: 7, "Dividend Yield": 3.0, forwardPe: 10.3 }),
    ] };
    const table = peerTable(feed, "BAC")!;
    expect(table.lender).toBe(true);
    expect(table.metrics.map((metric) => metric.key)).toEqual(["P/E", "forwardPe", "P/B", "P/TBV", "ROE", "Dividend Yield"]);
    // ROE 10% sits above Citigroup's 7%, below JPMorgan's 17%.
    expect(table.metrics.find((metric) => metric.key === "ROE")!.cheaperThan).toBe(0.5);
    expect(table.metrics.find((metric) => metric.key === "P/B")!).toMatchObject({ company: 1.2, median: 1.2, cheaperThan: 0.5 });
  });
});

describe("a small company against its sector", () => {
  it("is set beside the companies nearest its size, not the sector's largest", () => {
    const caps = [5000, 2000, 900, 40, 30, 25, 20, 15, 12, 10, 8, 6, 5, 4, 3];
    const feed = { name: "All US", rows: caps.map((cap, at) => row(`S${at}`, "Software", { "Market Cap": cap, "EV/EBIT": 10 + at, "FCF Yield": 3 })) };
    const table = peerTable(feed, "S9", "nearest")!;
    expect(table.universe).toBe("All US");
    expect(table.pick).toBe("nearest");
    expect(table.peers.map((peer) => peer.ticker)).not.toContain("S0");
    expect(table.peers.map((peer) => peer.ticker)).toContain("S9");
    expect(table.peers).toHaveLength(12);
    // Still ranked against the whole sector.
    expect(table.members).toBe(15);
  });
});
