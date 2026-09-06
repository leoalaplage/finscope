"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SkeletonCards } from "./Skeleton";
import { readParsed } from "@/lib/fetch-json";
import { MARKET_RANGES, type MarketRange, type MarketWindow } from "@/lib/adapters/intraday";

type Panel = MarketWindow & { id: string; description: string };
type Failed = { id: string; symbol: string; name: string; description: string; error: string };
type Entry = Panel | Failed;

const failed = (entry: Entry): entry is Failed => "error" in entry;

const MarketHeatmap = lazy(() => import("./MarketHeatmap").then((module) => ({ default: module.MarketHeatmap })));
const PerformanceTable = lazy(() => import("./PerformanceTable").then((module) => ({ default: module.PerformanceTable })));

/**
 * How often the page asks for a new picture of the market.
 *
 * Only the day moves while you are watching it. A month or a year gains one
 * point a day, so re-asking every thirty seconds would spend a request to
 * receive the same answer — the slower cadence there is not a compromise, it is
 * the correct interval for what is being watched. Once the market is shut
 * nothing changes at all.
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

/** What the dashed line means, in the words the chosen window makes true. */
const BASELINE_NOTE: Record<MarketRange, string> = {
  "1D": "the previous close",
  "5D": "five sessions ago",
  "1M": "a month ago",
  "6M": "six months ago",
  "1Y": "a year ago",
  "5Y": "five years ago",
};

/**
 * Ticks a reader would have chosen, across a range that is never zero-based.
 *
 * An index chart is a picture of movement, so the scale has to fit the
 * movement: an axis starting at zero would draw every session as a flat line
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

/** "Aug 17" for a date, or "Aug 24" once a window spans more than a year. */
function shortDate(iso: string, withYear: boolean) {
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", withYear
    ? { month: "short", year: "2-digit", timeZone: "UTC" }
    : { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Evenly spaced date marks for a window measured in days rather than hours.
 *
 * Hour marks are the right axis for one session and meaningless across a year,
 * where what a reader wants is a handful of dates spread along the line. Five
 * is enough to place any point and few enough that the labels never collide at
 * panel width. The year is added only once the window needs it, because "Aug
 * 24" on a one-month chart is a question nobody asked.
 */
export function dateMarks(labels: string[], count = 5): Array<{ index: number; text: string }> {
  if (labels.length === 0) return [];
  const withYear = labels[0]?.slice(0, 4) !== labels[labels.length - 1]?.slice(0, 4);
  const at = (index: number) => ({ index, text: shortDate(labels[index], withYear) });
  if (labels.length <= count) return labels.map((_, index) => at(index));
  const step = (labels.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, n) => at(Math.round(n * step)));
}

/**
 * The pixel width of an element, tracked as it changes.
 *
 * The chart is drawn at the size it is actually displayed at rather than being
 * scaled into place. A viewBox stretched to fit would drag the axis text along
 * with it — three panels across a laptop leaves each about four hundred pixels,
 * and a 560-unit viewBox scaled into that renders nine-point labels at seven.
 * Measuring costs one observer and keeps every stroke and every character at
 * its intended size on any screen.
 */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const apply = (measured: number) =>
      setWidth((current) => Math.abs(current - measured) < 1 ? current : measured);
    // Measured once, here, before the observer is trusted for anything.
    // A ResizeObserver's first callback is delivered asynchronously and a
    // browser is free to defer it — a background tab does exactly that — so
    // waiting for it leaves the element at a width of zero and the chart
    // drawn from nothing. The observer's job is the *changes*.
    apply(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * One index over the chosen window: the name, the performance, and the line.
 *
 * Three things, and nothing else. The panel used to carry a session date and a
 * relative-volume gauge with its own axis and its own footnote — furniture
 * around a chart that was itself the smallest thing on the card. What a reader
 * comes to this page for is the shape of the line and the number at the end
 * of it.
 */
function IndexPanel({ entry, range }: { entry: Entry; range: MarketRange }) {
  // The two cases are separate components rather than two returns from one,
  // because the chart measures itself with a hook and a hook cannot live
  // behind a conditional return.
  return failed(entry)
    ? <article className="index-panel index-panel-failed">
        <header className="index-head"><h2>{entry.name}</h2></header>
        <p className="simple-state">{entry.error}</p>
      </article>
    : <IndexChart entry={entry} range={range}/>;
}

function IndexChart({ entry, range }: { entry: Panel; range: MarketRange }) {
  const [chartRef, measured] = useMeasuredWidth<HTMLDivElement>();
  const points = entry.points;
  const rising = (entry.change ?? 0) >= 0;
  // The baseline belongs inside the scale even on a window that never traded
  // back to it, because the whole chart is a statement about distance from it.
  const values = [...points.map((point) => point.close), ...(entry.baseline != null ? [entry.baseline] : [])];
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const pad = (high - low) * 0.12 || 1;
  const top = high + pad, bottom = low - pad;

  const height = 230, leftGutter = 2, rightGutter = 56, headroom = 10;
  const width = Math.max(measured, 200);
  const plotWidth = Math.max(40, width - leftGutter - rightGutter);
  const y = (value: number) => headroom + (top - value) / (top - bottom) * (height - headroom * 2);
  const slot = plotWidth / Math.max(points.length, 1);
  const x = (index: number) => leftGutter + (index + 0.5) * slot;

  const marks = range === "1D"
    ? hourMarks(points.map((point) => point.label))
    : dateMarks(points.map((point) => point.label));
  const last = points.at(-1)?.close ?? entry.last;

  /**
   * The axis is a percentage, because that is the question the panel answers.
   *
   * "7,720" tells a reader nothing they can act on unless they already carry
   * yesterday's close in their head; "+0.3%" is the whole answer. The scale is
   * still the price scale — the line is not redrawn — only its labels are
   * stated as distance from the baseline, which is exactly what the dashed
   * line at zero already marks.
   *
   * Without a baseline there is nothing to be a percentage of, so the axis
   * falls back to levels rather than inventing a reference.
   */
  const base = entry.baseline;
  const asPercent = base != null && base !== 0;
  const toPercent = (value: number) => (value / base! - 1) * 100;
  const fromPercent = (value: number) => base! * (1 + value / 100);
  const ticks = asPercent
    ? priceTicks(toPercent(bottom), toPercent(top)).map(fromPercent)
    : priceTicks(bottom, top);
  const tickText = (value: number) => asPercent
    ? `${toPercent(value) >= 0 ? "+" : "−"}${Math.abs(toPercent(value)).toFixed(Math.abs(toPercent(top) - toPercent(bottom)) < 3 ? 1 : 0)}%`
    : level(value, 0);
  const badge = asPercent && last != null
    ? `${last >= base! ? "+" : "−"}${Math.abs(toPercent(last)).toFixed(2)}%`
    : quoted(last);

  // The line and the shape under it are the same points; the fill is the line
  // carried down to the floor of the plot and closed. Drawing them as one path
  // with a fill would put a stroke along the bottom edge too.
  const path = points.map((point, index) => `${x(index).toFixed(2)},${y(point.close).toFixed(2)}`);
  const line = path.length ? `M${path.join("L")}` : "";
  const area = path.length
    ? `${line}L${x(points.length - 1).toFixed(2)},${height - headroom}L${x(0).toFixed(2)},${height - headroom}Z`
    : "";
  // One gradient per panel, because an id is global to the document.
  const fillId = `index-fill-${entry.id}`;

  return <article className={rising ? "index-panel up" : "index-panel down"}>
    <header className="index-head">
      <h2>{entry.name}</h2>
      <div className="index-quote">
        <strong>{quoted(last)}</strong>
        <span className={rising ? "index-change positive-text" : "index-change negative-text"}>
          {/* Both halves carry the sign. Stating "−9.41 (0.02%)" makes the
              reader check twice whether the index rose or fell, which is the
              one thing this line exists to answer. */}
          {signed(entry.change)} ({entry.changePercent == null ? "—" : `${entry.changePercent < 0 ? "−" : "+"}${(Math.abs(entry.changePercent) * 100).toFixed(2)}%`})
        </span>
      </div>
    </header>

    <div className="index-chart" ref={chartRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`${entry.name} over ${range}: ${level(last)}, ${signed(entry.change)} from ${level(entry.baseline)} ${BASELINE_NOTE[range]}.`}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22"/>
            <stop offset="100%" stopColor="currentColor" stopOpacity="0"/>
          </linearGradient>
        </defs>

        {ticks.map((tick) => <g key={tick}>
          <line className={asPercent && Math.abs(tick - base!) < 1e-9 ? "index-grid index-grid-zero" : "index-grid"}
            x1={leftGutter} x2={leftGutter + plotWidth} y1={y(tick)} y2={y(tick)}/>
          <text className="index-axis" x={width - rightGutter + 9} y={y(tick) + 3.5}>{tickText(tick)}</text>
        </g>)}

        {entry.baseline != null &&
          <line className="index-prevclose" x1={leftGutter} x2={leftGutter + plotWidth} y1={y(entry.baseline)} y2={y(entry.baseline)}/>}

        {area && <path className="index-area" d={area} fill={`url(#${fillId})`}/>}
        {line && <path className="index-line" d={line}/>}
        {last != null && path.length > 0 &&
          <circle className="index-dot" cx={x(points.length - 1)} cy={y(last)} r={2.6}/>}

        {/* The badge is a panel, not a pill: the page's own corner radius, so
            it belongs to the same drawing as the cards around it. */}
        {last != null && <g className="index-last">
          <rect x={width - rightGutter + 3} y={y(last) - 8} width={rightGutter - 6} height={16} rx={2}/>
          <text x={width - rightGutter + 8} y={y(last) + 3.5}>{badge}</text>
        </g>}
      </svg>
      {/* The marks belong to the plot, not to the panel: placing them across
          the full width would drift them right by the price gutter. */}
      <div className="index-times" aria-hidden="true">
        {marks.map((mark) => <span key={mark.index} style={{ left: `${x(mark.index) / width * 100}%` }}>{mark.text}</span>)}
      </div>
    </div>
  </article>;
}

/**
 * The three US indices, over the window the reader chose.
 *
 * Deliberately the whole page: this is the one screen in the application that
 * answers "what is the market doing" rather than "what is this business worth",
 * and mixing the two would make both harder to read.
 */
export function MarketPage({ watchlist = [], indicesOnly = false }: { watchlist?: string[]; indicesOnly?: boolean }) {
  const [range, setRange] = useState<MarketRange>("1D");
  const firstRangeWrite = useRef(true);
  /**
   * The answer, carrying the window it answers for.
   *
   * Storing the two together is what makes a stale reply harmless: a request
   * for a year that lands after the reader has gone back to the day simply
   * does not match, and nothing is shown under the wrong heading. Clearing the
   * old data on every change would have needed the same guard anyway, and a
   * step where the screen is deliberately blanked besides.
   */
  const [answer, setAnswer] = useState<{ range: MarketRange; entries: Entry[] } | null>(null);
  const entries = answer && answer.range === range ? answer.entries : null;
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);

  useEffect(() => {
    let active = true;
    try {
      const saved = localStorage.getItem("finscope.marketRange");
      if (MARKET_RANGES.includes(saved as MarketRange)) {
        queueMicrotask(() => { if (active) setRange(saved as MarketRange); });
      }
    } catch { /* Storage is optional; the market still opens on the day. */ }
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // Do not overwrite a saved range with the server's hydration-safe 1D
    // default before the restoration effect above has had a chance to run.
    if (firstRangeWrite.current) { firstRangeWrite.current = false; return; }
    try { localStorage.setItem("finscope.marketRange", range); }
    catch { /* A browser refusing storage still gets the selected range. */ }
  }, [range]);

  const load = useCallback(async (window: MarketRange) => {
    try {
      const response = await fetch(`/api/indices?range=${window}`, { cache: "no-store" });
      // A failed status still carries one entry per index, each saying what
      // went wrong with that one, and three named panels with three reasons
      // beat a page that says only that something failed.
      const { data, error: failure } = await readParsed<{ indices?: Entry[] }>(response, { what: "the market session" });
      if (!alive.current) return;
      if (failure && !data?.indices?.length) throw new Error(failure);
      setAnswer({ range: window, entries: data?.indices ?? [] });
      setUpdatedAt(new Date());
      setError("");
    } catch (cause) {
      if (!alive.current) return;
      // A failed refresh must not blank a page that is already showing a
      // window. The last good picture stays up and says it is stale.
      setError(cause instanceof Error ? cause.message : "Market data is unavailable.");
      setAnswer((current) => current ?? { range: window, entries: [] });
    }
  }, []);

  const anyOpen = useMemo(() => (entries ?? []).some((entry) => !failed(entry) && entry.open), [entries]);
  // The loop reads this rather than depending on it, so a market opening
  // changes the next interval instead of tearing down and restarting the loop.
  const anyOpenRef = useRef(anyOpen);
  useEffect(() => { anyOpenRef.current = anyOpen; }, [anyOpen]);

  /**
   * One loop per window: it asks immediately, then waits.
   *
   * Changing the range restarts it, which is what makes a new window arrive at
   * once rather than at the next tick.
   *
   * The first request is made whatever the tab is doing; only the repeats
   * respect visibility. Skipping the first one while hidden meant a page opened
   * in a background tab — or in any browser that reports itself hidden until
   * focused — sat on "Loading the market…" and made no request at all, which is
   * not saving anyone's battery so much as failing quietly. Once the data is
   * there, a reader who is not looking gets no polling: that is where the cost
   * actually is.
   */
  useEffect(() => {
    alive.current = true;
    const tick = async (first = false) => {
      if (!alive.current) return;
      if (first || document.visibilityState === "visible") await load(range);
      if (!alive.current) return;
      const live = range === "1D" && anyOpenRef.current && document.visibilityState === "visible";
      timer.current = setTimeout(() => { void tick(); }, live ? OPEN_MS : CLOSED_MS);
    };
    void tick(true);
    const onVisible = () => { if (document.visibilityState === "visible") void load(range); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [range, load]);

  const dated = entries?.find((entry): entry is Panel => !failed(entry));

  return <div className="market-page">
    <header className="page-heading">
      <div>
        <h1>Market</h1>
        <p>
          The three US indices, measured from {BASELINE_NOTE[range]} — the dashed line.
          {dated && range === "1D" && ` Session of ${sessionLabel(dated.sessionDate)}.`}
        </p>
      </div>
      <div className="market-status">
        <span className={anyOpen ? "market-dot open" : "market-dot"} aria-hidden="true"/>
        <small>
          {entries == null ? "Loading…" : anyOpen ? "Market open" : "Market closed"}
          {updatedAt && ` · updated ${updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
        </small>
      </div>
    </header>

    <div className="market-ranges">
      <div className="segmented" role="group" aria-label="Time range">
        {MARKET_RANGES.map((option) => <button key={option} type="button"
          className={range === option ? "active" : ""} aria-pressed={range === option}
          onClick={() => setRange(option)}>{option}</button>)}
      </div>
    </div>

    {error && <p className="notice">{error}</p>}
    {entries == null && <SkeletonCards label="the market session" count={3} height={230}/>}
    {entries != null && !entries.length && !error && <p className="simple-state">No index data is available right now.</p>}

    <div className="index-grid">
      {(entries ?? []).map((entry) => <IndexPanel key={entry.id} entry={entry} range={range}/>)}
    </div>

    {!indicesOnly ? <>
      {/* Loaded apart from the indices: fifty tiles are a second request and a
          second answer, and the lines above should not wait for them. */}
      <Suspense fallback={<SkeletonCards label="today’s moves" count={2} height={280}/>}><MarketHeatmap watchlist={watchlist}/></Suspense>
      <Suspense fallback={<SkeletonCards label="watchlist performance" count={1} height={260}/>}><PerformanceTable tickers={watchlist}/></Suspense>
    </> : null}

    {entries?.some((entry) => !failed(entry)) &&
      <p className="market-foot">Prices are delayed as the exchange requires.</p>}
  </div>;
}
