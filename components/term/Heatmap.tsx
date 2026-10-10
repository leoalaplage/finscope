"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { groupedTreemap } from "@/lib/treemap";
import { useStoredWatchlist } from "@/components/io/watchlist";

/**
 * The day's moves as a treemap, the terminal's own.
 *
 * The same reading as the document site's heat map (components/MarketHeatmap.tsx)
 * — area is market value, colour the day's move, sectors kept together, the
 * number written on every tile big enough to hold it — drawn in the terminal's
 * green and red on black, at the height of a panel. Two universes: the fifty
 * largest names in the S&P 500, or the reader's own list.
 */

interface Mover { symbol: string; label: string; sector: string; price: number | null; changePercent: number; marketCap: number | null }
interface Answer { index: Mover[]; watchlist: Mover[] }

const HEIGHT = 380;
/** Where the colour saturates, in percent: an ordinary day is inside three. */
const FULL_SCALE = 3;

function fill(change: number) {
  const share = Math.round(Math.min(1, Math.abs(change * 100) / FULL_SCALE) * 70);
  return `color-mix(in srgb, ${change >= 0 ? "var(--gain)" : "var(--loss)"} ${share}%, #101318)`;
}

export function Heatmap() {
  const tickers = useStoredWatchlist();
  const [universe, setUniverse] = useState<"index" | "watchlist">("index");
  const [answer, setAnswer] = useState<{ key: string; data: Answer | null } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const key = tickers.join(",");

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const read = () => fetch(`/api/movers?tickers=${encodeURIComponent(key)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<Answer> : null))
      .then((data) => setAnswer({ key, data }))
      .catch(() => { if (!controller.signal.aborted) setAnswer({ key, data: null }); });
    read();
    const timer = setInterval(read, 60_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [key]);

  const movers = answer?.key === key ? answer.data?.[universe] ?? null : null;
  const placed = useMemo(() => {
    if (!movers || width < 40) return [];
    const sized = movers.filter((mover) => mover.marketCap != null && mover.marketCap > 0);
    const sectors = new Map<string, Mover[]>();
    for (const mover of sized) sectors.set(mover.sector, [...(sectors.get(mover.sector) ?? []), mover]);
    return groupedTreemap(
      [...sectors].map(([sector, items]) => ({ key: sector, items: items.map((item) => ({ weight: item.marketCap!, data: item })) })),
      { x: 0, y: 0, width, height: HEIGHT },
    );
  }, [movers, width]);

  const rising = movers?.filter((mover) => mover.changePercent > 0).length ?? 0;

  return (
    <div className="t-heat">
      <div className="t-heat-bar">
        <div className="seg" role="group" aria-label="Universe">
          <button type="button" aria-pressed={universe === "index"} onClick={() => setUniverse("index")}>S&amp;P 50</button>
          <button type="button" aria-pressed={universe === "watchlist"} onClick={() => setUniverse("watchlist")}>Watchlist</button>
        </div>
        {movers ? <span className="t-dim"><span className="t-up">{rising} up</span> · <span className="t-down">{movers.length - rising} down</span> · area is market value</span> : null}
      </div>
      <div className="t-heat-map" ref={box} style={{ height: HEIGHT }}>
        {answer && !movers ? <p className="t-empty">Quotes unavailable.</p> : null}
        {placed.map((group) => (
          <div key={group.key}>
            {group.rect.width > 60 && group.rect.height > 30 ? (
              <span className="t-heat-sector" style={{ left: group.rect.x, top: group.rect.y }}>{group.key}</span>
            ) : null}
            {group.items.map((tile) => {
              const big = tile.width > 46 && tile.height > 30;
              return (
                <a
                  key={tile.data.symbol}
                  className="t-heat-tile"
                  href={`/t/s/${encodeURIComponent(tile.data.symbol)}`}
                  title={`${tile.data.label} ${(tile.data.changePercent * 100).toFixed(2)}%`}
                  style={{ left: tile.x, top: tile.y, width: tile.width, height: tile.height, background: fill(tile.data.changePercent) }}
                >
                  {big ? (
                    <>
                      <b>{tile.data.label}</b>
                      <span>{tile.data.changePercent >= 0 ? "+" : "−"}{Math.abs(tile.data.changePercent * 100).toFixed(2)}%</span>
                    </>
                  ) : null}
                </a>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
