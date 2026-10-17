import { NextResponse } from "next/server";
import { fetchBacklog } from "@/lib/adapters/backlog";
import { cachedJson } from "@/lib/market-cache";

/**
 * A filer's backlog — remaining performance obligations — at every
 * balance-sheet date it states one (lib/adapters/backlog.ts). Kept for twelve
 * hours: it moves once a quarter, with a filing. A filer that states none is
 * kept for as long, since the SEC's 404 is an answer and failures throw.
 */
const CIK = /^\d{1,10}$/;

export async function GET(request: Request) {
  const cik = new URL(request.url).searchParams.get("cik") ?? "";
  if (!CIK.test(cik)) return NextResponse.json({ error: "A valid SEC CIK is required." }, { status: 400 });
  const padded = cik.padStart(10, "0");
  try {
    const { body } = await cachedJson(`backlog:v2:${padded}`, 12 * 3600, () => fetchBacklog(padded));
    return new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600, s-maxage=3600" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The SEC is unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
