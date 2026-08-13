import { NextResponse } from "next/server";
import { fetchSecCompany } from "@/lib/adapters/sec";

export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await context.params;
    const dataset = await fetchSecCompany(ticker);
    return NextResponse.json(dataset, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
  } catch (error) {
    const message = error instanceof Error && error.name === "ZodError"
      ? "The SEC response did not match the expected schema."
      : error instanceof Error ? error.message : "Unable to load company.";
    return NextResponse.json(
      { error: message },
      { status: 502 },
    );
  }
}
