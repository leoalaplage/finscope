"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IntradaySnapshot } from "@/lib/adapters/intraday";

type Panel = IntradaySnapshot & { id: string; description: string };
type Failed = { id: string; symbol: string; name: string; description: string; error: string };
type Entry = Panel | Failed;

const failed = (entry: Entry): entry is Failed => "error" in entry;

/**
 * How often the page asks for a new picture of the session.
 *
 * The bars underneath are five minutes wide, so polling faster than that only
 * moves the last price and the relative-volume bar — which is exactly the part
 * a reader watching an open market is watching. Once the market is shut none of
 * it changes at all, and continuing to poll would be asking a question whose
 * answer is already known.
 */
const OPEN_MS = 30_000;
const CLOSED_MS = 10 * 60_000;

const signed = (value: number | null, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : `${value < 0 ? "−" : "+"}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const level = (value: number | null, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * A level at six significant digits, which is how an index is quoted.
 *
 * Two decimal places is right for the S&P at 7,745.06 and two too many for the
 * Dow at 53,459.78, where the last digits are noise and, in a badge sized for
 * the axis beside it, noise that pushes the leading digit out of view.
 */
const quoted = (value: number | null) =>
  value == null || !Number.isFinite(value) ? "—"
    : value.toLocaleString("en-US", { maximumFractionDigits: Math.max(0, 6 - Math.max(1, Math.floor(Math.log10(Math.abs(value))) + 1)) });

/** "Aug 17", the way a market page dates a session. */
function sessionLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Ticks a reader would have chosen, across a range that is never zero-based.
 *
 * An index chart is a picture of one day's movement, so the scale has to fit
 * the day: an axis starting at zero would draw every session as a flat line
 * near the top. The step is rounded to 1, 2 or 5 times a power of ten so the
 * labels read 7750, 7760, 7770 rather than 7748.3, 7761.9.
 */
export function priceTicks(low: number, high: number, count = 6): number[] {
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) return [];
  if (high === low) return [low];
  const raw = (high - low) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 0.001; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

/** The hour marks along the bottom, one per whole hour the session covers. */
export function hourMarks(labels: string[]): Array<{ index: number; text: string }> {
  const marks: Array<{ index: number; text: string }> = [];
  let lastHour = "";
  labels.forEach((label, index) => {
    const [hours, minutes] = label.split(":");
    if (minutes !== "00" || hours === lastHour) return;
    lastHour = hours;
    const hour = Number(hours);
    marks.push({ index, text: `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "AM" : "PM"}` });
  });
  return marks;
}

/**
 * The pixel width of an element, tracked as it changes.
 *
 * The chart is drawn at the size it is actually displayed at rather than being
 * scaled into place. A viewBox stretched to fit would either squash the candles
 * or drag the axis text along with it — three panels across a laptop leaves
 * each about 250px wide, and a 560-unit viewBox scaled into that renders
 * nine-point labels at four. Measuring costs one observer and keeps every
 * stroke and every character at its intended size on any screen.
 */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      setWidth((current) => Math.abs(current - measured) < 1 ? current : measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * One index: the session drawn as candles against yesterday's close.
 *
 * Hand-drawn SVG rather than the charting library used elsewhere, which has no
 * candle primitive — a candle is two marks sharing an x, and expressing that
 * through a bar chart with a stacked invisible base is more code than the
 * thirty lines below, not less.
 */
function IndexPanel({ entry }: { entry: Entry }) {
  // The two cases are separate components rather than two returns from one,
  // because the chart measures itself with a hook and a hook cannot live
  // behind a conditional return.
  return failed(entry)
    ? <article className="index-panel index-panel-failed">
        <header className="index-head"><h2>{entry.name}</h2></header>
        <p className="simple-state">{entry.error}</p>
      </article>
    : <IndexSession entry={entry}/>;
}

function IndexSession({ entry }: { entry: Panel }) {
  const [chartRef, measured] = useMeasuredWidth<HTMLDivElement>();
  const bars = entry.bars;
  const rising = (entry.change ?? 0) >= 0;
  // Yesterday's close belongs inside the scale even on a day that never traded
  // back to it, because the whole chart is a statement about distance from it.
  const values = [...bars.flatMap((bar) => [bar.high, bar.low]), ...(entry.previousClose != null ? [entry.previousClose] : [])];
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const pad = (high - low) * 0.08 || 1;
  const top = high + pad, bottom = low - pad;

  const height = 168, leftGutter = 2, rightGutter = 54, headroom = 9;
  const width = Math.max(measured, 200);
  const plotWidth = Math.max(40, width - leftGutter - rightGutter);
  const y = (value: number) => headroom + (top - value) / (top - bottom) * (height - headroom * 2);
  const slot = plotWidth / Math.max(bars.length, 1);
  const bodyWidth = Math.max(1.2, Math.min(7, slot * 0.62));

  const ticks = priceTicks(bottom, top);
  const marks = hourMarks(bars.map((bar) => bar.label));
  const lastClose = bars.at(-1)?.close ?? entry.last;

  // The relative-volume gauge is its own tiny axis, 0.5 to 2.0, because that is
  // the range the number actually lives in — a day at four times normal volume
  // is off the scale and should look it.
  const rvol = entry.relativeVolume;
  const gaugeTop = 2.0, gaugeBottom = 0.35;
  const gaugeFill = rvol == null ? 0 : Math.min(1, Math.max(0, (Math.min(rvol, gaugeTop) - gaugeBottom) / (gaugeTop - gaugeBottom)));

  return <article className="index-panel">
    <header className="index-head">
      <h2>{entry.name}</h2>
      <span className="index-date">{sessionLabel(entry.sessionDate)}</span>
      <strong className={rising ? "index-change positive-text" : "index-change negative-text"}>
        {signed(entry.change)} ({entry.changePercent == null ? "—" : `${(Math.abs(entry.changePercent) * 100).toFixed(2)}%`})
      </strong>
    </header>

    <div className="index-body">
      <div className="index-gauge" title={rvol == null ? "No comparable session to measure against" : `Volume so far is ${rvol.toFixed(2)}× a normal session at this time of day`}>
        <div className="index-gauge-track">
          <span className="index-gauge-fill" style={{ height: `${gaugeFill * 100}%` }}/>
        </div>
        <small>Relative<br/>volume</small>
      </div>

      <div className="index-chart" ref={chartRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`${entry.name} on ${sessionLabel(entry.sessionDate)}: ${level(entry.last)}, ${signed(entry.change)} from a previous close of ${level(entry.previousClose)}.`}>
        {ticks.map((tick) => <g key={tick}>
          <line className="index-grid" x1={leftGutter} x2={leftGutter + plotWidth} y1={y(tick)} y2={y(tick)}/>
          <text className="index-axis" x={width - rightGutter + 8} y={y(tick) + 3.5}>{level(tick, 0)}</text>
        </g>)}

        {entry.previousClose != null &&
          <line className="index-prevclose" x1={leftGutter} x2={leftGutter + plotWidth} y1={y(entry.previousClose)} y2={y(entry.previousClose)}/>}

        {bars.map((bar, index) => {
          const x = leftGutter + index * slot + slot / 2;
          const up = bar.close >= bar.open;
          const bodyTop = y(Math.max(bar.open, bar.close));
          const bodyBottom = y(Math.min(bar.open, bar.close));
          return <g key={bar.time} className={up ? "index-candle up" : "index-candle down"}>
            <line x1={x} x2={x} y1={y(bar.high)} y2={y(bar.low)}/>
            <rect x={x - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={Math.max(0.8, bodyBottom - bodyTop)}/>
          </g>;
        })}

        {lastClose != null && <g className="index-last">
          <rect x={width - rightGutter + 2} y={y(lastClose) - 8} width={rightGutter - 4} height={16} rx={2}/>
          <text x={width - rightGutter + 6} y={y(lastClose) + 3.5}>{quoted(lastClose)}</text>
        </g>}
      </svg>
      {/* The hour marks belong to the plot, not to the panel: placing them
          across the full width would drift them right by the price gutter. */}
      <div className="index-times" aria-hidden="true">
        {marks.map((mark) => <span key={mark.index} style={{ left: `${(leftGutter + (mark.index + 0.5) * slot) / width * 100}%` }}>{mark.text}</span>)}
      </div>
      </div>
    </div>
  </article>;
}

/**
 * The three US indices, as the session stands.
 *
 * Deliberately the whole page: this is the one screen in the application that
 * answers "what is the market doing right now" rather than "what is this
 * business worth", and mixing the two would make both harder to read.
 */
export function MarketPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/indices", { cache: "no-store" });
      const payload = await response.json() as { indices?: Entry[]; error?: string };
      if (!alive.current) return;
      if (!response.ok && !payload.indices?.length) throw new Error(payload.error || "Market data is unavailable.");
      setEntries(payload.indices ?? []);
      setUpdatedAt(new Date());
      setError("");
    } catch (cause) {
      if (!alive.current) return;
      // A failed refresh must not blank a page that is already showing a
      // session. The last good picture stays up and says it is stale.
      setError(cause instanceof Error ? cause.message : "Market data is unavailable.");
      setEntries((current) => current ?? []);
    }
  }, []);

  const anyOpen = useMemo(() => (entries ?? []).some((entry) => !failed(entry) && entry.open), [entries]);
  // The timer reads this rather than depending on it, so that a market opening
  // changes the next interval instead of tearing down and restarting the loop.
  const anyOpenRef = useRef(anyOpen);
  useEffect(() => { anyOpenRef.current = anyOpen; }, [anyOpen]);

  useEffect(() => {
    alive.current = true;
    const tick = async () => {
      await load();
      if (!alive.current) return;
      // A hidden tab is a reader who is not looking. Polling it every thirty
      // seconds spends their battery and our rate limit on nobody.
      const watching = document.visibilityState === "visible";
      timer.current = setTimeout(tick, watching && anyOpenRef.current ? OPEN_MS : CLOSED_MS);
    };
    void tick();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return <div className="market-page">
    <header className="page-heading">
      <div>
        <h1>Market</h1>
        <p>The three US indices through today&rsquo;s session, five minutes at a time. The dashed line is the previous close, so the whole chart reads as distance from it.</p>
      </div>
      <div className="market-status">
        <span className={anyOpen ? "market-dot open" : "market-dot"} aria-hidden="true"/>
        <small>
          {entries == null ? "Loading…" : anyOpen ? "Market open" : "Market closed"}
          {updatedAt && ` · updated ${updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
        </small>
      </div>
    </header>

    {error && <p className="notice">{error}</p>}
    {entries == null && <p className="simple-state">Loading the session…</p>}
    {entries != null && !entries.length && !error && <p className="simple-state">No index data is available right now.</p>}

    <div className="index-grid">
      {(entries ?? []).map((entry) => <IndexPanel key={entry.id} entry={entry}/>)}
    </div>

    {entries?.some((entry) => !failed(entry)) &&
      <p className="market-foot">Prices from Yahoo Finance, delayed as the exchange requires. Relative volume compares today&rsquo;s volume so far with the same point in recent sessions.</p>}
  </div>;
}
