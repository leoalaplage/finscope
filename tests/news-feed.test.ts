import { describe, expect, it } from "vitest";
import { parseNewsFeed } from "../lib/news";

/**
 * A feed somebody else writes, read as text and nothing else.
 *
 * Every rule here is the same rule: the document is data. No fragment of it
 * reaches the page as markup, no link out of it is offered, and anything the
 * feed leaves out is left out rather than guessed at.
 */
const feed = (items: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Wire</title>${items}</channel></rss>`;

describe("reading a news feed", () => {
  it("takes the headline, the sentence under it, the section and the hour", () => {
    const items = parseNewsFeed(feed(`<item>
      <title>Canada concerned over Russia's strike in central Kyiv</title>
      <description><![CDATA[<div style="display:grid"><a href="https://example.test/a"><img src="https://example.test/i.jpg" alt="image"/></a><span>The Canadian government on Saturday expressed deep concern.</span></div>]]></description>
      <category>Politics</category>
      <link>https://example.test/a</link>
      <pubDate>Sat, 05 Sep 2026 19:19:00 GMT</pubDate>
    </item>`));
    expect(items).toEqual([{
      title: "Canada concerned over Russia's strike in central Kyiv",
      summary: "The Canadian government on Saturday expressed deep concern.",
      category: "Politics",
      publishedAt: "2026-09-05T19:19:00.000Z",
    }]);
  });

  it("keeps no markup at all, whatever the feed wraps its summary in", () => {
    // The whole safety of this rests on one thing: what leaves here is a
    // string. A feed that carries a script tag carries a sentence about a
    // script tag once it has been through this.
    const items = parseNewsFeed(feed(`<item>
      <title>A headline</title>
      <description><![CDATA[<p onclick="steal()">Text<script>alert(1)</script></p>]]></description>
    </item>`));
    expect(items[0].summary).toBe("Text alert(1)");
    expect(items[0].summary).not.toContain("<");
    expect(JSON.stringify(items)).not.toContain("onclick");
  });

  it("resolves the four ways a feed spells an apostrophe", () => {
    const items = parseNewsFeed(feed(`
      <item><title>Russia&apos;s move</title></item>
      <item><title>Russia&#39;s move</title></item>
      <item><title>Russia&#x27;s move</title></item>
      <item><title>Tables &amp; chairs, 5 &lt; 6</title></item>`));
    expect(items.map((item) => item.title)).toEqual([
      "Russia's move", "Russia's move", "Russia's move", "Tables & chairs, 5 < 6",
    ]);
  });

  it("decodes the ampersand last, so an escaped tag stays escaped", () => {
    const items = parseNewsFeed(feed(`<item><title>&amp;lt;b&amp;gt; is not bold</title></item>`));
    expect(items[0].title).toBe("&lt;b&gt; is not bold");
  });

  it("states nothing the feed does not say", () => {
    const items = parseNewsFeed(feed(`<item><title>Bare</title></item>`));
    expect(items[0]).toEqual({ title: "Bare", summary: "", category: null, publishedAt: null });
  });

  it("skips an item with no headline rather than showing an empty one", () => {
    const items = parseNewsFeed(feed(`<item><description>Orphan</description></item><item><title>Real</title></item>`));
    expect(items.map((item) => item.title)).toEqual(["Real"]);
  });

  it("cuts a very long summary at a word, and says it was cut", () => {
    const long = `<item><title>T</title><description>${"word ".repeat(200)}</description></item>`;
    const [item] = parseNewsFeed(feed(long));
    expect(item.summary.length).toBeLessThanOrEqual(401);
    expect(item.summary.endsWith("…")).toBe(true);
    expect(item.summary).not.toContain("wor…");
  });

  it("takes only as many as it was asked for, in the order filed", () => {
    const many = Array.from({ length: 30 }, (_, index) => `<item><title>Item ${index}</title></item>`).join("");
    const items = parseNewsFeed(feed(many), 5);
    expect(items).toHaveLength(5);
    expect(items[0].title).toBe("Item 0");
  });

  it("answers an empty document with an empty list", () => {
    expect(parseNewsFeed("")).toEqual([]);
    expect(parseNewsFeed("<html>not a feed</html>")).toEqual([]);
  });
});
