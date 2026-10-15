import { NextResponse } from "next/server";
import { blsSeries, otherSeries } from "@/lib/econ";

/** The official monthly series behind the headline figures, from the Bureau of Labor Statistics (lib/econ.ts). */
export async function GET() {
  try {
    // The BLS's and the others', each read on its own: one publisher down leaves the rest.
    const [bls, other] = await Promise.all([blsSeries().catch(() => []), otherSeries().catch(() => [])]);
    const series = [...bls, ...other];
    if (!series.length) throw new Error("Neither the BLS nor the BEA answered just now.");
    return NextResponse.json({ series, source: "U.S. Bureau of Labor Statistics" }, { headers: { "Cache-Control": series.length ? "public, max-age=1800, s-maxage=3600" : "no-store" } });
  } catch (error) {
    return NextResponse.json({ series: [], error: error instanceof Error ? error.message : "The BLS did not answer." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
