import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/market-cache";

/**
 * Futures and crypto for the tape and the market screen: the US index
 * futures, crude and gold, and the two largest coins.
 *
 * They trade when the cash market is shut — overnight, at weekends for the
 * coins — so they are what moves on the tape when nothing else does. One
 * request to Yahoo's spark endpoint for all seven, a month of daily closes
 * each, kept a minute.
 */

export const FUTURES = [
  { id: "ES=F", label: "S&P fut", group: "futures" },
  { id: "NQ=F", label: "Nasdaq fut", group: "futures" },
  { id: "YM=F", label: "Dow fut", group: "futures" },
  { id: "CL=F", label: "Crude fut", group: "futures" },
  { id: "GC=F", label: "Gold fut", group: "futures" },
  { id: "BTC-USD", label: "Bitcoin", group: "crypto" },
  { id: "ETH-USD", label: "Ether", group: "crypto" },
] as const;

export interface FutureRow { id: string; label: string; group: "futures" | "crypto"; last: number | null; changePercent: number | null; spark: number[] }

async function build(): Promise<FutureRow[]> {
  const symbols = FUTURES.map((item) => item.id).join(",");
  const response = await fetch(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols)}&range=1mo&interval=1d`, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 Tenqay/1.0" },
  });
  if (!response.ok) throw new Error(`Yahoo returned ${response.status}.`);
  const payload = await response.json() as {
    spark?: { result?: Array<{ symbol: string; response: Array<{ meta?: { regularMarketPrice?: number | null; regularMarketChangePercent?: number | null }; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> }> };
  };
  const bySymbol = new Map((payload.spark?.result ?? []).map((entry) => [entry.symbol, entry.response[0]]));
  return FUTURES.map((item) => {
    const entry = bySymbol.get(item.id);
    const closes = (entry?.indicators?.quote?.[0]?.close ?? []).filter((value): value is number => value != null);
    const last = entry?.meta?.regularMarketPrice ?? closes.at(-1) ?? null;
    // Yahoo's own day, which for a coin is the last twenty-four hours; else from the closes.
    const before = closes.length > 1 ? closes[closes.length - 2] : null;
    const changePercent = entry?.meta?.regularMarketChangePercent ?? (last != null && before ? (last / before - 1) * 100 : null);
    return { ...item, last, changePercent, spark: closes.slice(-22) };
  });
}

export async function GET() {
  try {
    const { body } = await cachedJson("futures:v1", 60, build, (rows) => (rows.some((row) => row.last != null) ? "full" : "empty"));
    return new Response(JSON.stringify({ rows: JSON.parse(body) }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    return NextResponse.json({ rows: [], error: error instanceof Error ? error.message : "Unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
