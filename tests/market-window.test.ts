import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMarketWindow } from "../lib/adapters/intraday";

const timestamps = [
  Date.UTC(2026, 7, 31, 13, 30) / 1000,
  Date.UTC(2026, 8, 1, 13, 30) / 1000,
  Date.UTC(2026, 8, 2, 13, 30) / 1000,
  Date.UTC(2026, 8, 3, 13, 30) / 1000,
  Date.UTC(2026, 8, 4, 13, 30) / 1000,
];

function yahooResponse() {
  return {
    chart: {
      result: [{
        meta: {
          currency: "USD",
          symbol: "^GSPC",
          shortName: "S&P 500",
          exchangeTimezoneName: "America/New_York",
          gmtoffset: 0,
          regularMarketPrice: 106,
          chartPreviousClose: 98,
          previousClose: 104,
          regularMarketTime: timestamps.at(-1),
        },
        timestamp: timestamps,
        indicators: { quote: [{ close: [100, 101, 102, 104, 106] }] },
      }],
      error: null,
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("five-session market windows", () => {
  it("labels the 5D axis with dates and measures it from the preceding official close", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(yahooResponse()), { status: 200 })));
    const window = await fetchMarketWindow("^GSPC", "S&P 500", "5D");
    expect(window.points.map((point) => point.label)).toEqual([
      "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04",
    ]);
    expect(window.baseline).toBe(98);
    expect(window.change).toBe(8);
    expect(window.changePercent).toBeCloseTo(8 / 98);
  });

  it("keeps clock labels and the previous session close for 1D", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(yahooResponse()), { status: 200 })));
    const window = await fetchMarketWindow("^GSPC", "S&P 500", "1D");
    expect(window.points).toHaveLength(1);
    expect(window.points[0].label).toBe("13:30");
    expect(window.baseline).toBe(104);
  });
});
