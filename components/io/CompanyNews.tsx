"use client";

import { useEffect, useState } from "react";
import { clock } from "./format";
import type { NewsItem } from "@/lib/news";

/**
 * What the company itself has said lately, at the foot of its page.
 *
 * The rest of this page is what a company filed: audited, dated, and months
 * old by the time it is read. This is the other half of the same question —
 * what it announced since — and it is the company's own newsroom rather than
 * anybody's coverage of it, so the two halves of the page have the same author.
 *
 * Stripped to text in the Worker, and each headline opens the release itself.
 * The wire on the market page carries no links and this does: there the
 * destination is a third party nobody here vouches for, here it is the company
 * whose filings are on the rest of the screen, and the release is the document
 * the headline is a summary of. Only an HTTP(S) address survives the parser, so
 * nothing that executes can reach the markup.
 *
 * A company with no verified feed has no panel. Not an empty box, not an
 * apology — the page simply ends at the statements, exactly as it did before
 * this section existed.
 */

/** The item as the page draws it: the summary never crosses. */
type Headline = Omit<NewsItem, "summary">;

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "ready"; items: Headline[] };

export function CompanyNews({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/company/${encodeURIComponent(ticker)}/news`, { signal: controller.signal });
        if (!response.ok) { setState({ kind: "absent" }); return; }
        const payload = await response.json() as { items?: Headline[] };
        const items = (payload.items ?? []).filter((item) => item.title);
        setState(items.length ? { kind: "ready", items } : { kind: "absent" });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "absent" });
      }
    })();
    return () => controller.abort();
  }, [ticker]);

  if (state.kind === "absent") return null;

  return (
    <section className="section news" aria-labelledby="company-news-title">
      <div className="section-head">
        <h2 className="label" id="company-news-title">Newsroom</h2>
        <span className="label">{ticker} · published by the company</span>
      </div>
      {state.kind === "loading" ? (
        <div className="news-list">
          {[0, 1, 2, 3].map((row) => <div className="news-item skeleton" key={row} style={{ height: 38 }} />)}
        </div>
      ) : (
        <div className="news-list">
          {state.items.map((item) => (
            <article className="news-item" key={`${item.publishedAt ?? ""}${item.title}`}>
              <div className="news-meta">
                {item.publishedAt ? <time dateTime={item.publishedAt}>{clock(item.publishedAt)}</time> : null}
              </div>
              <h3 className="news-headline">
                {/* The company's own release, at the company's own address:
                    the destination is the document being read about, not
                    somebody else's front page. */}
                {item.sourceUrl
                  ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.title}</a>
                  : item.title}
                {item.category ? <span className="news-section"> · {item.category}</span> : null}
              </h3>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
