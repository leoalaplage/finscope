import { NextResponse } from "next/server";
import { classify } from "@/lib/term/sectors";
import { fillOnDemand, readTechTable } from "@/lib/term/tech-universe";
import { readServedUniverse } from "@/lib/universe-build";

/**
 * The S&P 500 as a market map reads it: each member's sector and industry,
 * market value, price and its move over a day, a week, a month, a quarter, a
 * year and the year to date.
 *
 * The day's move and the price come from the screener's table, refreshed by
 * the half-hourly run; the longer moves from the scanner's snapshot of daily
 * closes; the market value is the price times the shares the filings report.
 * Rows as arrays, in the order `columns` names, because five hundred of them
 * written as objects is mostly field names.
 */

const COLUMNS = ["ticker", "name", "sector", "industry", "cap", "price", "d1", "w1", "m1", "m3", "y1", "ytd"] as const;

export async function GET() {
  const [universe, technicals] = await Promise.all([readServedUniverse(), readTechTable()]);
  await fillOnDemand(technicals);
  if (!universe) return NextResponse.json({ building: true, columns: COLUMNS, rows: [] }, { status: 202, headers: { "Cache-Control": "no-store" } });
  const moves = new Map((technicals?.rows ?? []).map((row) => [row.ticker, row.values]));
  const at = (ticker: string, field: "chg5" | "chg20" | "chg60" | "chg252" | "chgYtd") => {
    const value = moves.get(ticker)?.[field]?.[0];
    return value == null ? null : Math.round(value * 100) / 100;
  };
  const rows = universe.rows.flatMap((row) => {
    const quote = universe.prices[row.ticker];
    const price = quote?.price ?? null;
    const shares = row.qsPrice?.shares ?? null;
    if (price == null || !shares) return [];
    const { sector, industry } = classify(row.ticker, typeof row.qs?.["Sector"] === "string" ? row.qs["Sector"] as string : null);
    return [[
      row.ticker, row.name, sector, industry, Math.round(price * shares), price,
      quote?.changePercent ?? null, at(row.ticker, "chg5"), at(row.ticker, "chg20"), at(row.ticker, "chg60"), at(row.ticker, "chg252"), at(row.ticker, "chgYtd"),
    ]];
  });
  return NextResponse.json(
    { columns: COLUMNS, rows, asOf: universe.builtAt, members: universe.members },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=600" } },
  );
}
