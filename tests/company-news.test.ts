import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IR_FEEDS, irFeedFor } from "../lib/company-news";
import { DEFAULT_WATCHLIST } from "../lib/company-registry";

/**
 * A newsroom is known or it is not.
 *
 * The map is written by hand because no pattern derives a feed URL from a
 * ticker, and every rule here defends the same thing: a company's panel shows
 * that company's words, or it shows nothing.
 */
describe("a company's own newsroom", () => {
  it("answers for a ticker however it is written, and only for one it knows", () => {
    expect(irFeedFor("AAPL")).toBe("https://www.apple.com/newsroom/rss-feed.rss");
    expect(irFeedFor(" aapl ")).toBe("https://www.apple.com/newsroom/rss-feed.rss");
    // Not knowing is an answer: the page then shows no panel at all, rather
    // than a guessed URL that could put another company's words under this one.
    expect(irFeedFor("TSLA")).toBeNull();
    expect(irFeedFor("")).toBeNull();
    expect(irFeedFor(null)).toBeNull();
    expect(irFeedFor(undefined)).toBeNull();
  });

  it("keys every entry by the ticker the site itself uses", () => {
    const known = new Set(DEFAULT_WATCHLIST.map((company) => company.ticker));
    for (const ticker of Object.keys(IR_FEEDS)) {
      expect(ticker).toBe(ticker.toUpperCase());
      // A feed for a symbol this application never shows is a feed nobody can
      // reach, and a typo in a key would be exactly that.
      expect(known).toContain(ticker);
    }
  });

  it("reads every feed over https, and none of them from an aggregator", () => {
    for (const [ticker, url] of Object.entries(IR_FEEDS)) {
      expect(url.startsWith("https://"), `${ticker} is not https`).toBe(true);
      // The promise of this panel is that the company wrote the line. A feed
      // from a wire service or a portal would quietly break it.
      expect(url).not.toMatch(/yahoo|google\.com|bing|feedburner|reddit|twitter|x\.com/i);
    }
  });

  it("gives both listed classes of one company the same newsroom", () => {
    // GOOG and GOOGL are two securities and one company; two feeds would be a
    // way for the two pages to disagree about what Alphabet announced.
    expect(irFeedFor("GOOG")).toBe(irFeedFor("GOOGL"));
  });

  it("hands the page a headline and nothing that could be rendered as markup", () => {
    const route = readFileSync(new URL("../app/api/company/[ticker]/news/route.ts", import.meta.url), "utf8");
    // The summary is parsed and then dropped: what crosses is a title, a
    // section and an instant.
    expect(route).toContain('type Headline = Omit<NewsItem, "summary">');
    expect(route).toContain("parseNewsFeed");
    // A company with no verified feed is refused here rather than guessed at.
    expect(route).toContain("No investor-relations feed is known for");
    expect(route).toContain("status: 404");
    // A feed host that hangs must not hold a Worker invocation open.
    expect(route).toContain("AbortSignal.timeout(TIMEOUT_MS)");
    // An empty answer is never stored as if it were an answer.
    expect(route).toContain('answer.items.length ? "full" : "empty"');
  });

  it("draws no panel at all when there is nothing verified to read", () => {
    const panel = readFileSync(new URL("../components/io/CompanyNews.tsx", import.meta.url), "utf8");
    expect(panel).toContain('if (state.kind === "absent") return null;');
    expect(panel).toContain("}, [ticker]);");
    // No link out, on a page whose one door is the filing in the footer.
    expect(panel).not.toContain("<a ");
  });
});
