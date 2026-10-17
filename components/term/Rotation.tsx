"use client";

import { useEffect, useMemo, useState } from "react";
import type { Candles } from "@/lib/adapters/candles";
import { quadrantOf, rotation, type RotationPoint } from "@/lib/term/rrg";

/**
 * RRG: the eleven sector funds against the S&P 500 on a relative rotation
 * graph — strength across, momentum up — each with a tail of its last weeks
 * so the direction of travel shows. Leading top right, weakening bottom right,
 * lagging bottom left, improving top left (lib/term/rrg.ts).
 */

const SECTOR_FUNDS = [
  { symbol: "XLK", name: "Technology", color: "#4ea8ff" },
  { symbol: "XLF", name: "Financials", color: "#2dd4bf" },
  { symbol: "XLV", name: "Health care", color: "#a78bfa" },
  { symbol: "XLY", name: "Discretionary", color: "#f472b6" },
  { symbol: "XLC", name: "Communication", color: "#facc15" },
  { symbol: "XLI", name: "Industrials", color: "#38bdf8" },
  { symbol: "XLP", name: "Staples", color: "#e879f9" },
  { symbol: "XLE", name: "Energy", color: "#fb923c" },
  { symbol: "XLU", name: "Utilities", color: "#a3e635" },
  { symbol: "XLRE", name: "Real estate", color: "#f87171" },
  { symbol: "XLB", name: "Materials", color: "#cbd5e1" },
];
const BENCHMARK = "SPY";
const TAIL: Record<"1wk" | "1d", number> = { "1wk": 6, "1d": 10 };
const QUADRANT_NAMES = { leading: "Leading", weakening: "Weakening", lagging: "Lagging", improving: "Improving" };

export function Rotation() {
  const [bars, setBars] = useState<"1wk" | "1d">("1wk");
  const [loaded, setLoaded] = useState<{ bars: string; series: Record<string, Candles | null> } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const symbols = [BENCHMARK, ...SECTOR_FUNDS.map((fund) => fund.symbol)];
    Promise.all(symbols.map((symbol) => fetch(`/api/candles/${symbol}?interval=${bars}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<Candles> : null)).catch(() => null)))
      .then((answers) => {
        if (!controller.signal.aborted) setLoaded({ bars, series: Object.fromEntries(symbols.map((symbol, index) => [symbol, answers[index]])) });
      });
    return () => controller.abort();
  }, [bars]);

  const paths = useMemo(() => {
    if (!loaded || loaded.bars !== bars) return null;
    const market = loaded.series[BENCHMARK];
    if (!market) return [];
    return SECTOR_FUNDS.flatMap((fund) => {
      const candles = loaded.series[fund.symbol];
      if (!candles) return [];
      const path = rotation(candles, market).slice(-TAIL[bars]);
      return path.length ? [{ ...fund, path }] : [];
    });
  }, [loaded, bars]);

  const points = (paths ?? []).flatMap((fund) => fund.path);
  // Square about 100, wide enough for every tail, so the quadrants are equal.
  const reach = Math.max(1.5, ...points.map((point) => Math.max(Math.abs(point.ratio - 100), Math.abs(point.momentum - 100)))) * 1.1;
  const W = 520;
  const H = 400;
  const x = (ratio: number) => 30 + ((ratio - (100 - reach)) / (2 * reach)) * (W - 40);
  const y = (momentum: number) => 10 + (1 - (momentum - (100 - reach)) / (2 * reach)) * (H - 30);
  const line = (path: RotationPoint[]) => path.map((point, index) => `${index ? "L" : "M"}${x(point.ratio).toFixed(1)} ${y(point.momentum).toFixed(1)}`).join("");

  return (
    <div className="t-rrg">
      <div className="t-heat-bar">
        <div className="seg" role="group" aria-label="Bars">
          <button type="button" aria-pressed={bars === "1wk"} onClick={() => setBars("1wk")}>Weekly</button>
          <button type="button" aria-pressed={bars === "1d"} onClick={() => setBars("1d")}>Daily</button>
        </div>
        <span className="t-dim">Sector funds against SPY · tail of {TAIL[bars]} {bars === "1wk" ? "weeks" : "sessions"} · clockwise is the usual turn</span>
      </div>
      <div className="t-rrg-body">
        <svg viewBox={`0 0 ${W} ${H}`} className="t-rrg-plot" role="img" aria-label="Relative rotation graph of the S&P 500 sectors">
          <rect x={x(100)} y={y(100 + reach)} width={x(100 + reach) - x(100)} height={y(100) - y(100 + reach)} className="t-rrg-q t-rrg-leading" />
          <rect x={x(100)} y={y(100)} width={x(100 + reach) - x(100)} height={y(100 - reach) - y(100)} className="t-rrg-q t-rrg-weakening" />
          <rect x={x(100 - reach)} y={y(100)} width={x(100) - x(100 - reach)} height={y(100 - reach) - y(100)} className="t-rrg-q t-rrg-lagging" />
          <rect x={x(100 - reach)} y={y(100 + reach)} width={x(100) - x(100 - reach)} height={y(100) - y(100 + reach)} className="t-rrg-q t-rrg-improving" />
          <text x={x(100 + reach) - 6} y={y(100 + reach) + 14} textAnchor="end" className="t-rrg-qname">LEADING</text>
          <text x={x(100 + reach) - 6} y={y(100 - reach) - 6} textAnchor="end" className="t-rrg-qname">WEAKENING</text>
          <text x={x(100 - reach) + 6} y={y(100 - reach) - 6} className="t-rrg-qname">LAGGING</text>
          <text x={x(100 - reach) + 6} y={y(100 + reach) + 14} className="t-rrg-qname">IMPROVING</text>
          <line x1={x(100)} x2={x(100)} y1={y(100 + reach)} y2={y(100 - reach)} className="t-rrg-axis" />
          <line x1={x(100 - reach)} x2={x(100 + reach)} y1={y(100)} y2={y(100)} className="t-rrg-axis" />
          <text x={W / 2} y={H - 4} textAnchor="middle" className="t-rrg-label">RELATIVE STRENGTH →</text>
          <text x={10} y={H / 2} textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`} className="t-rrg-label">MOMENTUM →</text>
          {(paths ?? []).map((fund) => {
            const last = fund.path[fund.path.length - 1];
            const dim = focus != null && focus !== fund.symbol;
            return (
              <g key={fund.symbol} opacity={dim ? 0.15 : 1} onPointerEnter={() => setFocus(fund.symbol)} onPointerLeave={() => setFocus(null)}>
                <path d={line(fund.path)} fill="none" stroke={fund.color} strokeWidth={1.4} />
                {fund.path.slice(0, -1).map((point) => <circle key={point.t} cx={x(point.ratio)} cy={y(point.momentum)} r={1.8} fill={fund.color} />)}
                <circle cx={x(last.ratio)} cy={y(last.momentum)} r={5} fill={fund.color} stroke="#0a1222" strokeWidth={1} />
                <text x={x(last.ratio) + 7} y={y(last.momentum) + 3} className="t-rrg-tag" fill={fund.color}>{fund.symbol}</text>
              </g>
            );
          })}
        </svg>
        <table className="t-rrg-list">
          <tbody>
            {(paths ?? []).map((fund) => {
              const last = fund.path[fund.path.length - 1];
              const quadrant = quadrantOf(last);
              return (
                <tr key={fund.symbol} onPointerEnter={() => setFocus(fund.symbol)} onPointerLeave={() => setFocus(null)} data-focus={focus === fund.symbol || undefined}>
                  <td><i style={{ background: fund.color }} />{fund.symbol}</td>
                  <td className="t-dim">{fund.name}</td>
                  <td data-quadrant={quadrant}>{QUADRANT_NAMES[quadrant]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {paths && !paths.length ? <p className="t-empty">Sector fund data is temporarily unavailable.</p> : null}
      {!paths ? <p className="t-empty">Loading price data…</p> : null}
    </div>
  );
}
