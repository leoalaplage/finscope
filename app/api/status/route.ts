import { NextResponse } from "next/server";
import { readAuditReport } from "@/lib/coverage-audit";

/**
 * The day's data audit, as it was last gathered.
 *
 * Nothing is computed here: the report is written by the half-hourly timer
 * once a day (see lib/coverage-audit.ts), and this hands back what is there.
 */
export async function GET() {
  const report = await readAuditReport();
  if (!report) {
    return NextResponse.json({ building: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(report, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } });
}
