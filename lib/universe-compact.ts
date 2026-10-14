import type { UniverseRow, UniverseTable } from "./universe-build";

/**
 * A screening table in columns rather than objects: each digest's sixty-odd
 * column titles ("Shares Outstanding 5Y CAGR") written once instead of once
 * a company. Five thousand companies go from fourteen megabytes to under
 * three; the browser decodes it back to the same table.
 */
export interface CompactTable {
  name: string; asOf: string; members: number; builtAt: string;
  columns: string[];
  /** ticker, name, retrievedAt, periodLabel, periodEnd, qsPrice, the column values, then price, currency, price date, change. */
  rows: Array<[string, string, string, string | null, string | null, UniverseRow["qsPrice"], Array<number | string | null>, number | null, string | null, string | null, number | null]>;
  pending: number;
}

const round = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Number(value.toPrecision(6)) : value ?? null);

export function compactTable(table: UniverseTable): CompactTable {
  const columns = [...new Set(table.rows.flatMap((row) => Object.keys(row.qs)))];
  return {
    name: table.name, asOf: table.asOf, members: table.members, builtAt: table.builtAt, columns, pending: table.pending.length,
    rows: table.rows.map((row) => {
      const quote = table.prices[row.ticker];
      return [row.ticker, row.name, row.retrievedAt, row.periodLabel ?? null, row.periodEnd ?? null, row.qsPrice,
        columns.map((column) => round(row.qs[column]) as number | string | null),
        quote?.price ?? null, quote?.currency ?? null, quote?.asOf ?? null, quote?.changePercent ?? null];
    }),
  };
}

export function expandTable(compact: CompactTable): UniverseTable {
  const prices: UniverseTable["prices"] = {};
  const rows: UniverseRow[] = compact.rows.map(([ticker, name, retrievedAt, periodLabel, periodEnd, qsPrice, values, price, currency, asOf, changePercent]) => {
    if (price != null) prices[ticker] = { price, currency, asOf, changePercent };
    return {
      ticker, name, retrievedAt, qsPrice,
      ...(periodLabel ? { periodLabel } : {}), ...(periodEnd ? { periodEnd } : {}), read: "",
      qs: Object.fromEntries(compact.columns.map((column, index) => [column, values[index] ?? null])),
    } as UniverseRow;
  });
  return { name: compact.name, asOf: compact.asOf, builtAt: compact.builtAt, members: compact.members, rows, prices, pending: [] };
}
