import { NextResponse } from "next/server";
import { cachedJson, type Completeness } from "@/lib/market-cache";
import { parseNewsFeed, type NewsItem } from "@/lib/news";

/**
 * The wire, fetched here because a browser cannot fetch it at all.
 *
 * A feed on somebody else's origin is refused by the browser before it is sent;
 * reading it in the Worker is not an optimisation, it is the only way. The
 * answer is parsed into plain text on this side too, so what crosses to the
 * page is a list of strings rather than a document — nothing arrives as markup
 * and nothing is ever run.
 *
 * Ten minutes, against a feed that declares a twenty-minute time to live. It is
 * the interval that keeps a headline recent without asking somebody else's
 * server for the same document on every reader's first paint.
 */
const FEED = "https://breakingthenews.net/news-feed.xml";
const NEWS_SECONDS = 600;
const ITEMS = 18;

export async function GET() {
  try {
    const { body, hit } = await cachedJson<{ items: NewsItem[]; source: string }>(
      "news:breakingthenews",
      NEWS_SECONDS,
      async () => {
        const response = await fetch(FEED, {
          headers: { Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" },
        });
        if (!response.ok) throw new Error(`The news feed returned ${response.status}.`);
        return { items: parseNewsFeed(await response.text(), ITEMS), source: "Breaking The News" };
      },
      // A feed that answers with no items is a feed that failed politely, and
      // storing that for ten minutes would empty the panel for ten minutes.
      (answer): Completeness => (answer.items.length ? "full" : "empty"),
    );
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${NEWS_SECONDS}, stale-while-revalidate=1800`,
        "X-FinScope-Cache": hit ? "hit" : "miss",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The news feed is unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
