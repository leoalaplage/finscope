import { NextResponse } from "next/server";
import { COMPANIES } from "@/lib/company-registry";
import { fetchYahooPrice } from "@/lib/adapters/yahoo";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await context.params;
    const company = COMPANIES.find((item) => item.ticker === ticker.toUpperCase());
    if (!company) return NextResponse.json({ error: "Ticker not supported." }, { status: 404 });
    const date = new URL(request.url).searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });
    const price = await fetchYahooPrice(company, date);
    return NextResponse.json(price, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Price unavailable." }, { status: 502 });
  }
}
