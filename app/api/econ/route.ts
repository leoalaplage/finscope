import { NextResponse } from "next/server";
import { econCalendar, reactions } from "@/lib/econ";

/** The US economic calendar, a week back and two ahead, with how markets took the week's main releases (lib/econ.ts). */
export async function GET() {
  try {
    const { today, events } = await econCalendar(7, 14);
    const moves = await reactions(events).catch(() => ({}));
    return NextResponse.json({ today, events, reactions: moves, source: "Nasdaq economic calendar; release times New York" }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The calendar could not be read." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
