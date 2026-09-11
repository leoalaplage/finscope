"use client";

import { useEffect, useState } from "react";
import type { BondQuote } from "@/app/api/bonds/route";
import { BOND_SETS, type BondSet } from "@/lib/bonds";
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
 * Three sets of six, turned with an arrow rather than stacked: the US and euro
 * curves every other rate is read against; the other large markets that
 * publish daily — Germany, the UK, Japan, Spain, Canada and Australia; then
 * France, Italy and four more euro members, whose only republishable figure is
 * the ECB's monthly average, dated as a month so it is never read as a day.
 * Each later set is asked for only when a reader turns to it.
 *
 * A chart opened from one set stays open when the reader turns to the other,
 * which is the point: the Bund beside the ten-year Treasury is the comparison
 * a reader turns the page to make.
 *
 * Each figure carries the date it was struck on, which is the whole of how the
 * two frequencies are kept apart. A reading dated two days ago in a row of live
 * ones is only misleading if nobody says so.
 */

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "ready"; quotes: BondQuote[] };

/** What each set is, said beside the arrows so the reader knows where they are. */
const SET_LABEL: Record<BondSet, string> = {
  core: "US & euro area",
  world: "Other large markets",
  euro: "Euro members · monthly",
};

/**
 * "Sep 9", the way a market page dates a reading — or "Aug avg." for a figure
 * that is a whole month's average, which no single day of it is.
 */
function dated(date: string | null, frequency: BondQuote["frequency"]) {
  if (!date) return ABSENT;
  const parsed = new Date(`${date.length === 7 ? `${date}-01` : date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return frequency === "monthly"
    ? `${parsed.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} avg.`
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
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
  const [set, setSet] = useState<BondSet>("core");
  const [sets, setSets] = useState<Partial<Record<BondSet, State>>>({});
  const [open, setOpen] = useState<string[]>([]);
  const state: State = sets[set] ?? { kind: "loading" };
  const loaded = sets[set] != null;

  useEffect(() => {
    // Each set is asked for once, the first time it is shown.
    if (loaded) return;
    const controller = new AbortController();
    const settle = (next: State) => setSets((current) => ({ ...current, [set]: next }));
    (async () => {
      try {
        const response = await fetch(`/api/bonds?set=${set}`, { signal: controller.signal });
        if (!response.ok) { settle({ kind: "absent" }); return; }
        const payload = await response.json() as { bonds?: BondQuote[] };
        const quotes = (payload.bonds ?? []).filter((quote) => quote.rate != null);
        settle(quotes.length ? { kind: "ready", quotes } : { kind: "absent" });
      } catch {
        if (!controller.signal.aborted) settle({ kind: "absent" });
      }
    })();
    return () => controller.abort();
  }, [set, loaded]);

  const index = BOND_SETS.indexOf(set);
  // The first set going quiet is what it always was: no section, as the wire
  // below has none. A later set going quiet says so, because the reader asked
  // for it and a blank would read as a page that had not loaded.
  if (set === "core" && state.kind === "absent") return null;

  return (
    <section className="section bonds" aria-labelledby="bonds-title">
      <div className="section-head">
        <h2 className="label" id="bonds-title">Government bonds</h2>
        <div className="strip-pager">
          <span className="label" aria-live="polite">{SET_LABEL[set]} · {index + 1}/{BOND_SETS.length}</span>
          <div className="seg" role="group" aria-label="Which government bonds to show">
            <button type="button" aria-label="Previous six" disabled={index === 0} onClick={() => setSet(BOND_SETS[index - 1])}>‹</button>
            <button type="button" aria-label="Next six" disabled={index === BOND_SETS.length - 1} onClick={() => setSet(BOND_SETS[index + 1])}>›</button>
          </div>
        </div>
      </div>

      {state.kind === "absent" ? (
        <p className="strip-note">These yields could not be read from their publishers just now.</p>
      ) : state.kind === "loading" ? (
        <div className="grid-ruled strip-grid">
          {[0, 1, 2, 3, 4, 5].map((cell) => <div className="stat skeleton" key={cell} style={{ height: 74 }}/>)}
        </div>
      ) : (
        <div className="grid-ruled strip-grid">
          {state.quotes.map((quote) => (
            <button
              className="strip-cell" key={quote.id} type="button"
              aria-pressed={open.includes(quote.id)}
              // The title alone would become the button's whole accessible
              // name, so a screen reader would hear the sentence and never the
              // tenor. The label leads; the description follows it.
              aria-label={`${quote.label} — ${quote.description}`}
              title={quote.description}
              onClick={() => setOpen((current) => toggleOpen(current, quote.id))}
            >
              <div className="label">{quote.label}</div>
              <div className="stat-value">{quote.rate == null ? ABSENT : `${quote.rate < 0 ? "−" : ""}${Math.abs(quote.rate).toFixed(3)}%`}</div>
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
                <span className="label">{dated(quote.asOf, quote.frequency)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <QuoteCharts open={open} label="government bond" defaultRange="1Y"/>
    </section>
  );
}
