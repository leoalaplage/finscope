"use client";

import { useEffect, useState } from "react";
import { clock } from "./format";
import type { NewsItem } from "@/lib/news";

/**
 * The wire, under the indices.
 *
 * Headlines, in the same ink as everything else on the site: an hour, a
 * section, and the line itself. The verified HTTP(S) URL carried by the feed
 * opens the original source; no feed markup or image reaches this page.
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

const host = (url: string | null) => {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
};

export function MarketNews() {
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

  // A feed nobody can reach is simply not a section. The market page is about
  // the indices above it, and an error box under them would say nothing a
  // reader of this page came for.
  if (state.kind === "absent") return null;

  return (
    <section className="section news" aria-labelledby="news-title">
      <div className="section-head">
        <h2 className="label" id="news-title">Latest news</h2>
      </div>
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
                {host(item.sourceUrl) ? <span>{host(item.sourceUrl)}</span> : null}
              </div>
              <h3 className="news-headline">
                {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.title}</a> : item.title}
                {item.category ? <span className="news-section"> · {item.category}</span> : null}
              </h3>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
