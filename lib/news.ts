/**
 * A wire feed, read as text and nothing else.
 *
 * The market page shows headlines from an RSS feed somebody else writes, and
 * everything about how they are read here follows from that one fact: the
 * document is data, not markup to run and not instructions to follow. So no
 * fragment of it ever reaches the page as HTML. Every tag is stripped here,
 * every entity is resolved to a character, and what comes out the other side is
 * plain text that React escapes like any other string.
 *
 * The links are dropped on purpose too. A feed's own `<link>` is the one thing
 * on this site that would send a reader somewhere nobody here vouches for, and
 * a headline is worth reading without being a door.
 */

export interface NewsItem {
  /** The headline, as filed. */
  title: string;
  /** The item's own summary, stripped of the markup it was wrapped in. */
  summary: string;
  /** The section the feed files it under, where it names one. */
  category: string | null;
  /** When it was published, as an ISO instant, or null where unreadable. */
  publishedAt: string | null;
}

/** How much of an item is kept, so one long entry cannot take over the page. */
const MAX_TITLE = 200;
const MAX_SUMMARY = 400;

/**
 * The five named entities XML defines, and any numeric one.
 *
 * A feed encodes an apostrophe four different ways depending on who generated
 * it — `&apos;`, `&#39;`, `&#x27;`, or the character itself — and a headline
 * reading "Russia&#39;s" is worse than one that reads nothing at all.
 */
function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => codePoint(Number.parseInt(digits, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // Ampersand last: decoding it first would turn `&amp;lt;` into a tag.
    .replace(/&amp;/g, "&");
}

const codePoint = (value: number) =>
  Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";

/**
 * The readable text of a field, whatever it was wrapped in.
 *
 * This feed's summaries arrive as a block of HTML inside CDATA — a grid, an
 * anchor, an image and a span — of which one span is the sentence. Removing the
 * tags leaves exactly that sentence, and removing them is also what makes the
 * value safe to render: there is no markup left to be interpreted by anything.
 */
function plain(raw: string, limit: number): string {
  const withoutCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const withoutTags = withoutCdata.replace(/<[^>]*>/g, " ");
  const text = decode(withoutTags).replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  // Cut at a word rather than mid-syllable, and say that it was cut.
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * .6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const field = (item: string, tag: string): string | null => {
  const found = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(item);
  return found ? found[1] : null;
};

/**
 * Every item a feed carries, in the order it carries them.
 *
 * Written against the document rather than with an XML parser, because the
 * whole of what is wanted is four fields of text and a Worker should not carry
 * a parser to find them. An item with no title is not an item; everything else
 * is optional and absent where the feed does not say.
 */
export function parseNewsFeed(xml: string, limit = 24): NewsItem[] {
  const items: NewsItem[] = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const title = plain(field(item, "title") ?? "", MAX_TITLE);
    if (!title) continue;
    const published = plain(field(item, "pubDate") ?? "", 64);
    const stamp = published ? Date.parse(published) : Number.NaN;
    items.push({
      title,
      summary: plain(field(item, "description") ?? "", MAX_SUMMARY),
      category: plain(field(item, "category") ?? "", 40) || null,
      publishedAt: Number.isFinite(stamp) ? new Date(stamp).toISOString() : null,
    });
    if (items.length === limit) break;
  }
  return items;
}
