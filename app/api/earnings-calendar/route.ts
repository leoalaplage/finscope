import { NextResponse } from "next/server";
import { expectedNextRelease, fetchEarningsDates } from "@/lib/adapters/earnings";
import { searchSecCompanies } from "@/lib/adapters/sec";
import { companyByTicker } from "@/lib/company-registry";
import { cachedJson, SETTLED_SECONDS } from "@/lib/market-cache";

/**
 * The reader's list, ordered by when each company should next report.
 *
 * Built from the SEC alone: each filer's earnings releases (8-K, item 2.02)
 * and the gap between them (lib/adapters/earnings.ts). A filer's dates change
 * once a quarter, so each is kept for twelve hours and the whole list costs one
 * SEC request per company per half-day at most — asked three at a time, well
 * inside the SEC's ten a second.
 */

const LIMIT = 40;
const DATES_SECONDS = 12 * 3600;
const AT_ONCE = 3;
const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

interface Row {
  ticker: string;
  name: string | null;
  last: string | null;
  expected: ReturnType<typeof expectedNextRelease>;
  error?: string;
}

async function cikOf(ticker: string): Promise<{ cik: string; name: string } | null> {
  const known = companyByTicker(ticker);
  if (known?.cik) return { cik: known.cik, name: known.name };
  // The same entry the search box keeps, so a ticker anyone has typed costs nothing here.
  const { body } = await cachedJson(`resolve:${ticker}`, SETTLED_SECONDS, () => searchSecCompanies(ticker));
  const found = (JSON.parse(body) as Array<{ ticker: string; cik: string; name: string }>).find((match) => match.ticker.toUpperCase() === ticker);
  return found ? { cik: found.cik, name: found.name } : null;
}

async function rowFor(ticker: string): Promise<Row> {
  try {
    const filer = await cikOf(ticker);
    if (!filer) return { ticker, name: null, last: null, expected: null, error: "Not an SEC filer." };
    const { body } = await cachedJson(
      `earnings-dates:v1:${filer.cik}`,
      DATES_SECONDS,
      () => fetchEarningsDates(filer.cik),
      (dates) => (dates.length ? "full" : "empty"),
    );
    const dates = JSON.parse(body) as string[];
    return { ticker, name: filer.name, last: dates[0] ?? null, expected: expectedNextRelease(dates) };
  } catch (error) {
    return { ticker, name: null, last: null, expected: null, error: error instanceof Error ? error.message : "Unavailable." };
  }
}

export async function GET(request: Request) {
  const asked = (new URL(request.url).searchParams.get("tickers") ?? "")
    .toUpperCase().split(",").map((ticker) => ticker.trim()).filter((ticker) => TICKER.test(ticker));
  const tickers = [...new Set(asked)].slice(0, LIMIT);
  if (!tickers.length) return NextResponse.json({ error: "Name at least one ticker." }, { status: 400 });

  const rows: Row[] = new Array(tickers.length);
  let next = 0;
  await Promise.all(Array.from({ length: AT_ONCE }, async () => {
    while (next < tickers.length) {
      const index = next++;
      rows[index] = await rowFor(tickers[index]);
    }
  }));

  // Soonest expected first; those without an expectation after them, most recent release first.
  rows.sort((a, b) => {
    if (a.expected && b.expected) return a.expected.date.localeCompare(b.expected.date);
    if (a.expected || b.expected) return a.expected ? -1 : 1;
    return (b.last ?? "").localeCompare(a.last ?? "");
  });
  const failed = rows.some((row) => row.error && row.error !== "Not an SEC filer.");
  return NextResponse.json({ rows }, {
    headers: { "Cache-Control": failed ? "no-store" : "public, s-maxage=3600, stale-while-revalidate=3600" },
  });
}
