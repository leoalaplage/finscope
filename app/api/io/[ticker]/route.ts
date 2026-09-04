import { NextResponse } from "next/server";
import { searchSecCompanies } from "@/lib/adapters/sec";
import { companyByTicker } from "@/lib/company-registry";
import { companyView } from "@/lib/io/view";
import { CACHE_SECONDS, KEY_VERSION, claimKey, datasetKey, fallbackDatasetKeys, requestCompany } from "@/lib/dataset-cache";
import { TICKER_PATTERN } from "@/lib/market-profile";
import { datasetCache, keepAlive } from "@/lib/runtime-env";
import type { CompanyDataset } from "@/lib/types";

/**
 * The page-sized view of a company, cached as its own object.
 *
 * Deriving it means parsing the four-megabyte normalized dataset and running
 * every metric through the validation gate — cheap next to normalizing raw
 * XBRL, but far too expensive to repeat for every reader. So the result is
 * stored under its own key and a warm request never parses anything: KV hands
 * back a byte stream and it goes straight out as the response body.
 *
 * The key carries the dataset version, so a bump to the semantics underneath
 * can never be read back under the wrong ones. A day of lifetime against a
 * dataset good for a week means the view re-derives itself the morning after
 * the filings are refreshed, without anyone having to remember to evict it.
 */
// iov2 adds the historical TTM series and stable metric colours used by the
// interactive company page. Never serve an iov1 shape to that client.
const VIEW_VERSION = "iov2";
const VIEW_SECONDS = 86_400;

const viewKey = (ticker: string) => `view:${VIEW_VERSION}.${KEY_VERSION}:${ticker.toUpperCase()}`;

/**
 * A symbol the SEC registry does not list, remembered so it is looked up once.
 *
 * Without this the page polls a build that can never land: nothing resolves,
 * nothing is ever written, and the reader watches "Reading the filings" for a
 * minute before being told to try again. The registry document is about a
 * megabyte, so the answer is kept for a day rather than fetched on every poll
 * two seconds apart.
 *
 * Versioned, because a refusal is a conclusion and not a fact. Berkshire's
 * class B was refused while the guard still compared `BRK.B` to the SEC's
 * `BRK-B` as strings; the guard was fixed the same hour, and the company went
 * on 404-ing anyway because the wrong answer had been written down for a day.
 * Bumping this drops every memo written under reasoning that has since changed.
 *
 * l2: a company carrying a CIK in this application's own registry is never
 *     refused, and never consults the memo at all.
 */
const LISTING_VERSION = "l2";
const unknownKey = (ticker: string) => `unlisted:${LISTING_VERSION}:${ticker.toUpperCase()}`;
const UNKNOWN_SECONDS = 86_400;

async function listedWithSec(symbol: string): Promise<boolean> {
  // A registry entry earns this shortcut by carrying a CIK, not by existing.
  // One that names an instrument we hold no filing feed for cannot be built at
  // all, and calling it listed would trade a one-second refusal for a minute of
  // polling a build that never lands.
  if (companyByTicker(symbol)?.cik) return true;
  try {
    const matches = await searchSecCompanies(symbol);
    return matches.some((match) => match.ticker.toUpperCase() === symbol);
  } catch {
    // A registry we could not read is not evidence that the company is absent.
    return true;
  }
}

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const symbol = ticker.toUpperCase();
  if (!TICKER_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "That is not a usable exchange symbol." }, { status: 400 });
  }
  const cache = datasetCache();

  if (cache) {
    try {
      const warm = await cache.get(viewKey(symbol), "stream");
      if (warm) return new Response(warm, { headers: { ...headers, "X-FinScope-Cache": "hit" } });
    } catch {
      // A cache that misbehaves must never take the endpoint down with it.
    }
  }

  /*
   * The normalized company, if some earlier request has already built one.
   *
   * This is the one place a reader pays for anything: a JSON parse and one pass
   * of the metric engine, once per company per day. It is deliberately not the
   * XBRL normalization next door — that costs hundreds of milliseconds against
   * a shared 128MB isolate and is what made the Worker refuse whole minutes of
   * traffic — so a company nobody has built yet is handed off rather than built
   * here, and the reader is told it is being prepared.
   */
  let stored: string | null = null;
  if (cache) {
    try {
      stored = await cache.get(datasetKey(symbol), "text");
      if (!stored) {
        for (const previous of fallbackDatasetKeys(symbol)) {
          stored = await cache.get(previous, "text");
          if (stored) break;
        }
      }
    } catch {
      stored = null;
    }
  }

  if (!stored) {
    // A company this application vouches for skips the memo entirely rather
    // than being cleared by it. A refusal is only ever about a symbol we could
    // not resolve, so one that predates the registry knowing the symbol must
    // not be allowed to answer for it.
    const vouched = companyByTicker(symbol)?.cik != null;
    const unlisted = vouched || !cache ? null : await cache.get(unknownKey(symbol), "text").catch(() => null);
    if (unlisted) {
      return NextResponse.json({ error: `No SEC filer trades under ${symbol}.` }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    const claim = cache ? await cache.get(claimKey(symbol), "text").catch(() => null) : null;
    if (!claim) {
      if (!await listedWithSec(symbol)) {
        await cache?.put(unknownKey(symbol), "1", { expirationTtl: UNKNOWN_SECONDS }).catch(() => undefined);
        return NextResponse.json({ error: `No SEC filer trades under ${symbol}.` }, { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      // Marked before the handoff so two readers arriving together produce one
      // build; the claim expires on its own if that build never lands.
      await cache?.put(claimKey(symbol), "1", { expirationTtl: 60 }).catch(() => undefined);
      keepAlive(requestCompany(new URL(request.url).origin, symbol));
    }
    return NextResponse.json({ building: true, ticker: symbol }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const view = companyView(JSON.parse(stored) as CompanyDataset);
    if (!view.annual.length && !view.quarterly.length) {
      return NextResponse.json(
        { error: `${symbol} files with the SEC but publishes no XBRL statements this adapter can read.` },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    const body = JSON.stringify(view);
    try {
      await cache?.put(viewKey(symbol), body, { expirationTtl: Math.min(VIEW_SECONDS, CACHE_SECONDS) });
    } catch {
      // Storing is best-effort; the reader still gets their answer.
    }
    return new Response(body, { headers: { ...headers, "X-FinScope-Cache": "miss" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read this company." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
