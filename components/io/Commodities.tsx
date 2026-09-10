"use client";

import { useEffect, useState } from "react";
import type { CommodityQuote } from "@/app/api/commodities/route";
import { ABSENT, delta, price as writePrice } from "./format";

/**
 * What the raw materials cost, under the indices they move.
 *
 * The market page showed three equity indices and nothing else, which is one
 * asset class pretending to be the market. What an oil major earns, what a
 * miner earns, what a factory pays and what next month's inflation print will
 * read all sit in these six lines and in none of the three above them.
 *
 * A row of figures rather than six more charts. The panels above are the
 * subject of the page and earn their drawings; a barrel of oil is context, and
 * context that takes as much room as the subject stops being context. Today's
 * move takes the same highlighter as the watchlist's own day column — the one
 * colour on this site — because this row is read the same way: scanned down,
 * not read across.
 *
 * Loaded after everything else and never in the way. Nothing here is refetched
 * on a timer: the answer is built once every five minutes for every reader,
 * because a contract that settles once a day does not need a live feed, and
 * nine calls to one upstream on every render is how a Worker gets refused.
 */

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "ready"; quotes: CommodityQuote[] };

export function Commodities() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/commodities", { signal: controller.signal });
        if (!response.ok) { setState({ kind: "absent" }); return; }
        const payload = await response.json() as { commodities?: CommodityQuote[] };
        const quotes = (payload.commodities ?? []).filter((quote) => quote.price != null);
        setState(quotes.length ? { kind: "ready", quotes } : { kind: "absent" });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "absent" });
      }
    })();
    return () => controller.abort();
  }, []);

  // A feed nobody can reach is simply not a section, as the wire below is not.
  if (state.kind === "absent") return null;

  return (
    <section className="section commodities" aria-labelledby="commodities-title">
      <div className="section-head">
        <h2 className="label" id="commodities-title">Commodities</h2>
        <span className="label">Front-month futures</span>
      </div>

      {state.kind === "loading" ? (
        <div className="grid-ruled commodity-grid">
          {[0, 1, 2, 3, 4, 5].map((cell) => <div className="stat skeleton" key={cell} style={{ height: 74 }} />)}
        </div>
      ) : (
        <div className="grid-ruled commodity-grid">
          {state.quotes.map((quote) => (
            <div className="stat" key={quote.id}>
              <div className="label">{quote.label}</div>
              <div className="stat-value">
                {quote.price == null ? ABSENT : writePrice(quote.price, quote.currency, quote.places)}
              </div>
              <div className="commodity-move">
                {/* The width of the figure, as on the watchlist: the one place
                    on this site a colour carries meaning, and the sign is in
                    the number for a reader who cannot separate the two hues. */}
                <span
                  className="day-mark"
                  data-dir={quote.changePercent == null ? undefined : quote.changePercent > 0 ? "up" : quote.changePercent < 0 ? "down" : "flat"}
                >
                  {quote.changePercent == null ? ABSENT : delta(quote.changePercent, 1)}
                </span>
                <span className="label">{quote.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
