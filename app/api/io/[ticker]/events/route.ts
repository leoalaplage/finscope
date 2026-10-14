import { NextResponse } from "next/server";
import { filingEvents, type SubmissionsRecent } from "@/lib/adapters/filing-events";
import { secFetch } from "@/lib/adapters/sec-fetch";
import { cachedJson } from "@/lib/market-cache";
import { TICKER_PATTERN } from "@/lib/market-profile";

/**
 * A company's events: its 8-Ks by item, and the reports, proxies,
 * registrations and activist stakes around them (lib/adapters/filing-events.ts),
 * two years of them, from one read of its SEC index kept a quarter of an hour.
 */
const SEC_AGENT = () => process.env.SEC_USER_AGENT || "FinScope research application contact@example.com";
const CIK_PATTERN = /^\d{1,10}$/;

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const symbol = (await context.params).ticker.toUpperCase();
  const cik = new URL(request.url).searchParams.get("cik") ?? "";
  if (!TICKER_PATTERN.test(symbol) || !CIK_PATTERN.test(cik)) return NextResponse.json({ error: "A valid exchange symbol and SEC CIK are required." }, { status: 400 });
  const padded = cik.padStart(10, "0");
  try {
    const { body } = await cachedJson(`events:v1:${padded}`, 900, async () => {
      const response = await secFetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" } });
      if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
      const recent = (await response.json() as { filings: { recent: SubmissionsRecent } }).filings.recent;
      const since = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
      return { cik: padded, events: filingEvents(recent, padded, since) };
    });
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300, s-maxage=600" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The SEC index is unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
