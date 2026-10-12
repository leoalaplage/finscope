import { describe, expect, it } from "vitest";
import { CHART_RANGES, candlesInRange } from "@/lib/io/chart-ranges";

const at = (iso: string) => Date.parse(iso) / 1000;

describe("chart periods", () => {
  it("pick a candle size for each period", () => {
    expect(Object.fromEntries(CHART_RANGES.map((range) => [range.id, range.interval]))).toEqual({
      "1D": "5m", "1W": "15m", "1M": "1h", "1Q": "1d", YTD: "1d", "1Y": "1d", "5Y": "1wk",
    });
  });

  it("open one day on the latest New York session only", () => {
    // Yesterday's last candle at 15:55 New York, then today's from 09:30.
    const times = [at("2026-10-09T19:55:00Z"), at("2026-10-12T13:30:00Z"), at("2026-10-12T13:35:00Z"), at("2026-10-12T13:40:00Z")];
    expect(candlesInRange(times, "1D")).toBe(3);
  });

  it("count back from the last candle for the other periods", () => {
    const days = Array.from({ length: 800 }, (_, index) => at("2024-08-01T00:00:00Z") + index * 86_400);
    const last = days.at(-1)!;
    expect(candlesInRange(days, "1Q")).toBe(92);
    expect(candlesInRange(days, "1Y")).toBe(366);
    const january = Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000;
    expect(candlesInRange(days, "YTD")).toBe(days.filter((time) => time > january).length);
    expect(candlesInRange([], "1W")).toBe(0);
  });
});
