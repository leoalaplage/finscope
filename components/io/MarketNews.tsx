"use client";

import { useEffect, useState } from "react";
import { shortDate } from "./format";
import type { NewsItem } from "@/lib/news";

/**
 * The wire, under the indices.
 *
 * A headline and the sentence under it, in the same ink as everything else on
 * the site. Nothing here is a link and nothing here is an image: what the page
 * offers is the news itself, read where the reader already is, rather than a
 * row of doors out of it. Somebody else wrote these words and they are shown as
 * their words — stripped to text on the way in, never rendered as markup.
 *
 * Loaded after the charts and never in their way: the indices are what the page
 * is for, and a feed that is slow, refused or empty leaves the rest of the page
 * exactly as it was.
 */

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "ready"; items: NewsItem[]; source: string };

export function MarketNews() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/news", { signal: controller.signal });
        if (!response.ok) { setState({ kind: "absent" }); return; }
        const payload = await response.json() as { items?: NewsItem[]; source?: string };
        const items = (payload.items ?? []).filter((item) => item.title);
        setState(items.length ? { kind: "ready", items, source: payload.source ?? "the wire" } : { kind: "absent" });
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
        <span className="label">{state.kind === "ready" ? state.source : "Reading the wire"}</span>
      </div>
      {state.kind === "loading" ? (
        <div className="news-list">
          {[0, 1, 2, 3].map((row) => <div className="news-item skeleton" key={row} style={{ height: 58 }} />)}
        </div>
      ) : (
        <div className="news-list">
          {state.items.map((item) => (
            <article className="news-item" key={`${item.publishedAt ?? ""}${item.title}`}>
              <div className="news-meta">
                {item.publishedAt ? <time dateTime={item.publishedAt}>{clock(item.publishedAt)}</time> : null}
                {item.category ? <span>{item.category}</span> : null}
              </div>
              <h3 className="news-headline">{item.title}</h3>
              {item.summary ? <p className="news-summary">{item.summary}</p> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The hour for something filed today, the date for anything older.
 *
 * A wire item is read for how recent it is, and "14:20" says that where a date
 * repeated eighteen times says nothing at all.
 */
function clock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const today = new Date();
  const sameDay = at.getUTCFullYear() === today.getUTCFullYear()
    && at.getUTCMonth() === today.getUTCMonth()
    && at.getUTCDate() === today.getUTCDate();
  return sameDay
    ? at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : shortDate(iso);
}
