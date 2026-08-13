import { NextResponse } from "next/server";
import { searchSecCompanies } from "@/lib/adapters/sec";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 1) return NextResponse.json([]);
  try { return NextResponse.json(await searchSecCompanies(query), { headers: { "Cache-Control": "public, s-maxage=86400" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to resolve company." }, { status: 502 }); }
}
