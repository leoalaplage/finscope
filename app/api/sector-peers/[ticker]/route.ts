import { NextResponse } from "next/server";
import { scopedFeed } from "@/lib/screener-scope";
import { largest } from "@/lib/listed-universe";
import { cachedJson } from "@/lib/market-cache";
import { peerTable } from "@/lib/peers";
import { TICKER_PATTERN } from "@/lib/market-profile";

/**
 * A company's multiples against its sector's (lib/peers.ts), kept half an
 * hour: among the thousand largest US companies, or — for a company smaller
 * than those — among every listed one, beside the companies of its own size.
 */
export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const symbol = decodeURIComponent((await context.params).ticker).toUpperCase();
  if (!TICKER_PATTERN.test(symbol)) return NextResponse.json({ error: "That is not a ticker." }, { status: 400 });
  const { body } = await cachedJson(`sector-peers:v3:${symbol}`, 1800, async () => {
    // The all-US feed the screener already keeps: the thousand largest are its rows with the largest market values.
    const all = await scopedFeed("all");
    const top = largest(all.rows, (row) => (typeof row.values["Market Cap"] === "number" ? row.values["Market Cap"] : null));
    const largestRows = { name: "US 1000", rows: all.rows.filter((row) => top.has(row.ticker)) };
    return { table: peerTable(largestRows, symbol) ?? peerTable({ name: "All US", rows: all.rows }, symbol, "nearest") };
  });
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=900, s-maxage=1800" } });
}
