"use client";

import { useEffect, useState } from "react";
import type { StripQuote } from "@/app/api/strips/route";
import type { StripSet } from "@/lib/strips";
import { QuoteCharts, toggleOpen } from "./QuoteCharts";
import { ABSENT, delta, price as writePrice } from "./format";

/**
 * A row of quotes that are context rather than subject.
 *
 * The same shape as the commodities and the government bonds, because they
 * answer the same kind of question: a figure, the day's move under the one
 * highlighter this site allows itself, and what the figure is a figure of. One
 * click opens any of them into the panel the indices are drawn in.
 *
 * Two rows use it. The world indices, because a page called "Market" that
 * shows three American ones is a page about one country — and this one already
 * prices Japanese and British government debt. And the currencies, because the
 * site quotes oil in dollars, a gilt in sterling and a Bund in euros and said
 * nothing about what those are worth against each other.
 */

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "ready"; quotes: StripQuote[] };

export function Strip({ set, title, aside, label }: { set: StripSet; title: string; aside: string; label: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/strips?set=${set}`, { signal: controller.signal });
        if (!response.ok) { setState({ kind: "absent" }); return; }
        const payload = await response.json() as { quotes?: StripQuote[] };
        const quotes = (payload.quotes ?? []).filter((quote) => quote.price != null);
        setState(quotes.length ? { kind: "ready", quotes } : { kind: "absent" });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "absent" });
      }
    })();
    return () => controller.abort();
  }, [set]);

  // A feed nobody can reach is simply not a section, as the wire below is not.
  if (state.kind === "absent") return null;

  const id = `${set}-title`;
  return (
    <section className={`section strip-${set}`} aria-labelledby={id}>
      <div className="section-head">
        <h2 className="label" id={id}>{title}</h2>
        <span className="label">{aside}</span>
      </div>

      {state.kind === "loading" ? (
        <div className="grid-ruled strip-grid">
          {[0, 1, 2, 3, 4, 5].map((cell) => <div className="stat skeleton" key={cell} style={{ height: 74 }}/>)}
        </div>
      ) : (
        <div className="grid-ruled strip-grid">
          {state.quotes.map((quote) => (
            <button
              className="strip-cell" key={quote.id} type="button"
              aria-pressed={open.includes(quote.id)}
              onClick={() => setOpen((current) => toggleOpen(current, quote.id))}
            >
              <div className="label">{quote.label}</div>
              <div className="stat-value">
                {/* An index carries no currency sign: it is a level, not a
                    price, and "$25,568.56" would be a claim about money. */}
                {quote.price == null ? ABSENT
                  : set === "world" ? quote.price.toLocaleString("en-US", { minimumFractionDigits: quote.places, maximumFractionDigits: quote.places })
                  : writePrice(quote.price, quote.currency, quote.places)}
              </div>
              <div className="strip-move">
                <span className="day-mark" data-dir={quote.changePercent == null ? undefined : quote.changePercent > 0 ? "up" : quote.changePercent < 0 ? "down" : "flat"}>
                  {quote.changePercent == null ? ABSENT : delta(quote.changePercent / 100, 1)}
                </span>
                <span className="label">{quote.note}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <QuoteCharts open={open} label={label}/>
    </section>
  );
}
