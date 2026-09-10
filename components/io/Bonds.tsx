"use client";

import { useEffect, useState } from "react";
import type { BondQuote } from "@/app/api/bonds/route";
import { QuoteCharts, toggleOpen } from "./QuoteCharts";
import { ABSENT } from "./format";

/**
 * What governments pay to borrow, under the raw materials.
 *
 * The page had equities and commodities and was still missing the number both
 * are discounted by. Every valuation on this site starts from a risk-free rate;
 * this row is where that rate comes from, and the shape of it — three months
 * against thirty years — is the most watched reading in finance.
 *
 * Six lines, and only where a daily source exists that a machine can read: the
 * four US Treasury yields, which are quoted like any instrument, and the ECB's
 * own euro-area curve, which is struck once a business day. The United Kingdom
 * is not here, and the file that defines this list says exactly why rather than
 * putting a stale monthly average in a row of daily readings.
 *
 * Each figure carries the date it was struck on, which is the whole of how the
 * two frequencies are kept apart. A reading dated two days ago in a row of live
 * ones is only misleading if nobody says so.
 */

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "ready"; quotes: BondQuote[] };

/** "Sep 9", the way a market page dates a reading. */
function dated(date: string | null) {
  if (!date) return ABSENT;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * A move in basis points, signed, at one decimal.
 *
 * Hundredths of a point are the unit yields are quoted and argued in. A tenth
 * of a basis point is below the noise of any of these sources, and stating it
 * to two would be precision the figure does not carry.
 */
const bp = (value: number | null) =>
  value == null || !Number.isFinite(value) ? ABSENT : `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(1)} bp`;

export function Bonds() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/bonds", { signal: controller.signal });
        if (!response.ok) { setState({ kind: "absent" }); return; }
        const payload = await response.json() as { bonds?: BondQuote[] };
        const quotes = (payload.bonds ?? []).filter((quote) => quote.rate != null);
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
    <section className="section bonds" aria-labelledby="bonds-title">
      <div className="section-head">
        <h2 className="label" id="bonds-title">Government bonds</h2>
        <span className="label">Benchmark yields</span>
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
              title={quote.description}
              onClick={() => setOpen((current) => toggleOpen(current, quote.id))}
            >
              <div className="label">{quote.label}</div>
              <div className="stat-value">{quote.rate == null ? ABSENT : `${quote.rate.toFixed(3)}%`}</div>
              <div className="strip-move">
                {/* The width of the figure, as on the watchlist: the one place
                    on this site a colour carries meaning, and the sign is in
                    the number for a reader who cannot separate the two hues. */}
                <span
                  className="day-mark"
                  data-dir={quote.changeBp == null ? undefined : quote.changeBp > 0 ? "up" : quote.changeBp < 0 ? "down" : "flat"}
                >
                  {bp(quote.changeBp)}
                </span>
                <span className="label">{dated(quote.asOf)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <QuoteCharts open={open} label="government bond"/>
    </section>
  );
}
