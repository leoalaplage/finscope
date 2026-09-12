import { NextResponse } from "next/server";
import { KEY_VERSION, SUMMARY_SHAPE } from "@/lib/data-version";
import { readUniverse } from "@/lib/universe-build";
import { UNIVERSE, UNIVERSE_AS_OF, UNIVERSE_NAME } from "@/lib/universe";

/**
 * The index, scored, in one answer.
 *
 * Nothing is built here. The table is written by the scheduled run — forty
 * companies at a time, because normalizing one costs a quarter of a second of
 * processor time and a scheduled invocation is allowed thirty — and this hands
 * back what is there. A reader who arrives before the first fill is told how
 * far along it is rather than shown a fraction of the index as though it were
 * all of it.
 *
 * Five minutes at the edge. The digests behind it change when a company files,
 * which the filing watcher acts on within half an hour; the prices beside them
 * are refreshed on the same half-hourly run. A shorter life would serve the
 * same bytes twice.
 */
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
};

export async function GET() {
  const table = await readUniverse();
  if (!table) {
    return NextResponse.json(
      {
        name: UNIVERSE_NAME, asOf: UNIVERSE_AS_OF, members: UNIVERSE.length,
        building: true, ready: 0,
        // The version travels in the answer as it does in every key here, so a
        // browser holding one shape cannot be handed another under it.
        version: `${KEY_VERSION}.${SUMMARY_SHAPE}`,
      },
      { status: 202, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
  return new Response(JSON.stringify({ ...table, version: `${KEY_VERSION}.${SUMMARY_SHAPE}` }), { headers });
}
