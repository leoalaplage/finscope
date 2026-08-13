import { NextResponse } from "next/server";
import { COMPANIES } from "@/lib/company-registry";
import { fetchYahooPrices } from "@/lib/adapters/yahoo";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const company = COMPANIES.find((item) => item.ticker === ticker.toUpperCase());
  if (!company) return NextResponse.json({ error: "Ticker not supported." }, { status: 404 });
  const dates = [...new Set((new URL(request.url).searchParams.get("dates") ?? "").split(",").filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].slice(0, 120);
  if (!dates.length) return NextResponse.json({ error: "At least one valid date is required." }, { status: 400 });
  const publicationSafe = new URL(request.url).searchParams.get("published") === "1";
  const points = await fetchYahooPrices(company, dates, publicationSafe ? 0 : 7, publicationSafe ? 7 : 2);
  return NextResponse.json({ ticker: company.ticker, points }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
}
