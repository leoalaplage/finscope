import { NextResponse } from "next/server";
import { irFeedFor } from "@/lib/company-news";
import { cachedJson, type Completeness } from "@/lib/market-cache";
import { parseNewsFeed, type NewsItem } from "@/lib/news";

/**
 * One company's own newsroom, read in the Worker because a browser cannot.
 *
 * The feed lives on somebody else's origin, so the browser is refused before
 * the request is sent: reading it here is not an optimisation, it is the only
 * way. It is also where the document stops being a document — `parseNewsFeed`
 * strips every tag and resolves every entity, so what crosses to the page is a
 * list of strings that React escapes like any other text. Nothing arrives as
 * markup and nothing is ever run.
 *
 * A company this application has no verified feed for gets 404 and no panel,
 * rather than a guessed URL that would eventually put another company's words
 * under this one's name.
 */
type Headline = Omit<NewsItem, "summary">;

const headline = ({ title, category, publishedAt }: NewsItem): Headline => ({ title, category, publishedAt });

/**
 * Fifteen minutes, and twelve items.
 *
 * A company press release is not a wire: the interesting ones arrive a handful
 * of times a quarter, and asking an investor relations host for the same
 * document on every reader's first paint would be rude to it and slow for
 * them. Twelve items is roughly a year of releases for a company that files
 * quarterly and a month for one that talks every week.
 */
const NEWS_SECONDS = 900;
const ITEMS = 12;

/** A feed host that is slow is a feed host that is not answering. */
const TIMEOUT_MS = 8_000;

export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const symbol = ticker.trim().toUpperCase();
  const feed = irFeedFor(symbol);
  if (!feed) {
    return NextResponse.json(
      { error: `No investor-relations feed is known for ${symbol}.` },
      // Stated for an hour: the answer changes when this application learns a
      // feed, which is a deploy, not an event on somebody else's server.
      { status: 404, headers: { "Cache-Control": "public, s-maxage=3600" } },
    );
  }
  try {
    const { body, hit } = await cachedJson<{ items: Headline[] }>(
      `company-news:${symbol}:v1`,
      NEWS_SECONDS,
      async () => {
        const response = await fetch(feed, {
          headers: {
            Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
            "User-Agent": "Mozilla/5.0 FinScope/1.0",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`${symbol}'s newsroom returned ${response.status}.`);
        return { items: parseNewsFeed(await response.text(), ITEMS).map(headline) };
      },
      // A feed that answers with no items is a feed that failed politely, and
      // storing that for fifteen minutes would empty the panel for fifteen.
      (answer): Completeness => (answer.items.length ? "full" : "empty"),
    );
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${NEWS_SECONDS}, stale-while-revalidate=3600`,
        "X-FinScope-Cache": hit ? "hit" : "miss",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : `${symbol}'s newsroom is unavailable.` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
