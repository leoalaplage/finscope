import type { SeriesPoint } from "../portfolio";

export interface Bar { date: string; close: number; adjusted: number }
export interface Histories { holdings: Record<string, Bar[]>; index: Bar[]; totalIndex: Bar[] }

export const BENCHMARK = { symbol: "^GSPC", totalSymbol: "^SP500TR", label: "S&P 500" };

export interface PerfPoint { date: string; book: number; index: number; under: number }

/** Return view is rebased to 100; value view reads the actual marked book. */
export function performanceChartPoints(
  paired: Array<{ date: string; portfolio: number; benchmark: number }>,
  values: SeriesPoint[], water: Map<string, number>, total: boolean,
): PerfPoint[] {
  const byDate = new Map(values.map((point) => [point.date, point.value]));
  const opening = paired.length ? byDate.get(paired[0].date) : undefined;
  if (!total && opening == null) return [];
  return paired.flatMap((point) => {
    const value = byDate.get(point.date);
    if (!total && value == null) return [];
    return [{ date: point.date, book: total ? point.portfolio : value!,
      index: total ? point.benchmark : point.benchmark / 100 * opening!, under: water.get(point.date) ?? 0 }];
  });
}

/** A price index's adjusted close still excludes dividends; use the TR index. */
export function performanceHistories(source: Histories, total: boolean): { histories: Record<string, SeriesPoint[]>; index: SeriesPoint[] } {
  return {
    histories: Object.fromEntries(Object.entries(source.holdings).map(([ticker, bars]) => [ticker,
      bars.map((bar) => ({ date: bar.date, value: total ? bar.adjusted : bar.close })),
    ])),
    index: (total ? source.totalIndex : source.index).map((bar) => ({ date: bar.date, value: bar.close })),
  };
}
