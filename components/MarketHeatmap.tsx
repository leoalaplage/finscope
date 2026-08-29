"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SkeletonCards } from "./Skeleton";
import { groupedTreemap, type PlacedGroup } from "@/lib/treemap";

/**
 * The day's moves as a treemap, grouped by sector.
 *
 * Two encodings, each answering a different question. Area is market value, so
 * the picture is weighted the way the market is: a two percent fall in the
 * largest company is not the same event as a two percent fall in the fiftieth,
 * and a grid of equal tiles says it is. Colour is the day's move, on a
 * *diverging* scale — two hues meeting at a neutral grey, never a ramp and
 * never a hue at the midpoint.
 *
 * Sectors are contiguous blocks because the question a reader brings to a heat
 * map is which *part* of the market moved, and that only shows when the parts
 * are together. Sorted by size, the same information is scattered.
 *
 * Green against red is the classic colour-vision trap, so the change is written
 * on every tile large enough to hold it and on every tile's tooltip: colour
 * makes the shape of the session readable at a glance, and the number is what
 * anyone reads a value from. Nothing here is encoded by colour alone.
 */

export interface Mover {
  symbol: string;
  label: string;
  sector: string;
  price: number | null;
  changePercent: number;
  /** Price times shares. Null leaves a company out of the map, not at zero. */
  marketCap: number | null;
}

interface MoversPayload {
  index: Mover[];
  watchlist: Mover[];
  requested: { index: number; watchlist: number };
  reviewed: string;
  error?: string;
}

/**
 * Where the colour saturates, in percent.
 *
 * A day's move is almost always inside three percent, so clamping there is what
 * makes the ordinary day legible: scale to the extremes instead and a session
 * where one company fell twelve percent would render the other forty-nine as
 * indistinguishable grey. The tiles that do exceed it are not lost — they are
 * the fully saturated ones, and their number is on them.
 */
const FULL_SCALE = 3;

const intensityOf = (changePercent: number) => Math.min(1, Math.abs(changePercent * 100) / FULL_SCALE);

/** The tile's fill: a share of the direction's hue mixed into a neutral. */
function tileFill(changePercent: number): string {
  const hue = changePercent >= 0 ? "var(--heat-up)" : "var(--heat-down)";
  // Eased so the small moves that make up most of a session still separate
  // from each other rather than all sitting a shade off the midpoint.
  const weight = Math.round(12 + Math.sqrt(intensityOf(changePercent)) * 76);
  return `color-mix(in oklab, ${hue} ${weight}%, var(--heat-zero))`;
}

/**
 * Ink that holds against its own tile.
 *
 * It depends on the direction and not only on the strength, because the two
 * poles are not equally light: in dark mode a strongly rising tile is a bright
 * green wanting dark text, and a strongly falling one is a deep red wanting
 * white. A single threshold would put white on both and lose one of them.
 */
function tileInk(changePercent: number): string {
  if (intensityOf(changePercent) <= 0.45) return "var(--heat-ink)";
  return changePercent >= 0 ? "var(--heat-ink-up)" : "var(--heat-ink-down)";
}

const signedPercent = (value: number) =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(2)}%`;

/** The pixel width of an element, tracked as it changes. */
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

const compactCap = (value: number | null) =>
  value == null ? "—"
    : value >= 1e12 ? `$${(value / 1e12).toFixed(2)}T`
    : value >= 1e9 ? `$${Math.round(value / 1e9)}B`
    : `$${Math.round(value / 1e6)}M`;

/**
 * The map itself.
 *
 * Laid out at the width it is actually displayed at, because a treemap scaled
 * into place would stretch its labels with it — and a ticker is the one thing
 * on a tile that has to stay the size it was set at.
 *
 * The height follows the width rather than being fixed, so the tiles keep a
 * usable shape on a phone as well as a desk. A tile too small for its ticker
 * shows nothing rather than a clipped fragment; the tooltip and the table below
 * still carry every figure.
 */
function Treemap({ movers, aspect, zoomed, onZoom }: {
  movers: Mover[]; aspect: number;
  /** The sector filling the map, or null for all of them. */
  zoomed: string | null;
  onZoom: (sector: string | null) => void;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  // A zoomed sector gets the same width and more height, which is the whole
  // point: the companies that were three pixels wide need room, not a
  // magnifier over the same rectangle.
  const height = Math.max(zoomed ? 380 : 220, Math.round(Math.max(width, 240) / (zoomed ? aspect * 0.55 : aspect)));

  const groups = useMemo<Array<PlacedGroup<Mover>>>(() => {
    const priced = movers.filter((mover) => mover.marketCap != null && mover.marketCap > 0);
    if (!priced.length || width <= 0) return [];
    const bySector = new Map<string, Mover[]>();
    for (const mover of priced) bySector.set(mover.sector, [...(bySector.get(mover.sector) ?? []), mover]);
    return groupedTreemap(
      [...bySector.entries()].map(([key, items]) => ({
        key,
        items: items.map((mover) => ({ weight: mover.marketCap!, data: mover })),
      })),
      { x: 0, y: 0, width, height },
    );
  }, [movers, width, height]);

  return <div className="heat-map" ref={ref} style={{ height }}>
    {groups.map((group) => <div key={group.key} className="heat-sector"
      style={{ left: group.rect.x, top: group.rect.y, width: group.rect.width, height: group.rect.height }}>
      {/* The sector's name sits on its block, not in a legend: a reader
          should never have to match a colour to a list to know what they
          are looking at. */}
      {/* The sector's name sits on its block, not in a legend — and it is the
          way into that sector, because the tiles a reader cannot read are
          always the small ones inside a crowded block. */}
      {group.rect.width > 78 && group.rect.height > 34 && <button type="button" className="heat-sector-name"
        title={zoomed ? `Back to every sector` : `Show only ${group.key}`}
        onClick={() => onZoom(zoomed ? null : group.key)}>{group.key}{zoomed ? " ←" : " ⤢"}</button>}
      {group.items.map((tile) => {
        const mover = tile.data;
        const room = tile.width > 44 && tile.height > 26;
        const roomForValue = tile.width > 54 && tile.height > 40;
        return <div key={mover.symbol} className={`heat-tile ${mover.changePercent >= 0 ? "up" : "down"}`}
          style={{
            left: tile.x - group.rect.x, top: tile.y - group.rect.y, width: tile.width, height: tile.height,
            background: tileFill(mover.changePercent), color: tileInk(mover.changePercent),
          }}
          title={`${mover.label} · ${mover.sector} · ${compactCap(mover.marketCap)}${mover.price == null ? "" : ` · ${mover.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`} · ${signedPercent(mover.changePercent)} today`}>
          {room && <b style={{ fontSize: Math.max(9, Math.min(15, Math.round(tile.width / 5.4))) }}>{mover.label}</b>}
          {roomForValue && <span>{signedPercent(mover.changePercent)}</span>}
        </div>;
      })}
    </div>)}
  </div>;
}

/** The scale itself, stated once rather than guessed at from the tiles. */
function Legend() {
  const stops = [-3, -1.5, 0, 1.5, 3];
  return <div className="heat-legend" aria-hidden="true">
    <small>−{FULL_SCALE}%</small>
    <div className="heat-legend-ramp">
      {stops.map((stop) => <i key={stop} style={{ background: tileFill(stop / 100) }}/>)}
    </div>
    <small>+{FULL_SCALE}%</small>
  </div>;
}

function summarise(movers: Mover[]) {
  if (!movers.length) return null;
  const up = movers.filter((mover) => mover.changePercent > 0).length;
  const down = movers.filter((mover) => mover.changePercent < 0).length;
  const sorted = [...movers].sort((a, b) => b.changePercent - a.changePercent);
  return { up, down, best: sorted[0], worst: sorted.at(-1)! };
}

function Section({ title, note, movers, missing, aspect }: {
  title: string; note: string; movers: Mover[]; missing: number; aspect: number;
}) {
  /*
   * Which sector fills the map, if any.
   *
   * Area is market value, so the smallest companies in the busiest sectors come
   * out a few pixels wide and carry neither their name nor their number — the
   * tiles a reader most wants to read are exactly the ones the encoding makes
   * unreadable. Showing one sector at a time gives those tiles the whole width.
   */
  const [zoom, setZoom] = useState<string | null>(null);
  const shown = useMemo(() => zoom ? movers.filter((mover) => mover.sector === zoom) : movers, [movers, zoom]);
  const stats = summarise(shown);
  const unsized = shown.filter((mover) => mover.marketCap == null).length;
  return <section className="heat-section">
    <div className="heat-head">
      <div>
        <h3>{title}{zoom ? ` · ${zoom}` : ""}</h3>
        <small>
          {zoom ? `${shown.length} companies in ${zoom}` : note}
          {missing > 0 && !zoom ? ` · ${missing} without a quote right now` : ""}
          {unsized > 0 ? ` · ${unsized} without a share count, so not on the map` : ""}
        </small>
      </div>
      {zoom && <button type="button" className="heat-zoom-out" onClick={() => setZoom(null)}>← Every sector</button>}
      {stats && <div className="heat-stats">
        <span className="positive-text">{stats.up} up</span>
        <span className="negative-text">{stats.down} down</span>
        <span>Best {stats.best.label} {signedPercent(stats.best.changePercent)}</span>
        <span>Worst {stats.worst.label} {signedPercent(stats.worst.changePercent)}</span>
      </div>}
    </div>
    {shown.length
      ? <Treemap movers={shown} aspect={aspect} zoomed={zoom} onZoom={setZoom}/>
      : <p className="simple-state">No quotes for this group right now.</p>}
  </section>;
}

/**
 * Both grids, from one request.
 *
 * A table view sits behind a disclosure rather than being absent: a grid of
 * coloured tiles is the fastest way to see the shape of a session and the
 * worst way to read forty numbers in order, and both readers exist.
 */
/**
 * `watchlist` is the reader's own list of tickers, not this codebase's.
 *
 * The endpoint used to read the built-in registry whatever anyone asked, so the
 * lower half of this page — the one labelled "Watchlist" — quietly showed a
 * different set of companies from the watchlist page next to it, and a company
 * the reader added never appeared in it at all.
 */
export function MarketHeatmap({ watchlist = [] }: { watchlist?: string[] }) {
  const [data, setData] = useState<MoversPayload | null>(null);
  const [error, setError] = useState("");

  const followed = watchlist.join(",");
  useEffect(() => {
    let active = true;
    fetch(`/api/movers${followed ? `?tickers=${encodeURIComponent(followed)}` : ""}`)
      .then(async (response) => {
        const payload = await response.json() as MoversPayload;
        if (!active) return;
        if (!response.ok) throw new Error(payload.error || "Quotes are unavailable.");
        setData(payload);
        setError("");
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Quotes are unavailable."); });
    return () => { active = false; };
  }, [followed]);

  const ranked = useMemo(() => data ? [...data.index, ...data.watchlist].sort((a, b) => b.changePercent - a.changePercent) : [], [data]);

  if (error) return <p className="notice">{error}</p>;
  if (!data) return <SkeletonCards label="today’s moves" count={2} height={280}/>;

  return <div className="heatmaps">
    <div className="heat-title">
      <h2>Today&rsquo;s moves</h2>
      <Legend/>
    </div>

    {/* The index block is wider than it is tall because fifty companies at
        very unequal sizes need the room; the watchlist is smaller and squarer. */}
    <Section title="S&P 500 · 50 largest" movers={data.index} aspect={2.4}
      missing={data.requested.index - data.index.length}
      note={`Area is market value · membership reviewed ${data.reviewed}`}/>

    <Section title="Your watchlist" movers={data.watchlist} aspect={3}
      missing={data.requested.watchlist - data.watchlist.length}
      note="Area is market value, from the share count in each company's own filings"/>

    <details className="heat-table">
      <summary>Read it as a table<small>Every tile above, sorted by today&rsquo;s move</small></summary>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Ticker</th><th>Sector</th><th className="numeric">Market cap</th><th className="numeric">Price</th><th className="numeric">Today</th></tr></thead>
          <tbody>
            {ranked.map((mover, index) => <tr key={`${mover.symbol}-${index}`}>
              <th scope="row">{mover.label}</th>
              <td>{mover.sector}</td>
              <td className="numeric">{compactCap(mover.marketCap)}</td>
              <td className="numeric">{mover.price == null ? "—" : mover.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
              <td className={`numeric ${mover.changePercent >= 0 ? "positive-text" : "negative-text"}`}>{signedPercent(mover.changePercent)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </details>
  </div>;
}
