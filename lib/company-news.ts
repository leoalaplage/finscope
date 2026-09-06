/**
 * Where a company's own newsroom publishes, when it publishes a feed at all.
 *
 * This is a hand-verified map and not a pattern, because there is no pattern.
 * A ticker does not imply a feed URL: the platforms differ (Q4's
 * `/rss/news-releases.xml`, a corporate newsroom on WordPress, a company's own
 * `releases.xml`), the hosts differ, and a meaningful share of investor
 * relations sites refuse anything that is not a browser outright — Amazon's,
 * Meta's, Visa's, Micron's, Oracle's, Cisco's and Johnson & Johnson's IR hosts
 * all answer 403 to a plain request, whatever user agent it carries. Guessing
 * a URL from a ticker produces a 404 far more often than a feed, and a guess
 * that lands on the wrong document would put somebody else's words under this
 * company's name, which is the one thing this panel must never do.
 *
 * So every entry here was requested and read before it was written down, and a
 * company with no entry has no panel. That is the fail-closed rule this
 * application is built on, applied to a feed: an absent newsroom is absent,
 * never approximated by a neighbour's.
 *
 * Where a company's investor relations host is unreachable but its own
 * newsroom publishes the same releases — Apple, Alphabet, Meta, Amazon,
 * Microsoft, NVIDIA — the newsroom is the entry. It is still the company
 * speaking, which is the whole of what this panel promises.
 */

/** Feeds read and confirmed to answer, keyed by the ticker the site uses. */
export const IR_FEEDS: Readonly<Record<string, string>> = {
  AAPL: "https://www.apple.com/newsroom/rss-feed.rss",
  AMD: "https://ir.amd.com/rss/news-releases.xml",
  AMZN: "https://www.aboutamazon.com/news/rss",
  AVGO: "https://investors.broadcom.com/rss/news-releases.xml",
  // Both listed classes are the same company and the same newsroom.
  GOOG: "https://blog.google/rss/",
  GOOGL: "https://blog.google/rss/",
  JPM: "https://jpmorganchaseco.gcs-web.com/rss/news-releases.xml",
  LLY: "https://investor.lilly.com/rss/news-releases.xml",
  META: "https://about.fb.com/news/feed/",
  MSFT: "https://news.microsoft.com/feed/",
  NVDA: "https://nvidianews.nvidia.com/releases.xml",
  XOM: "https://ir.exxonmobil.com/rss/news-releases.xml",
};

/**
 * The feed for a ticker, or null where this application does not know one.
 *
 * Null is an answer, not a failure: it says that nobody has verified a feed
 * for this company, which is exactly what the page then shows — nothing.
 */
export function irFeedFor(ticker: string | null | undefined): string | null {
  if (!ticker) return null;
  return IR_FEEDS[ticker.trim().toUpperCase()] ?? null;
}
