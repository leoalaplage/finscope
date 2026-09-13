"use client";

import { useEffect, useState } from "react";
import { clock } from "./format";
import type { NewsItem } from "@/lib/news";

/**
 * The wire, under the indices.
 *
 * Headlines, in the same ink as everything else on the site: an hour, a
 * section, and the line itself. Nothing here is a link and nothing here is an
 * image — what the page offers is the news read where the reader already is,
 * rather than a row of doors out of it, and the wire's own host is not a
 * byline worth printing beside every line. Somebody else wrote these lines and
 * they are shown as their words, stripped to text on the way in and never
 * rendered as markup.
 *
 * Loaded after the charts and never in their way: the indices are what the page
 * is for, and a feed that is slow, refused or empty leaves the rest of the page
 * exactly as it was.
 */

/** The item as the page draws it: the summary never crosses. */
type Headline = Omit<NewsItem, "summary">;

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "ready"; items: Headline[] };

export function NewsList() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/news", { signal: controller.signal });
        if (!response.ok) { setState({ kind: "absent" }); return; }
        const payload = await response.json() as { items?: Headline[] };
        const items = (payload.items ?? []).filter((item) => item.title);
        setState(items.length ? { kind: "ready", items } : { kind: "absent" });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "absent" });
      }
    })();
    return () => controller.abort();
  }, []);

  // A wire nobody can reach says so, rather than leaving the reader who
  // chose this tab looking at an empty panel.
  if (state.kind === "absent") return <p className="stat-note wire-caption">The wire could not be read just now.</p>;

  return (
    <>
      {state.kind === "loading" ? (
        <div className="news-list">
          {[0, 1, 2, 3].map((row) => <div className="news-item skeleton" key={row} style={{ height: 38 }} />)}
        </div>
      ) : (
        <div className="news-list">
          {state.items.map((item) => (
            <article className="news-item" key={`${item.publishedAt ?? ""}${item.title}`}>
              {/* The hour, or the date once an item is older than today. The
                  section it was filed under names the headline rather than
                  labelling it, so it reads at the end of the line. */}
              <div className="news-meta">
                {item.publishedAt ? <time dateTime={item.publishedAt}>{clock(item.publishedAt)}</time> : null}
              </div>
              <h3 className="news-headline">
                {item.title}
                {item.category ? <span className="news-section"> · {item.category}</span> : null}
              </h3>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
