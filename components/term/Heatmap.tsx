"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { layoutMap, moveColor, SECTOR_HEADER, INDUSTRY_HEADER } from "@/lib/term/heatmap-layout";

/**
 * The S&P 500 as a market map, read the way finviz taught everyone to read one.
 *
 * Every member is a tile sized by market value, inside its industry, inside
 * its sector; the colour is its move over the chosen period, red through grey
 * to green. A sector's name runs across its top, and a click on it opens the
 * sector on its own. Hovering a tile shows the company and its industry beside
 * it, ranked by size. The layout is lib/term/heatmap-layout.ts; the figures
 * come from /api/heatmap.
 */

const WINDOWS = [
  { key: "d1", label: "1D", full: 3 },
  { key: "w1", label: "1W", full: 6 },
  { key: "m1", label: "1M", full: 10 },
  { key: "m3", label: "3M", full: 15 },
  { key: "y1", label: "1Y", full: 30 },
  { key: "ytd", label: "YTD", full: 30 },
] as const;
type WindowKey = (typeof WINDOWS)[number]["key"];

interface Company {
  ticker: string; name: string; sector: string; industry: string; cap: number; price: number | null;
  moves: Record<WindowKey, number | null>;
}

interface Answer { columns: string[]; rows: unknown[][]; asOf?: string }

const REFRESH_MS = 60_000;

function useMapData() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const read = () => fetch("/api/heatmap", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<Answer> : null))
      .then((body) => {
        if (!body?.rows?.length) { setFailed(true); return; }
        const at = (name: string) => body.columns.indexOf(name);
        setCompanies(body.rows.map((row) => ({
          ticker: row[at("ticker")] as string, name: row[at("name")] as string,
          sector: row[at("sector")] as string, industry: row[at("industry")] as string,
          cap: row[at("cap")] as number, price: row[at("price")] as number | null,
          moves: Object.fromEntries(WINDOWS.map((period) => [period.key, row[at(period.key)] as number | null])) as Record<WindowKey, number | null>,
        })));
        setFailed(false);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    void read();
    const timer = setInterval(read, REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  return { companies, failed };
}

const signed = (value: number | null) => (value == null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`);
const price = (value: number | null) => (value == null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function Heatmap({ height = 600, compact = false }: { height?: number; compact?: boolean }) {
  const { companies, failed } = useMapData();
  const watchlist = useStoredWatchlist();
  const [universe, setUniverse] = useState<"sp500" | "watchlist">("sp500");
  const [period, setPeriod] = useState<WindowKey>("d1");
  const [sector, setSector] = useState<string | null>(null);
  const [hover, setHover] = useState<{ ticker: string; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const full = WINDOWS.find((item) => item.key === period)!.full;
  const shown = useMemo(() => {
    if (!companies) return [];
    const listed = universe === "watchlist" ? companies.filter((company) => watchlist.includes(company.ticker)) : companies;
    return sector ? listed.filter((company) => company.sector === sector) : listed;
  }, [companies, universe, watchlist, sector]);
  const map = useMemo(
    () => (width > 40 ? layoutMap(shown, { x: 0, y: 0, width, height }, { industries: !compact || sector != null }) : []),
    [shown, width, height, compact, sector],
  );

  const hovered = hover ? shown.find((company) => company.ticker === hover.ticker) ?? null : null;
  const peers = hovered
    ? shown.filter((company) => company.industry === hovered.industry && company.sector === hovered.sector).sort((a, b) => b.cap - a.cap).slice(0, 12)
    : [];
  const rising = shown.filter((company) => (company.moves[period] ?? 0) > 0).length;
  const missing = universe === "watchlist" && companies ? watchlist.filter((ticker) => !companies.some((company) => company.ticker === ticker)).length : 0;

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>("[data-ticker]");
    const frame = box.current?.getBoundingClientRect();
    if (!tile || !frame) { setHover(null); return; }
    setHover({ ticker: tile.dataset.ticker!, x: event.clientX - frame.left, y: event.clientY - frame.top });
  };

  return (
    <div className="t-heat" data-compact={compact || undefined}>
      <div className="t-heat-bar">
        <div className="seg" role="group" aria-label="Universe">
          <button type="button" aria-pressed={universe === "sp500"} onClick={() => setUniverse("sp500")}>S&amp;P 500</button>
          <button type="button" aria-pressed={universe === "watchlist"} onClick={() => setUniverse("watchlist")}>Watchlist</button>
        </div>
        <div className="seg" role="group" aria-label="Period">
          {WINDOWS.map((item) => (
            <button key={item.key} type="button" aria-pressed={period === item.key} onClick={() => setPeriod(item.key)}>{item.label}</button>
          ))}
        </div>
        {sector ? (
          <button type="button" className="t-text-button" onClick={() => setSector(null)}>‹ {universe === "sp500" ? "S&P 500" : "Watchlist"} / {sector}</button>
        ) : null}
        {shown.length ? (
          <span className="t-dim t-heat-count">
            <span className="t-up">{rising} up</span> · <span className="t-down">{shown.length - rising} down</span>
            {missing ? ` · ${missing} outside the index not shown` : ""}
          </span>
        ) : null}
      </div>

      <div
        className="t-heat-map" ref={box} style={{ height }}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}
      >
        {!companies && !failed ? <p className="t-empty">Loading the index…</p> : null}
        {failed && !companies ? <p className="t-empty">The map is temporarily unavailable.</p> : null}
        {map.map((block) => (
          <div key={block.name} className="t-heat-sector" style={{ left: block.x, top: block.y, width: block.width, height: block.height }}>
            {block.header ? (
              <button
                type="button" className="t-heat-sector-name" style={{ height: SECTOR_HEADER }}
                onClick={() => setSector(sector ? null : block.name)} title={sector ? "Back to the whole map" : `Open ${block.name} on its own`}
              >
                {block.name}
              </button>
            ) : null}
            {block.industries.map((industry) => (
              <div key={industry.name}>
                {industry.header ? (
                  <span
                    className="t-heat-industry"
                    style={{ left: industry.x - block.x, top: industry.y - block.y, width: industry.width, height: INDUSTRY_HEADER }}
                  >
                    {industry.name}
                  </span>
                ) : null}
                {industry.tiles.map((tile) => {
                  const change = tile.item.moves[period];
                  const size = Math.min(tile.width / (tile.item.ticker.length * 0.62 + 0.8), tile.height * 0.4, compact ? 20 : 30);
                  const label = size >= 7;
                  const detail = label && tile.height > size * 2.3 && size * 0.62 >= 7;
                  return (
                    <a
                      key={tile.item.ticker}
                      href={`/t/s/${encodeURIComponent(tile.item.ticker)}`}
                      className="t-heat-tile"
                      data-ticker={tile.item.ticker}
                      data-hover={hover?.ticker === tile.item.ticker || undefined}
                      aria-label={`${tile.item.ticker} ${signed(change)}`}
                      style={{
                        left: tile.x - block.x, top: tile.y - block.y, width: tile.width, height: tile.height,
                        background: moveColor(change, full),
                      }}
                    >
                      {label ? <b style={{ fontSize: size }}>{tile.item.ticker}</b> : null}
                      {detail ? <span style={{ fontSize: size * 0.62 }}>{signed(change)}</span> : null}
                    </a>
                  );
                })}
              </div>
            ))}
          </div>
        ))}

        {hovered && hover ? (
          <div
            className="t-heat-tip"
            style={{
              left: hover.x + 280 > width ? Math.max(4, hover.x - 276) : hover.x + 16,
              top: Math.min(Math.max(4, hover.y - 20), Math.max(4, height - 60 - peers.length * 18)),
            }}
          >
            <div className="t-heat-tip-path">{hovered.sector} · {hovered.industry}</div>
            <div className="t-heat-tip-main" style={{ background: moveColor(hovered.moves[period], full) }}>
              <b>{hovered.ticker}</b>
              <span>{price(hovered.price)}</span>
              <span>{signed(hovered.moves[period])}</span>
            </div>
            <div className="t-heat-tip-name">{hovered.name}</div>
            <table>
              <tbody>
                {peers.map((peer) => (
                  <tr key={peer.ticker} data-current={peer.ticker === hovered.ticker || undefined}>
                    <td><i style={{ background: moveColor(peer.moves[period], full) }} />{peer.ticker}</td>
                    <td>{price(peer.price)}</td>
                    <td data-dir={(peer.moves[period] ?? 0) < 0 ? "down" : "up"}>{signed(peer.moves[period])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {compact ? null : (
        <div className="t-heat-legend" aria-label="Colour scale">
          {[-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1].map((share) => (
            <span key={share} style={{ background: moveColor(share * full, full) }}>{share > 0 ? "+" : share < 0 ? "−" : ""}{Math.abs(Math.round(share * full * 10) / 10)}%</span>
          ))}
        </div>
      )}
    </div>
  );
}
