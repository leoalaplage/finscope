import { NextResponse } from "next/server";
import { signalsOf } from "@/lib/home-signals";
import { readTechTable } from "@/lib/term/tech-universe";
import { UNIVERSE } from "@/lib/universe";
import { readServedUniverse } from "@/lib/universe-build";

/**
 * New 52-week highs and lows and unusual volume, in the S&P 500 and in the
 * tickers asked for (lib/home-signals.ts). The snapshot and the prices are
 * both already kept; this only reads them.
 */
export async function GET(request: Request) {
  const asked = (new URL(request.url).searchParams.get("tickers") ?? "").toUpperCase().split(",").map((ticker) => ticker.trim()).filter((ticker) => /^[A-Z0-9.-]{1,10}$/.test(ticker)).slice(0, 100);
  const [table, universe] = await Promise.all([readTechTable(), readServedUniverse()]);
  if (!table) return NextResponse.json({ error: "The snapshot is being built." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const prices = Object.fromEntries(Object.entries(universe?.prices ?? {}).map(([ticker, quote]) => [ticker, { price: quote.price, changePercent: quote.changePercent }]));
  const answer = signalsOf({ rows: table.rows, prices, members: new Set(UNIVERSE.map((member) => member.ticker)), watched: new Set(asked) });
  return NextResponse.json({ ...answer, builtAt: table.builtAt }, { headers: { "Cache-Control": "public, max-age=120, s-maxage=300" } });
}
