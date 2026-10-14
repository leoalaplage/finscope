import { NextResponse } from "next/server";
import { rsRatings } from "@/lib/term/rules";
import { fillOnDemand, isWhole, readTechTable } from "@/lib/term/tech-universe";
import { UNIVERSE, UNIVERSE_AS_OF, UNIVERSE_NAME } from "@/lib/universe";

/**
 * The S&P 500's technical snapshot, for the terminal's scanner.
 *
 * Built by the scheduled run (lib/term/tech-universe.ts) and only read here;
 * the rule a reader writes is evaluated in their browser against it. Five
 * minutes at the edge once it is whole.
 *
 * While it is not whole — the first day, or after a version change — a
 * reader's visit also starts a slice in the background, one at a time under a
 * short lock, so the scanner fills in minutes rather than over an afternoon of
 * half-hourly runs. The answer then says it is building and is not cached, and
 * the page asks again.
 */

export async function GET() {
  const table = await readTechTable();
  // Each member's RS rating, ranked against the rest of the index in this answer.
  // The scanner is the index's: the snapshot also keeps the rest of the US 1000 for the screener.
  const index = new Set(UNIVERSE.map((member) => member.ticker));
  const read = (table?.rows ?? []).filter((row) => index.has(row.ticker));
  const ratings = rsRatings(read);
  const rows = read.map((row, index) => ({ ...row, values: { ...row.values, rsRating: ratings[index] } }));
  // Whole when the index is, whatever the rest of the US 1000 still waits for.
  const whole = isWhole(table ? { ...table, rows: read, members: UNIVERSE.length } : null);
  await fillOnDemand(table);
  return NextResponse.json(
    {
      name: UNIVERSE_NAME, asOf: UNIVERSE_AS_OF, members: UNIVERSE.length, builtAt: table?.builtAt ?? null, rows, building: !whole,
      unreadable: Object.keys(table?.unreadable ?? {}),
    },
    { headers: { "Cache-Control": whole ? "public, max-age=60, s-maxage=300, stale-while-revalidate=900" : "no-store" } },
  );
}
