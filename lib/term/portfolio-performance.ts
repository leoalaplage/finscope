import type { SeriesPoint } from "../portfolio";

export interface Bar { date: string; close: number; adjusted: number }
export interface Histories { holdings: Record<string, Bar[]>; index: Bar[]; totalIndex: Bar[] }

export const BENCHMARK = { symbol: "^GSPC", totalSymbol: "^SP500TR", label: "S&P 500" };

/** A price index's adjusted close still excludes dividends; use the TR index. */
export function performanceHistories(source: Histories, total: boolean): { histories: Record<string, SeriesPoint[]>; index: SeriesPoint[] } {
  return {
    histories: Object.fromEntries(Object.entries(source.holdings).map(([ticker, bars]) => [ticker,
      bars.map((bar) => ({ date: bar.date, value: total ? bar.adjusted : bar.close })),
    ])),
    index: (total ? source.totalIndex : source.index).map((bar) => ({ date: bar.date, value: bar.close })),
  };
}
