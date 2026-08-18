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
 * One index: the session drawn as a line against yesterday's close.
 *
 * Candles were the wrong instrument for this panel. Three indices across a
 * laptop leaves each about four hundred pixels for seventy-eight five-minute
 * bars, so every body was a two-pixel sliver and the wick that carries the
 * range was a hairline — the shape a reader could actually make out was the
 * sequence of closes, which is precisely what a line draws directly. The high
 * and low of a five-minute bar on an index is not information anyone reads at
 * this size; the shape of the day is.
 *
 * Hand-drawn SVG rather than the charting library used elsewhere, because the
 * panel needs its axis on the right, a reference line at the previous close and
 * a badge pinned to the last price — three things that cost more to configure
 * than to draw.
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
  const values = [...bars.map((bar) => bar.close), ...(entry.previousClose != null ? [entry.previousClose] : [])];
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const pad = (high - low) * 0.12 || 1;
  const top = high + pad, bottom = low - pad;

  const height = 190, leftGutter = 2, rightGutter = 56, headroom = 10;
  const width = Math.max(measured, 200);
  const plotWidth = Math.max(40, width - leftGutter - rightGutter);
  const y = (value: number) => headroom + (top - value) / (top - bottom) * (height - headroom * 2);
  const slot = plotWidth / Math.max(bars.length, 1);
  const x = (index: number) => leftGutter + (index + 0.5) * slot;

  const ticks = priceTicks(bottom, top);
  const marks = hourMarks(bars.map((bar) => bar.label));
  const lastClose = bars.at(-1)?.close ?? entry.last;

  // The line and the shape under it are the same points; the fill is the line
  // carried down to the floor of the plot and closed. Drawing them as one path
  // with a fill would put a stroke along the bottom edge too.
  const points = bars.map((bar, index) => `${x(index).toFixed(2)},${y(bar.close).toFixed(2)}`);
  const line = points.length ? `M${points.join("L")}` : "";
  const area = points.length
    ? `${line}L${x(bars.length - 1).toFixed(2)},${height - headroom}L${x(0).toFixed(2)},${height - headroom}Z`
    : "";
  // One gradient per panel, because an id is global to the document.
  const fillId = `index-fill-${entry.id}`;

  // Relative volume reads on a fixed scale, 0.35 to 2.0, because that is the
  // range the number actually lives in — a day at four times normal volume is
  // off the scale and should look it.
  const rvol = entry.relativeVolume;
  const gaugeTop = 2.0, gaugeBottom = 0.35;
  const gaugeFill = rvol == null ? 0 : Math.min(1, Math.max(0, (Math.min(rvol, gaugeTop) - gaugeBottom) / (gaugeTop - gaugeBottom)));

  return <article className={rising ? "index-panel up" : "index-panel down"}>
    <header className="index-head">
      <div className="index-name">
        <h2>{entry.name}</h2>
        <span className="index-date">{sessionLabel(entry.sessionDate)}</span>
      </div>
      <div className="index-quote">
        <strong>{quoted(lastClose)}</strong>
        <span className={rising ? "index-change positive-text" : "index-change negative-text"}>
          {signed(entry.change)} ({entry.changePercent == null ? "—" : `${(Math.abs(entry.changePercent) * 100).toFixed(2)}%`})
        </span>
      </div>
    </header>

    <div className="index-chart" ref={chartRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`${entry.name} on ${sessionLabel(entry.sessionDate)}: ${level(entry.last)}, ${signed(entry.change)} from a previous close of ${level(entry.previousClose)}.`}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22"/>
            <stop offset="100%" stopColor="currentColor" stopOpacity="0"/>
          </linearGradient>
        </defs>

        {ticks.map((tick) => <g key={tick}>
          <line className="index-grid" x1={leftGutter} x2={leftGutter + plotWidth} y1={y(tick)} y2={y(tick)}/>
          <text className="index-axis" x={width - rightGutter + 9} y={y(tick) + 3.5}>{level(tick, 0)}</text>
        </g>)}

        {entry.previousClose != null &&
          <line className="index-prevclose" x1={leftGutter} x2={leftGutter + plotWidth} y1={y(entry.previousClose)} y2={y(entry.previousClose)}/>}

        {area && <path className="index-area" d={area} fill={`url(#${fillId})`}/>}
        {line && <path className="index-line" d={line}/>}
        {lastClose != null && points.length > 0 &&
          <circle className="index-dot" cx={x(bars.length - 1)} cy={y(lastClose)} r={2.6}/>}

        {lastClose != null && <g className="index-last">
          <rect x={width - rightGutter + 3} y={y(lastClose) - 8} width={rightGutter - 6} height={16} rx={4}/>
          <text x={width - rightGutter + 8} y={y(lastClose) + 3.5}>{quoted(lastClose)}</text>
        </g>}
      </svg>
      {/* The hour marks belong to the plot, not to the panel: placing them
          across the full width would drift them right by the price gutter. */}
      <div className="index-times" aria-hidden="true">
        {marks.map((mark) => <span key={mark.index} style={{ left: `${x(mark.index) / width * 100}%` }}>{mark.text}</span>)}
      </div>
    </div>

    {/* The gauge reads left to right under the chart rather than standing up
        beside it, where a 14px column of colour competed with the plot for the
        reader's eye and stole width the session needed. */}
    <footer className="index-foot" title={rvol == null ? "No comparable session to measure against" : `Volume so far is ${rvol.toFixed(2)}× a normal session at this time of day`}>
      <span>Relative volume</span>
      <div className="index-gauge-track"><i style={{ width: `${gaugeFill * 100}%` }}/></div>
      <b>{rvol == null ? "—" : `${rvol.toFixed(2)}×`}</b>
    </footer>
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
