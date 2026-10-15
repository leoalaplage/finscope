import { NextResponse } from "next/server";
import { blsSeries } from "@/lib/econ";

/** The official monthly series behind the headline figures, from the Bureau of Labor Statistics (lib/econ.ts). */
export async function GET() {
  try {
    const series = await blsSeries();
    return NextResponse.json({ series, source: "U.S. Bureau of Labor Statistics" }, { headers: { "Cache-Control": series.length ? "public, max-age=1800, s-maxage=3600" : "no-store" } });
  } catch (error) {
    return NextResponse.json({ series: [], error: error instanceof Error ? error.message : "The BLS did not answer." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
