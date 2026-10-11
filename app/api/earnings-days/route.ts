import { NextResponse } from "next/server";
import { EARNINGS_DAY_SHAPE, fetchEarningsDay, weekdaysFrom, type EarningsEvent } from "@/lib/adapters/nasdaq-earnings";
import { cachedJson } from "@/lib/market-cache";
import { UNIVERSE } from "@/lib/universe";

/**
 * Earnings announcements by day, for the terminal's calendar (ECAL) and the
 * launchpad's watchlist calendar.
 *
 * A day is asked of Nasdaq once and kept: six hours while it is ahead (a date
 * can still move), a week once it is past. Each row says whether the company
 * is in the S&P 500, so the calendar can open on the index and widen to every
 * US filer reporting.
 */

const MAX_DAYS = 15;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MEMBERS = new Set(UNIVERSE.map((member) => member.ticker));

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const start = DATE.test(params.get("from") ?? "") ? params.get("from")! : today;
  const count = Math.min(MAX_DAYS, Math.max(1, Number(params.get("days")) || 5));
  const days = weekdaysFrom(start, count);

  const answers = await Promise.all(days.map(async (date) => {
    try {
      const { body } = await cachedJson(
        // v2 carries the consensus, and after the day the reported figure and the surprise.
        `earnings-day:v${EARNINGS_DAY_SHAPE}:${date}`,
        date < today ? 7 * 86_400 : 6 * 3_600,
        () => fetchEarningsDay(date),
        // An empty day is a real answer on a holiday, but it is also what a
        // refused request looks like, so it is kept only briefly.
        (rows) => (rows.length ? "full" : "empty"),
      );
      const rows = (JSON.parse(body) as EarningsEvent[]).map((row) => ({ ...row, sp500: MEMBERS.has(row.ticker) }));
      return { date, rows };
    } catch (error) {
      return { date, rows: [], error: error instanceof Error ? error.message : "Unavailable." };
    }
  }));
  const failed = answers.every((day) => "error" in day);
  return NextResponse.json({ days: answers }, {
    status: failed ? 502 : 200,
    headers: { "Cache-Control": failed ? "no-store" : "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600" },
  });
}
