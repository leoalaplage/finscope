import { NextResponse } from "next/server";
import { fetchEarningsDates } from "@/lib/adapters/earnings";
import { cachedJson } from "@/lib/market-cache";

/**
 * Every earnings release a filer has filed in its recent SEC index (8-K, item
 * 2.02), newest first — the dates the company page reads its reactions from.
 * The same twelve-hour entry the earnings calendar keeps, so a company on both
 * costs one SEC request.
 */
const CIK = /^\d{1,10}$/;

export async function GET(request: Request) {
  const cik = new URL(request.url).searchParams.get("cik") ?? "";
  if (!CIK.test(cik)) return NextResponse.json({ error: "A valid SEC CIK is required." }, { status: 400 });
  const padded = cik.padStart(10, "0");
  try {
    const { body } = await cachedJson(`earnings-dates:v1:${padded}`, 12 * 3600, () => fetchEarningsDates(padded), (dates) => (dates.length ? "full" : "empty"));
    return new Response(JSON.stringify({ cik: padded, dates: JSON.parse(body) }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600, s-maxage=3600" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The SEC index is unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
