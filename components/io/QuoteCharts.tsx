"use client";

import { useEffect, useRef, useState } from "react";
import { IndexPanel, type MarketEntry } from "../MarketPage";
import { MARKET_RANGES, type MarketRange } from "@/lib/adapters/intraday";

/**
 * The panels a reader opens from a strip, in the format the indices are drawn in.
 *
 * The strips under the indices are figures rather than charts, because six
 * drawings under three drawings is a page with no subject. But a figure is
 * where a question starts — Brent down two per cent is the end of a month of
 * falling or the first day of it, and the number alone cannot say which — so
 * any cell opens into the same panel, on the same scales, with the same dashed
 * line meaning the same thing.
 *
 * Three at a time, which is the row above. A fourth pushes out the oldest
 * rather than refusing: a reader clicking a fourth line wants to see it, and
 * making them close something first is a step that exists only to enforce a
 * limit the layout already implies.
 *
 * Every open panel shares one window, because the row is read across. Three
 * charts each on their own timeframe is three answers to three questions
 * nobody asked together.
 */

/**
 * A month, rather than the day the indices open on, unless a strip asks for
 * another — the bond strip opens on a year, because a yield is read over
 * quarters and its monthly members have one point a month.
 *
 * These panels are opened deliberately, by a reader who wants the shape of a
 * thing rather than its tick. A month is also the shortest window every source
 * here can draw: the ECB strikes its curve once a business day, so a single
 * session of it is one point and not a line.
 */
const DEFAULT_RANGE: MarketRange = "1M";

export function QuoteCharts({ open, label, defaultRange = DEFAULT_RANGE }: { open: string[]; label: string; defaultRange?: MarketRange }) {
  const [range, setRange] = useState<MarketRange>(defaultRange);
  const [answers, setAnswers] = useState<Record<string, MarketEntry>>({});
  /*
   * What has already been asked for, kept beside the answers rather than
   * derived from them.
   *
   * The effect needs to know "have I already sent this request", and asking
   * the answers that question would make the effect depend on the state it
   * writes — every arrival restarting the loop that produced it. The key
   * carries the window, so changing the range asks again and going back to a
   * window already drawn costs nothing.
   */
  const asked = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!open.length) return;
    const controller = new AbortController();
    (async () => {
      for (const id of open) {
        const key = `${id}|${range}`;
        if (asked.current.has(key)) continue;
        asked.current.add(key);
        try {
          const response = await fetch(`/api/quote/${encodeURIComponent(id)}?range=${range}`, { signal: controller.signal });
          const payload = await response.json() as MarketEntry & { error?: string };
          // A refusal carries its reason — "the ECB publishes this once a day"
          // is something a reader can act on, and "unavailable" is not.
          const entry: MarketEntry = response.ok && !payload.error
            ? payload
            : { id, name: payload?.name ?? id, error: payload?.error ?? "This series is unavailable right now." };
          setAnswers((current) => ({ ...current, [key]: entry }));
        } catch {
          // An abandoned request is not a failure, and must not leave the key
          // marked as asked: the panel would sit on its skeleton for ever.
          if (controller.signal.aborted) { asked.current.delete(key); return; }
          setAnswers((current) => ({ ...current, [key]: { id, name: id, error: "This series is unavailable right now." } }));
        }
      }
    })();
    return () => controller.abort();
  }, [open, range]);

  if (!open.length) return null;

  return (
    <div className="strip-open">
      <div className="market-ranges">
        <div className="segmented" role="group" aria-label={`Time range for the ${label} charts`}>
          {MARKET_RANGES.map((option) => (
            <button key={option} type="button" className={range === option ? "active" : ""}
              aria-pressed={range === option} onClick={() => setRange(option)}>{option}</button>
          ))}
        </div>
      </div>
      <div className="index-grid">
        {open.map((id) => {
          const entry = answers[`${id}|${range}`];
          return entry
            ? <IndexPanel key={id} entry={entry} range={range} scale={null}/>
            : <div className="index-panel skeleton" key={id} style={{ height: 290 }} aria-hidden="true"/>;
        })}
      </div>
    </div>
  );
}

/**
 * What clicking a cell does, in one place because two strips do it.
 *
 * Clicking an open cell closes it; clicking a fourth drops the oldest.
 */
export function toggleOpen(open: string[], id: string, most = 3) {
  return open.includes(id) ? open.filter((each) => each !== id) : [...open, id].slice(-most);
}
