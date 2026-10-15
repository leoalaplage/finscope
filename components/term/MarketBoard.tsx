"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CandleChart, useCandles } from "@/components/io/CandleChart";
import type { Candles } from "@/lib/adapters/candles";
import { CHART_RANGES, candlesInRange, type ChartRange } from "@/lib/io/chart-ranges";
import { MarketPerformance } from "@/components/io/MarketPerformance";
import { shortDate } from "@/components/io/format";
import { INTERVAL_TITLES } from "@/lib/io/candle-chart";
import type { Study } from "@/lib/io/technicals";
import { AreaPrice } from "./AreaPrice";
import type { MarketWindow } from "@/lib/adapters/intraday";
import type { TreasuryCurve } from "@/lib/macro";
import { areaFromCandles, areaFromWindow } from "@/lib/term/area-price";
import { nextRank, ranked, type Rank } from "@/lib/term/rank";
import { Heatmap } from "./Heatmap";
import { Panel } from "./Panel";
import { WatchlistCharts } from "./WatchlistCharts";
import { Rotation } from "./Rotation";
import { Seasonality } from "./Seasonality";
import { EconBrief } from "./Economy";

/**
 * The terminal's market screen: the world's indices and the VIX, a live chart
 * of whichever one is chosen, what is happening underneath the S&P 500 —
 * breadth, sectors over four horizons, the day's movers and its unusual
 * volume — then currencies, commodities and the yield curve, the reader's
 * own list, and the heat map.
 *
 * Every panel asks its own endpoint, all at once, so the screen fills in a
 * single round trip and no panel waits for another. Each endpoint is cached at
 * the edge (indices thirty seconds, the rest five minutes) and the screen asks
 * again every minute.
 */

interface IndexAnswer {
  indices?: Array<({ id: string; error?: undefined } & MarketWindow) | { id: string; name: string; error: string }>;
}
interface MarketRow {
  id: string; label: string; group: "world" | "commodities" | "rates" | "currencies"; last: number | null; currency: string | null;
  places: number; changePercent: number | null; changeBasisPoints: number | null; note: string; spark: number[];
}
interface Mover { ticker: string; name: string; sector: string; changePercent: number }
interface Internals {
  breadth?: { up: number; down: number; flat: number; median: number };
  sectors?: Array<{ sector: string; companies: number; median: number; up: number; down: number }>;
  risers?: Mover[];
  fallers?: Mover[];
  priced?: number;
}
interface Extras {
  asOf: string | null;
  breadth: { counted: number; aboveSma50: number; aboveSma200: number; highs52: number; lows52: number; overbought: number; oversold: number; goldenCrosses: string[]; deathCrosses: string[] };
  sectors: Array<{ sector: string; companies: number; d5: number | null; d20: number | null; d60: number | null }>;
  volume: Array<{ ticker: string; name: string; ratio: number; change: number | null; close: number | null }>;
  vix: { last: number | null; change: number | null; changePercent: number | null; spark: number[] } | null;
}

/** Yahoo's symbol for each index on the board, so a row opens its chart. */
const CHART_SYMBOL: Record<string, string> = {
  SPX: "^GSPC", NASDAQ: "^IXIC", DOW: "^DJI", VIX: "^VIX",
  SX5E: "^STOXX50E", DAX: "^GDAXI", CAC: "^FCHI", FTSE: "^FTSE", N225: "^N225", HSI: "^HSI",
};
const REGION: Record<string, string> = { SPX: "US", NASDAQ: "US", DOW: "US", VIX: "US", SX5E: "EU", DAX: "DE", CAC: "FR", FTSE: "UK", N225: "JP", HSI: "HK" };

const REFRESH_MS = 60_000;
const CHART_STUDIES: ReadonlySet<Study> = new Set<Study>(["ema", "volume"]);

/** One endpoint, asked now and every minute; the last good answer stays up through a failure. */
function usePolled<T>(url: string): T | null {
  const [answer, setAnswer] = useState<T | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const read = () => fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<T> : null))
      .then((body) => { if (body) setAnswer(body); })
      .catch(() => { /* Kept as it was. */ });
    void read();
    const timer = setInterval(read, REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [url]);
  return answer;
}

const signed = (value: number | null | undefined, places = 2, suffix = "%") =>
  value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(places)}${suffix}`;
const tone = (value: number | null | undefined) => (value == null ? undefined : value < 0 ? "down" : value > 0 ? "up" : undefined);
const level = (value: number | null | undefined, places = 2) =>
  value == null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });

/** A line of closes in a cell, green or red by where it ended against where it began. */
export function Spark({ values, baseline = null }: { values: number[]; baseline?: number | null }) {
  if (values.length < 2) return null;
  const low = Math.min(...values, baseline ?? Infinity);
  const high = Math.max(...values, baseline ?? -Infinity);
  const y = (value: number) => 20 - ((value - low) / (high - low || 1)) * 18 - 1;
  const x = (index: number) => (index / (values.length - 1)) * 80;
  const path = values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join("");
  const up = values[values.length - 1] >= (baseline ?? values[0]);
  return (
    <svg className="t-spark" viewBox="0 0 80 20" preserveAspectRatio="none" aria-hidden="true">
      {baseline != null ? <line x1={0} x2={80} y1={y(baseline)} y2={y(baseline)} className="t-spark-base" vectorEffect="non-scaling-stroke" /> : null}
      <path d={path} className={up ? "t-spark-up" : "t-spark-down"} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A cell's background, green or red in proportion to the move, saturating at `full` percent. */
const heat = (value: number | null, full: number) => {
  if (value == null) return undefined;
  const share = Math.round(Math.min(1, Math.abs(value) / full) * 45);
  return { background: `color-mix(in srgb, ${value >= 0 ? "var(--gain)" : "var(--loss)"} ${share}%, transparent)` };
};

function Bar({ label, value, of, tone: colour }: { label: string; value: number; of: number; tone?: "up" | "down" }) {
  const share = of ? value / of : 0;
  return (
    <div className="t-bar-row">
      <span className="t-dim">{label}</span>
      <span className="t-bar-meter"><i data-tone={colour} style={{ width: `${(share * 100).toFixed(1)}%` }} /></span>
      <b>{(share * 100).toFixed(0)}%</b>
      <span className="t-dim">{value}/{of}</span>
    </div>
  );
}

function MoverList({ title, rows }: { title: string; rows: Array<{ ticker: string; value: string; tone?: string; note?: string }> }) {
  return (
    <div className="t-movers-col">
      <h3>{title}</h3>
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ticker}>
              <td className="key"><a href={`/t/s/${encodeURIComponent(row.ticker)}`}>{row.ticker}</a></td>
              <td className="t-dim">{row.note ?? ""}</td>
              <td data-dir={row.tone}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The session's first open from the chart's own candles, only when they are of the same session as the snapshot. */
function sessionOpen(candles: Candles | null, sessionDate: string): number | null {
  if (!candles) return null;
  const today = areaFromCandles(candles, "1D");
  const first = today.t[0];
  return first != null && new Date(first * 1000).toISOString().slice(0, 10) === sessionDate ? today.open : null;
}

/* How GP draws the index: candles, or an area relative to the period's reference. */
type MarketStyle = "candles" | "area";
const MARKET_STYLE_KEY = "finscope.term.market.style";
const MARKET_STYLE_EVENT = "finscope:market-style";
const subscribeMarketStyle = (notify: () => void) => {
  window.addEventListener("storage", notify); window.addEventListener(MARKET_STYLE_EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(MARKET_STYLE_EVENT, notify); };
};
const readMarketStyle = (): MarketStyle => {
  try { return localStorage.getItem(MARKET_STYLE_KEY) === "area" ? "area" : "candles"; } catch { return "candles"; }
};
const writeMarketStyle = (style: MarketStyle) => {
  try { localStorage.setItem(MARKET_STYLE_KEY, style); } catch { /* this visit only */ }
  window.dispatchEvent(new Event(MARKET_STYLE_EVENT));
};

/**
 * The US Treasury curve today against a month ago, every maturity from one
 * month to thirty years, from the Treasury's own feed (app/api/yield-curve):
 * a day's move barely shows, a month's is a shape — steepening, flattening,
 * the short end falling ahead of a cut. The change in basis points under each
 * maturity.
 */
function YieldCurve() {
  const [answer, setAnswer] = useState<{ now: TreasuryCurve; monthAgo: TreasuryCurve | null } | null | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/yield-curve", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ now: TreasuryCurve; monthAgo: TreasuryCurve | null } | null> : null))
      .then((body) => { if (!controller.signal.aborted) setAnswer(body); })
      .catch(() => { if (!controller.signal.aborted) setAnswer(null); });
    return () => controller.abort();
  }, []);
  if (answer === undefined) return <p className="t-empty">Reading the Treasury curve…</p>;
  if (!answer || answer.now.points.length < 2) return <p className="t-empty">The Treasury curve is temporarily unavailable.</p>;
  const before = new Map((answer.monthAgo?.points ?? []).map((point) => [point.label, point.value]));
  const points = answer.now.points.map((point) => ({ ...point, before: before.get(point.label) ?? null }));
  const values = points.flatMap((point) => [point.value, point.before ?? point.value]);
  const low = Math.min(...values) - 0.1;
  const high = Math.max(...values) + 0.1;
  const W = 400;
  const H = 168;
  // Maturity on a square-root scale, the usual compromise between months and decades.
  const x = (years: number) => 22 + (Math.sqrt(years) / Math.sqrt(30)) * (W - 40);
  const y = (value: number) => 18 + (1 - (value - low) / (high - low)) * (H - 52);
  const line = (pick: (point: (typeof points)[number]) => number | null) =>
    points.filter((point) => pick(point) != null).map((point, index) => `${index ? "L" : "M"}${x(point.years).toFixed(1)} ${y(pick(point)!).toFixed(1)}`).join("");
  // Labels where they do not collide: the short end is crowded on a square-root scale.
  const labelled = new Set(["1M", "6M", "2Y", "5Y", "10Y", "30Y"]);
  return (
    <div className="t-curve-wrap">
      <svg className="t-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`US Treasury yield curve on ${answer.now.date}${answer.monthAgo ? ` and on ${answer.monthAgo.date}` : ""}`}>
        {answer.monthAgo ? <path d={line((point) => point.before)} className="t-curve-before" /> : null}
        <path d={line((point) => point.value)} className="t-curve-now" />
        {points.map((point) => {
          const change = point.before == null ? null : Math.round((point.value - point.before) * 100);
          return (
            <g key={point.label}>
              <title>{`${point.label}: ${point.value.toFixed(2)}%${change == null ? "" : ` · ${change >= 0 ? "+" : "−"}${Math.abs(change)} bp on a month`}`}</title>
              <circle cx={x(point.years)} cy={y(point.value)} r={2.6} className="t-curve-dot" />
              {labelled.has(point.label) ? (
                <>
                  <text x={x(point.years)} y={y(point.value) - 7} textAnchor="middle" className="t-curve-value">{point.value.toFixed(2)}</text>
                  <text x={x(point.years)} y={H - 18} textAnchor="middle" className="t-curve-axis">{point.label}</text>
                  {change != null ? <text x={x(point.years)} y={H - 5} textAnchor="middle" className="t-curve-change" data-dir={change > 0 ? "up" : change < 0 ? "down" : undefined}>{`${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)}`}</text> : null}
                </>
              ) : null}
            </g>
          );
        })}
      </svg>
      <p className="t-curve-legend">
        <span className="t-curve-key-now" />{answer.now.date}
        {answer.monthAgo ? <><span className="t-curve-key-before" />{answer.monthAgo.date}</> : null}
        <span className="t-dim"> · change in basis points under each maturity · U.S. Treasury par curve</span>
      </p>
    </div>
  );
}

/** The sector table's ranked columns: the median move over each window. */
const SECTOR_COLUMNS = [["d1", "1D"], ["d5", "5D"], ["d20", "1M"], ["d60", "3M"]] as const;
type SectorColumn = (typeof SECTOR_COLUMNS)[number][0];

/** A move of a row as the tables rank it: basis points for a yield, percent for the rest. */
const moveOf = (row: MarketRow) => (row.group === "rates" ? row.changeBasisPoints : row.changePercent);

/** The panel's ranking button: as listed, best first, worst first. */
function RankChip({ rank, onRank, column = "move", names = { move: "Chg" } }: { rank: Rank | null; onRank: (rank: Rank | null) => void; column?: string; names?: Record<string, string> }) {
  const on = rank?.key === column ? rank.direction : null;
  return (
    <button type="button" className="t-chip" aria-pressed={rank != null}
      title={on === "desc" ? "Best first · click for worst first" : on === "asc" ? "Worst first · click for the listed order" : "Rank by performance, best first"}
      onClick={() => onRank(nextRank(rank, rank?.key ?? column))}>
      {rank ? `${names[rank.key] ?? rank.key} ${rank.direction === "desc" ? "▼" : "▲"}` : "Rank"}
    </button>
  );
}

function QuoteTable({ rows, label, rank }: { rows: MarketRow[]; label: string; rank: Rank | null }) {
  return (
    <div className="sheet t-quotes">
      <table aria-label={label}>
        <tbody>
          {ranked(rows, rank, moveOf).map((row) => {
            const rate = row.group === "rates";
            const move = moveOf(row);
            return (
              <tr key={row.id}>
                <td className="key">{row.label}{row.note && !rate ? <span className="t-dim"> · {row.note}</span> : null}</td>
                <td>{rate ? `${level(row.last, 3)}%` : level(row.last, row.places)}</td>
                <td data-dir={tone(move)}>{rate ? signed(move, 1, " bp") : signed(move)}</td>
                <td className="t-spark-cell"><Spark values={row.spark} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MarketBoard() {
  const indices = usePolled<IndexAnswer>("/api/indices");
  const markets = usePolled<{ rows: MarketRow[] }>("/api/markets");
  const internals = usePolled<Internals>("/api/internals");
  const extras = usePolled<Extras>("/api/market-extras");
  const futures = usePolled<{ rows: Array<{ id: string; label: string; group: string; last: number | null; changePercent: number | null; spark: number[] }> }>("/api/futures");
  const [chart, setChart] = useState<{ id: string; range: ChartRange }>({ id: "SPX", range: "1D" });
  const period = CHART_RANGES.find((entry) => entry.id === chart.range)!;
  // Futures and coins are charted under their own names; the indices under Yahoo's.
  const candles = useCandles(CHART_SYMBOL[chart.id] ?? (/=F$|-USD$/.test(chart.id) ? chart.id : "^GSPC"), period.interval, true, REFRESH_MS);
  const openOn = candles.candles ? candlesInRange(candles.candles.t, chart.range) : undefined;
  const style = useSyncExternalStore(subscribeMarketStyle, readMarketStyle, () => "candles" as MarketStyle);
  const snapshot = indices?.indices?.find((index) => index.id === chart.id);
  const area = useMemo(() => chart.range === "1D" && snapshot && "points" in snapshot
    ? areaFromWindow(snapshot, sessionOpen(candles.candles, snapshot.sessionDate))
    : candles.candles ? areaFromCandles(candles.candles, chart.range) : null, [snapshot, candles.candles, chart.range]);
  /* Each table's ranking: as listed until asked. */
  const [ranks, setRanks] = useState<Record<string, Rank | null>>({});
  const rankOf = (panel: string) => ranks[panel] ?? null;
  const setRank = (panel: string) => (rank: Rank | null) => setRanks((current) => ({ ...current, [panel]: rank }));

  const rows = useMemo(() => markets?.rows ?? [], [markets]);
  const group = (name: MarketRow["group"]) => rows.filter((row) => row.group === name);
  const board = useMemo(() => {
    const us = (indices?.indices ?? []).filter((index): index is MarketWindow & { id: string } => index.error === undefined).map((index) => ({
      id: index.id, name: index.name, last: index.last ?? null, change: index.changePercent != null ? index.changePercent * 100 : null,
      spark: areaFromWindow(index).c, baseline: index.baseline ?? null,
    }));
    const vix = extras?.vix ? [{ id: "VIX", name: "VIX", last: extras.vix.last, change: extras.vix.changePercent, spark: extras.vix.spark, baseline: null }] : [];
    const world = rows.filter((row) => row.group === "world").map((row) => ({
      id: row.id, name: row.label, last: row.last, change: row.changePercent, spark: row.spark, baseline: null,
    }));
    const traded = (futures?.rows ?? []).filter((row) => row.last != null).map((row) => ({
      id: row.id, name: row.label, last: row.last, change: row.changePercent, spark: row.spark, baseline: null,
    }));
    // The selected non-US instrument uses GP's freshly polled 1D snapshot,
    // so the quote and percentage cannot come from an older daily endpoint.
    return [...us, ...vix, ...world, ...traded].map((row) => {
      if (chart.range !== "1D" || row.id !== chart.id || snapshot || !area?.c.length) return row;
      const last = area.c[area.c.length - 1];
      return { ...row, last, baseline: area.baseline, spark: area.c,
        change: area.baseline != null && area.baseline > 0 ? (last - area.baseline) / area.baseline * 100 : null };
    });
  }, [indices, extras, rows, futures, chart.range, chart.id, snapshot, area]);

  const sectors = useMemo(() => {
    const today = new Map((internals?.sectors ?? []).map((sector) => [sector.sector, sector]));
    return (extras?.sectors ?? []).map((run) => ({ ...run, d1: today.get(run.sector)?.median ?? null, up: today.get(run.sector)?.up ?? 0, down: today.get(run.sector)?.down ?? 0 }));
  }, [internals, extras]);

  const breadth = internals?.breadth;
  const deep = extras?.breadth;
  const chartName = board.find((row) => row.id === chart.id)?.name ?? chart.id;

  return (
    <div className="t-grid t-market">
      {/*
        * Columns, not rows: a row of panels is as tall as its tallest, and the
        * short ones left holes under them. Each column stacks its panels with
        * no gap, its last panel stretches to the bottom of the band, and the
        * chart and the sector table grow to whatever height the band has.
        */}
      <div className="t-mcol" style={{ gridArea: "c1" }}>
        <Panel code="WEI" title="World indices" actions={<RankChip rank={rankOf("wei")} onRank={setRank("wei")} />}>
          <div className="sheet t-wei">
            <table>
              <thead><tr><th className="key">Index</th><th>Last</th><th aria-sort={rankOf("wei") ? (rankOf("wei")!.direction === "desc" ? "descending" : "ascending") : "none"}><button type="button" className="t-sort" onClick={() => setRank("wei")(nextRank(rankOf("wei"), "move"))}>Chg %{rankOf("wei") ? (rankOf("wei")!.direction === "desc" ? " ▼" : " ▲") : ""}</button></th><th title="US averages and the selected 1D instrument: latest session. Other rows: the last month of closes.">Trend</th></tr></thead>
              <tbody>
                {ranked(board, rankOf("wei"), (row) => row.change).map((row) => (
                  <tr key={row.id} data-selected={row.id === chart.id || undefined}>
                    <td className="key">
                      <button type="button" className="t-wei-pick" onClick={() => setChart({ ...chart, id: row.id })}>
                        <span className="t-wei-region">{REGION[row.id] ?? (row.id.endsWith("=F") ? "FUT" : row.id.endsWith("-USD") ? "CRY" : "")}</span>{row.name}
                      </button>
                    </td>
                    <td>{level(row.last)}</td>
                    <td data-dir={tone(row.change)}>{signed(row.change)}</td>
                    <td className="t-spark-cell"><Spark values={row.spark} baseline={row.baseline} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!board.length ? <p className="t-empty">Loading…</p> : null}
        </Panel>
        <Panel code="BRDTH" title="S&P 500 breadth" actions={extras?.asOf ? <span>Close {shortDate(extras.asOf)}</span> : null}>
          <div className="t-panel-pad t-breadth">
            {breadth ? (
              <div className="t-ad">
                <div className="t-ad-bar">
                  <i data-tone="up" style={{ flex: breadth.up }} />
                  <i style={{ flex: breadth.flat }} />
                  <i data-tone="down" style={{ flex: breadth.down }} />
                </div>
                <div className="t-ad-legend">
                  <span className="t-up">{breadth.up} up</span>
                  <span className="t-dim">median {signed(breadth.median)}</span>
                  <span className="t-down">{breadth.down} down</span>
                </div>
              </div>
            ) : null}
            {deep && deep.counted ? (
              <>
                <Bar label="Above 50-day" value={deep.aboveSma50} of={deep.counted} tone="up" />
                <Bar label="Above 200-day" value={deep.aboveSma200} of={deep.counted} tone="up" />
                <div className="t-breadth-pairs">
                  <span>52W highs <b className="t-up">{deep.highs52}</b></span>
                  <span>52W lows <b className="t-down">{deep.lows52}</b></span>
                  <span>RSI &gt; 70 <b>{deep.overbought}</b></span>
                  <span>RSI &lt; 30 <b>{deep.oversold}</b></span>
                </div>
                {deep.goldenCrosses.length || deep.deathCrosses.length ? (
                  <p className="t-breadth-crosses">
                    {deep.goldenCrosses.length ? <span>Golden cross: {deep.goldenCrosses.map((ticker) => <a key={ticker} href={`/t/chart?s=${ticker}`}>{ticker}</a>)}</span> : null}
                    {deep.deathCrosses.length ? <span>Death cross: {deep.deathCrosses.map((ticker) => <a key={ticker} href={`/t/chart?s=${ticker}`}>{ticker}</a>)}</span> : null}
                  </p>
                ) : null}
              </>
            ) : <p className="t-dim">Reading the index…</p>}
          </div>
        </Panel>
      </div>

      <Panel code="GP" title={`${chartName} · ${chart.range} · ${INTERVAL_TITLES[period.interval]}`} area="gp" className="t-fill" actions={
        <>
          <div className="seg" role="group" aria-label="Chart style">
            <button type="button" aria-pressed={style === "candles"} onClick={() => writeMarketStyle("candles")}>Candles</button>
            <button type="button" aria-pressed={style === "area"} onClick={() => writeMarketStyle("area")}>Area</button>
          </div>
          <div className="seg" role="group" aria-label="Period">
            {CHART_RANGES.map((entry) => (
              <button key={entry.id} type="button" aria-pressed={chart.range === entry.id} title={entry.title} onClick={() => setChart({ ...chart, range: entry.id })}>{entry.id}</button>
            ))}
          </div>
        </>
      }>
        <div className="t-market-chart">
          {style === "area" ? (
            area ? (
              <AreaPrice key={`${chart.id}:${chart.range}`} series={area} interval={period.interval} label={`${chartName}, ${period.title.toLowerCase()}`} />
            ) : <p className="t-empty">{candles.error ?? "Reading prices…"}</p>
          ) : (
            <CandleChart
              candles={candles.candles} interval={period.interval} loading={candles.loading} error={candles.error} openOn={openOn || undefined}
              studies={CHART_STUDIES} zoomable ohlc={false} label={`${chartName}, ${period.title.toLowerCase()}`}
            />
          )}
        </div>
      </Panel>

      <div className="t-mcol" style={{ gridArea: "c2" }}>
        <Panel code="FX" title="Currencies" actions={<RankChip rank={rankOf("fx")} onRank={setRank("fx")} />}>
          <QuoteTable rows={group("currencies")} label="Currencies" rank={rankOf("fx")} />
        </Panel>
        <Panel code="CMDTY" title="Commodities" actions={<RankChip rank={rankOf("cmdty")} onRank={setRank("cmdty")} />}>
          <QuoteTable rows={group("commodities")} label="Commodities" rank={rankOf("cmdty")} />
        </Panel>
        <Panel code="GC" title="US yield curve · today vs 1 month ago">
          <YieldCurve />
        </Panel>
      </div>

      <Panel code="SECT" title="Sectors · median performance" area="sect" className="t-fill" actions={<RankChip rank={rankOf("sect")} onRank={setRank("sect")} column="d1" names={Object.fromEntries(SECTOR_COLUMNS)} />}>
        <div className="sheet t-sectors">
          <table>
            <thead>
              <tr>
                <th className="key">Sector</th><th>N</th>
                {SECTOR_COLUMNS.map(([key, name]) => {
                  const rank = rankOf("sect");
                  const on = rank?.key === key ? rank.direction : null;
                  return (
                    <th key={key} aria-sort={on === "desc" ? "descending" : on === "asc" ? "ascending" : "none"}>
                      <button type="button" className="t-sort" onClick={() => setRank("sect")(nextRank(rank, key))}>{name}{on ? (on === "desc" ? " ▼" : " ▲") : ""}</button>
                    </th>
                  );
                })}
                <th>A / D</th>
              </tr>
            </thead>
            <tbody>
              {ranked(sectors, rankOf("sect"), (row, key) => row[key as SectorColumn]).map((row) => (
                <tr key={row.sector}>
                  <td className="key">{row.sector}</td>
                  <td className="t-dim">{row.companies}</td>
                  <td style={heat(row.d1, 3)}>{signed(row.d1)}</td>
                  <td style={heat(row.d5, 6)}>{signed(row.d5, 1)}</td>
                  <td style={heat(row.d20, 10)}>{signed(row.d20, 1)}</td>
                  <td style={heat(row.d60, 20)}>{signed(row.d60, 1)}</td>
                  <td className="t-dim">{row.up}/{row.down}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="t-mcol" style={{ gridArea: "c3" }}>
        <Panel code="MOST" title="Movers · S&P 500">
          <div className="t-movers">
            <MoverList title="Gainers" rows={(internals?.risers ?? []).slice(0, 8).map((row) => ({ ticker: row.ticker, value: signed(row.changePercent), tone: "up" }))} />
            <MoverList title="Losers" rows={(internals?.fallers ?? []).slice(0, 8).map((row) => ({ ticker: row.ticker, value: signed(row.changePercent), tone: "down" }))} />
            <MoverList title="Volume vs 20D" rows={(extras?.volume ?? []).slice(0, 8).map((row) => ({ ticker: row.ticker, value: `${row.ratio.toFixed(1)}×`, note: signed(row.change, 1), tone: undefined }))} />
          </div>
        </Panel>
        <Panel code="YLD" title="Government yields" actions={<RankChip rank={rankOf("yld")} onRank={setRank("yld")} />}>
          <QuoteTable rows={group("rates")} label="Government yields" rank={rankOf("yld")} />
        </Panel>
      </div>

      <Panel code="ECO" title="US economic releases vs. consensus" area="eco"><EconBrief /></Panel>
      <Panel code="RRG" title="Sector rotation · relative rotation graph" area="rrg"><Rotation /></Panel>
      <Panel code="SEAS" title="S&P 500 seasonality" area="seas" className="t-fill"><Seasonality symbol="^GSPC" /></Panel>

      <Panel code="IMAP" title="S&P 500 map · sized by market value" area="imap"><Heatmap height={640} /></Panel>
      <Panel code="W" area="perf"><MarketPerformance /></Panel>
      <WatchlistCharts area="wch" />
    </div>
  );
}
