import { NextResponse } from "next/server";
import { fetchCandles } from "@/lib/adapters/candles";
import { cachedJson, TODAY_SECONDS } from "@/lib/market-cache";
import { breadthOf, sectorRuns, unusualVolume, type ExtrasRow } from "@/lib/term/market-extras";
import { readTechTable } from "@/lib/term/tech-universe";
import { readServedUniverse } from "@/lib/universe-build";

/**
 * The terminal market screen's readings that the index level does not give:
 * breadth beneath it, sectors over a week, a month and a quarter, unusual
 * volume, and the VIX.
 *
 * Read from the scanner's snapshot of every S&P 500 member and the screener's
 * table (for each member's sector), and nothing else, so it costs two KV reads
 * and, once every five minutes, one VIX history from Yahoo.
 */

interface Vix { last: number | null; change: number | null; changePercent: number | null; spark: number[] }

async function vix(): Promise<Vix | null> {
  try {
    const { body } = await cachedJson("vix:v1", TODAY_SECONDS, async () => {
      const candles = await fetchCandles("^VIX", "1d");
      const closes = candles.c;
      const last = closes.at(-1) ?? null;
      const before = closes.at(-2) ?? null;
      return {
        last,
        change: last != null && before != null ? last - before : null,
        changePercent: last != null && before ? ((last / before) - 1) * 100 : null,
        spark: closes.slice(-30),
      } satisfies Vix;
    }, (answer) => (answer.last == null ? "empty" : "full"));
    return JSON.parse(body) as Vix;
  } catch {
    return null;
  }
}

export async function GET() {
  const [technicals, universe, volatility] = await Promise.all([readTechTable(), readServedUniverse(), vix()]);
  const sectors = new Map((universe?.rows ?? []).map((row) => [row.ticker, typeof row.qs?.["Sector"] === "string" ? row.qs["Sector"] as string : "Unclassified"]));
  const rows: ExtrasRow[] = (technicals?.rows ?? []).map((row) => ({ ticker: row.ticker, name: row.name, sector: sectors.get(row.ticker) ?? "Unclassified", values: row.values }));
  const asOf = (technicals?.rows ?? []).reduce((latest, row) => Math.max(latest, row.asOf), 0);
  return NextResponse.json({
    asOf: asOf ? new Date(asOf * 1000).toISOString().slice(0, 10) : null,
    builtAt: technicals?.builtAt ?? null,
    breadth: breadthOf(rows),
    sectors: sectorRuns(rows),
    volume: unusualVolume(rows),
    vix: volatility,
  }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900" } });
}
