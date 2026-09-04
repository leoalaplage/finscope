import { NextResponse } from "next/server";
import { searchSecCompanies } from "@/lib/adapters/sec";
import { cachedJson, SETTLED_SECONDS, type Completeness } from "@/lib/market-cache";

/**
 * What a few typed letters resolve to, remembered for a day.
 *
 * Every answer here costs a fetch of the SEC's registry document — about a
 * megabyte — and the search box asks again on each new prefix, so typing
 * "a p p l" is four of them. Measured cold at roughly three quarters of a
 * second, which is three quarters of a second of an empty menu under somebody's
 * cursor. The registry gains a company a day at most, so the answer to a prefix
 * is settled for a day the same way a past session's close is.
 *
 * The prefix is the key, which means the second reader to type "appl" pays
 * nothing at all, and the fifth letter of a word somebody has typed before is
 * already answered.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 1) return NextResponse.json([]);
  // The registry is matched case-insensitively, so two spellings of the same
  // prefix are one question and deserve one entry.
  const key = `resolve:${query.toUpperCase()}`;
  try {
    const { body, hit } = await cachedJson(
      key,
      SETTLED_SECONDS,
      () => searchSecCompanies(query),
      // An empty answer is a real answer — no filer matches "zzzz" — but it is
      // also what a refused upstream request looks like, so it is not kept.
      (answer): Completeness => (answer.length ? "full" : "empty"),
    );
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${SETTLED_SECONDS}, stale-while-revalidate=${SETTLED_SECONDS}`,
        "X-FinScope-Cache": hit ? "hit" : "miss",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to resolve company." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
