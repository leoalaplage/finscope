import { NextResponse } from "next/server";
import { ISIN, resolveIsins } from "@/lib/adapters/isin";

/**
 * ISINs to the US tickers they trade under (lib/adapters/isin.ts), for the
 * portfolio import: Degiro and Trade Republic name securities by ISIN only.
 * Forty at most a request; each answer is kept a month.
 */
export async function GET(request: Request) {
  const asked = (new URL(request.url).searchParams.get("isins") ?? "").split(",").map((isin) => isin.trim().toUpperCase()).filter((isin) => ISIN.test(isin));
  if (!asked.length) return NextResponse.json({ error: "Name one ISIN or more, comma-separated." }, { status: 400 });
  if (asked.length > 40) return NextResponse.json({ error: "Forty ISINs at most a request." }, { status: 400 });
  const listings = await resolveIsins(asked);
  return NextResponse.json({ listings }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
