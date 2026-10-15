import { NextResponse } from "next/server";
import { fedWatch } from "@/lib/fedwatch";

/** The odds of each coming FOMC decision, as fed funds futures price them (lib/fedwatch.ts). Fifteen minutes. */
export async function GET() {
  try {
    const answer = await fedWatch();
    if (!answer) return NextResponse.json({ error: "The futures or the New York Fed did not answer." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(answer, { headers: { "Cache-Control": "public, max-age=300, s-maxage=900" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
