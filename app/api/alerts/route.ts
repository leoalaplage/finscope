import { NextResponse } from "next/server";
import { alertsFor } from "@/lib/alerts-feed";
import { TICKER_PATTERN } from "@/lib/market-profile";

/** The alerts for the companies a reader follows, since a date (lib/alerts-feed.ts). Sixty companies at most. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tickers = [...new Set((params.get("tickers") ?? "").split(",").map((ticker) => ticker.trim().toUpperCase()).filter((ticker) => TICKER_PATTERN.test(ticker)))].slice(0, 60);
  const since = /^\d{4}-\d{2}-\d{2}$/.test(params.get("since") ?? "") ? params.get("since")! : new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  if (!tickers.length) return NextResponse.json({ since, alerts: [], failed: [] });
  const { alerts, failed } = await alertsFor(tickers, since);
  return NextResponse.json({ since, alerts, failed }, { headers: { "Cache-Control": "public, max-age=120, s-maxage=300" } });
}
