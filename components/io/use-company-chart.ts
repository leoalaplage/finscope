"use client";

import { useEffect, useMemo, useState } from "react";
import type { CompanyState } from "./use-company";
import type { IoQuote } from "./quote";
import { toggleMetric } from "./selection";
import { useValuationHistory, VALUATION_METRICS } from "./valuation-series";
import { fundamentalWindow, RANGES, type Frequency, type Range } from "./ranges";

/**
 * What the company chart is showing, and the address that says so.
 *
 * The measures drawn, the window, the series and the overlays — shared by the
 * document page and the terminal, because a link copied from one has to open
 * the same picture in the other.
 */

interface Address { metrics: string[]; range: Range; frequency: Frequency | null; rebased: boolean; withPrice: boolean }

/** What the query string says the page should be showing, if it says anything. */
function readAddress(): Address {
  const empty: Address = { metrics: [], range: "5Y", frequency: null, rebased: false, withPrice: false };
  if (typeof window === "undefined") return empty;
  const asked = new URLSearchParams(window.location.search);
  const range = asked.get("r") as Range | null;
  const frequency = asked.get("f");
  return {
    metrics: (asked.get("m") ?? "").split(",").filter(Boolean).slice(0, 3),
    range: range && RANGES.concat(["3Y", "10Y"]).includes(range) ? range : "5Y",
    frequency: frequency === "ttm" || frequency === "annual" ? frequency : null,
    rebased: asked.get("b") === "1",
    withPrice: asked.get("p") === "1",
  };
}

/**
 * The address follows the page, and says nothing it does not have to.
 *
 * A share price on its default window is the plain company URL — the one worth
 * sharing when there is nothing to say beyond "this company" — so every default
 * is left out rather than written down.
 */
function writeAddress(state: Address) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const set = (key: string, value: string | null) => {
    if (value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  };
  set("m", state.metrics.length ? state.metrics.join(",") : null);
  set("r", state.metrics.length || state.range !== "5Y" ? state.range : null);
  set("f", state.metrics.length && state.frequency !== fundamentalWindow(state.range).frequency ? state.frequency : null);
  set("b", state.rebased ? "1" : null);
  // The overlay is part of the picture, so a link to a measure held against the
  // share price opens on the measure held against the share price.
  set("p", state.metrics.length && state.withPrice ? "1" : null);
  if (url.toString() !== window.location.href) window.history.replaceState(null, "", url);
}

export function useCompanyChart(ticker: string, state: CompanyState, quote: IoQuote | null) {
  /*
   * The page is an address, the way a comparison already is.
   *
   * A reader who has put free cash flow per share on the chart over its whole
   * history has made a thing worth sending, and until now the link they sent
   * opened the share price over one year. The measures, the window and the
   * series are read from the query string on arrival and written back to it as
   * they change — with `replaceState`, so the back button still leaves the
   * company rather than walking through every click made on it.
   */
  const opening = readAddress();
  const [selection, setSelection] = useState<{ ticker: string; metrics: string[] }>({ ticker, metrics: opening.metrics });
  const [range, setRange] = useState<Range>(opening.range);
  /*
   * A frequency the reader asked for, and the range they asked for it on.
   *
   * The range already implies one — MAX means the annual series, because MAX
   * drawn from trailing figures is six years and a reader asking for everything
   * should get everything. The reader can override that, and moving the range
   * drops the override rather than carrying it somewhere it was never chosen:
   * the override simply is not this range's, so the implied frequency answers
   * again. No effect resets anything.
   */
  const [override, setOverride] = useState<{ range: Range; frequency: Frequency } | null>(
    opening.frequency ? { range: opening.range, frequency: opening.frequency } : null,
  );
  const [rebased, setRebased] = useState(opening.rebased);
  const [withPrice, setWithPrice] = useState(opening.withPrice);

  // Memoised because the empty case is a fresh array otherwise, and an effect
  // that writes the address would then run on every render.
  const selectedMetrics = useMemo(
    () => (selection.ticker === ticker ? selection.metrics : []),
    [selection, ticker],
  );
  /*
   * A measure opens on its whole history, in trailing figures.
   *
   * The range is shared with the price chart above, and the window a reader was
   * looking at a share price over is not the window they want a business
   * measure over: a month of revenue does not exist, and five years of it is a
   * cycle rather than a record. Picking a measure therefore asks for all of it,
   * and asks for it as trailing figures — MAX would otherwise fall to the
   * annual series, which is the right default for a reader who chose MAX and
   * the wrong one for a reader who chose a measure.
   */
  /*
   * The valuation multiples, read once for the page.
   *
   * The table below the chart states their ranges and the chart draws them, and
   * both are looking at this one series. Read here rather than inside either,
   * because two readers of the same figures making two requests for the same
   * prices is how two answers to one question get onto one page.
   */
  const valuation = useValuationHistory(state.kind === "ready" ? state.view : null, quote);

  /*
   * The unit a measure is read in, filed or struck.
   *
   * `toggleMetric` and `axesFor` both count distinct units to decide what a
   * chart can carry, so a measure whose unit is unknown is a measure they place
   * wherever the code happened to. The three valuation multiples are not in
   * `view.metrics` — a company files free cash flow and a share count, not what
   * the market charged for them — so they are named beside it.
   */
  const unitOf = (key: string) =>
    VALUATION_METRICS.find((metric) => metric.key === key)?.unit
    ?? (state.kind === "ready" ? state.view.metrics.find((metric) => metric.key === key)?.unit ?? null : null);

  /*
   * A measure opens on its whole history, in trailing figures.
   *
   * The range is shared with the price chart above, and the window a reader was
   * looking at a share price over is not the window they want a business
   * measure over: a month of revenue does not exist, and five years of it is a
   * cycle rather than a record. Picking the first measure therefore asks for
   * all of it, as trailing figures — MAX would otherwise fall to the annual
   * series, which is right for a reader who chose MAX and wrong for one who
   * chose a measure. Adding a second measure leaves the window alone: they
   * chose it.
   */
  const selectMetric = (metric: string | null) => {
    if (metric == null) { setSelection({ ticker, metrics: [] }); return; }
    const next = toggleMetric(selectedMetrics, metric, unitOf);
    setSelection({ ticker, metrics: next });
    if (selectedMetrics.length || !next.length) return;
    setRange("MAX");
    setOverride({ range: "MAX", frequency: "ttm" });
  };

  const frequency: Frequency = override?.range === range ? override.frequency : fundamentalWindow(range).frequency;
  const chooseFrequency = (next: Frequency) => setOverride({ range, frequency: next });

  useEffect(() => {
    writeAddress({ metrics: selectedMetrics, range, frequency, rebased, withPrice });
  }, [selectedMetrics, range, frequency, rebased, withPrice]);

  return {
    selectedMetrics, selectMetric, range, setRange, frequency, chooseFrequency,
    rebased, setRebased, withPrice, setWithPrice, valuation,
  };
}
