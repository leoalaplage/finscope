import { NextResponse } from "next/server";
import { datasetCache, keepAlive } from "@/lib/runtime-env";
import { buildTechnicalSlice, readTechTable } from "@/lib/term/tech-universe";
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

const LOCK = "technicals:filling";
const ON_DEMAND = 50;

async function startFill() {
  const cache = datasetCache();
  if (!cache) return;
  try {
    if (await cache.get(LOCK)) return;
    await cache.put(LOCK, "1", { expirationTtl: 90 });
  } catch {
    return;
  }
  keepAlive(buildTechnicalSlice(ON_DEMAND).finally(() => cache.delete(LOCK).catch(() => undefined)));
}

export async function GET() {
  const table = await readTechTable();
  const rows = table?.rows ?? [];
  const whole = rows.length >= UNIVERSE.length;
  if (!whole) await startFill();
  return NextResponse.json(
    { name: UNIVERSE_NAME, asOf: UNIVERSE_AS_OF, members: UNIVERSE.length, builtAt: table?.builtAt ?? null, rows, building: !whole },
    { headers: { "Cache-Control": whole ? "public, max-age=60, s-maxage=300, stale-while-revalidate=900" : "no-store" } },
  );
}
