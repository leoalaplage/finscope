"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * The day's moves as a grid of tiles.
 *
 * The colour job here is *diverging*: every tile is a distance from zero with a
 * direction, so the scale is two hues meeting at a neutral grey — never a ramp,
 * never a hue at the midpoint. Green against red is also the classic
 * colour-vision trap, so the change is written on every tile: the colour makes
 * the shape of the day readable at a glance, and the number is what anyone
 * actually reads a value from. Nothing here is encoded by colour alone.
 *
 * Tiles are the same size. A treemap weighted by market value is the familiar
 * form, but the weights that would size it are licensed data this application
 * does not have, and sizing fifty tiles by a number we would have to guess at
 * would be a picture making a claim it cannot support. Order carries the
 * ranking instead, and every tile is equally legible.
 */

export interface Mover {
  symbol: string;
  label: string;
  sector: string;
  price: number | null;
  changePercent: number;
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

function Grid({ movers }: { movers: Mover[] }) {
  return <div className="heat-grid">
    {movers.map((mover) => <div key={mover.symbol} className={`heat-tile ${mover.changePercent >= 0 ? "up" : "down"}`}
      style={{ background: tileFill(mover.changePercent), color: tileInk(mover.changePercent) }}
      title={`${mover.label} · ${mover.sector}${mover.price == null ? "" : ` · ${mover.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`} · ${signedPercent(mover.changePercent)} today`}>
      <b>{mover.label}</b>
      <span>{signedPercent(mover.changePercent)}</span>
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

function Section({ title, note, movers, missing }: { title: string; note: string; movers: Mover[]; missing: number }) {
  const stats = summarise(movers);
  return <section className="heat-section">
    <div className="heat-head">
      <div>
        <h3>{title}</h3>
        <small>{note}{missing > 0 ? ` · ${missing} without a quote right now` : ""}</small>
      </div>
      {stats && <div className="heat-stats">
        <span className="positive-text">{stats.up} up</span>
        <span className="negative-text">{stats.down} down</span>
        <span>Best {stats.best.label} {signedPercent(stats.best.changePercent)}</span>
        <span>Worst {stats.worst.label} {signedPercent(stats.worst.changePercent)}</span>
      </div>}
    </div>
    {movers.length
      ? <Grid movers={movers}/>
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
export function MarketHeatmap() {
  const [data, setData] = useState<MoversPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/movers")
      .then(async (response) => {
        const payload = await response.json() as MoversPayload;
        if (!active) return;
        if (!response.ok) throw new Error(payload.error || "Quotes are unavailable.");
        setData(payload);
        setError("");
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Quotes are unavailable."); });
    return () => { active = false; };
  }, []);

  const ranked = useMemo(() => data ? [...data.index, ...data.watchlist].sort((a, b) => b.changePercent - a.changePercent) : [], [data]);

  if (error) return <p className="notice">{error}</p>;
  if (!data) return <p className="simple-state">Loading today&rsquo;s moves…</p>;

  return <div className="heatmaps">
    <div className="heat-title">
      <h2>Today&rsquo;s moves</h2>
      <Legend/>
    </div>

    <Section title="S&P 500 · 50 largest" movers={data.index}
      missing={data.requested.index - data.index.length}
      note={`In index order as reviewed on ${data.reviewed}`}/>

    <Section title="Your watchlist" movers={data.watchlist}
      missing={data.requested.watchlist - data.watchlist.length}
      note="Every company you follow with a market listing"/>

    <details className="heat-table">
      <summary>Read it as a table<small>Every tile above, sorted by today&rsquo;s move</small></summary>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Ticker</th><th>Sector</th><th className="numeric">Price</th><th className="numeric">Today</th></tr></thead>
          <tbody>
            {ranked.map((mover, index) => <tr key={`${mover.symbol}-${index}`}>
              <th scope="row">{mover.label}</th>
              <td>{mover.sector}</td>
              <td className="numeric">{mover.price == null ? "—" : mover.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
              <td className={`numeric ${mover.changePercent >= 0 ? "positive-text" : "negative-text"}`}>{signedPercent(mover.changePercent)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </details>
  </div>;
}
