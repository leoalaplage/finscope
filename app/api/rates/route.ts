import { NextResponse } from "next/server";
import { usRates } from "@/lib/rates";

/** Treasury yields, the 2s10s and 3m10y spreads and the dollar index, against yesterday's close (lib/rates.ts). */
export async function GET() {
  try {
    const answer = await usRates();
    if (!answer) return NextResponse.json({ error: "No source answered." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(answer, { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
