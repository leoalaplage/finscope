"use client";

import { useEffect, useRef, useState } from "react";
import { INTERVAL_TITLES } from "@/lib/io/candle-chart";
import { CandleChart, lastMoveOf, percent, price, useCandles } from "@/components/io/CandleChart";
import { useStoredWatchlist } from "@/components/io/watchlist";
import type { Study } from "@/lib/io/technicals";
import { Panel } from "./Panel";

/**
 * MKT · the watchlist as monthly candles with their 20, 50 and 200-period
 * EMAs, the last six years on screen, one panel a company, three to a row,
 * under the watchlist's performance. A panel asks for its candles only
 * once it nears the screen: a list of sixty would otherwise be sixty requests
 * before the reader has scrolled past the first row.
 */
/** Six years of months on screen; the averages are taken over the whole history behind them. */
const MONTHS_SHOWN = 72;
const STUDIES: ReadonlySet<Study> = new Set<Study>(["ema"]);

export function WatchlistCharts({ area }: { area: string }) {
  const tickers = useStoredWatchlist();
  if (!tickers.length) return null;
  return (
    <Panel code="WCH" title={`Watchlist · monthly charts · ${tickers.length} companies`} area={area} className="t-wcharts-panel"
      actions={<span>Monthly candles · EMA 20 · 50 · 200 · last 6 years</span>}>
      <div className="t-wcharts">
        {tickers.map((ticker) => <WatchlistChart key={ticker} ticker={ticker} />)}
      </div>
    </Panel>
  );
}

function WatchlistChart({ ticker }: { ticker: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = frame.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setNear(true); }, { rootMargin: "400px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  const { candles, error, loading } = useCandles(ticker, "1mo", near);
  const latest = lastMoveOf(candles);
  const move = latest?.move != null && latest.base ? latest.move / latest.base : null;
  const href = `/t/s/${encodeURIComponent(ticker)}`;
  return (
    <div ref={frame} className="t-wchart-frame">
      <Panel
        code={ticker} id={`wch-${ticker.toLowerCase()}`} title="" className="t-wchart"
        actions={latest ? (
          <span>
            {price(latest.close)}{" "}
            {move != null ? <span className="t-wchart-move" data-dir={move < 0 ? "down" : "up"}>{percent(move)}</span> : null}
            {" · "}<a href={href}>Open</a>
          </span>
        ) : <a href={href}>Open</a>}
      >
        {/* The chart opens the company's page; a link or button inside it keeps its own job. */}
        <div
          className="t-wchart-link" role="link" tabIndex={0} aria-label={`Open ${ticker}`}
          onClick={(event) => { if (!(event.target as Element).closest("a, button")) window.location.assign(href); }}
          onKeyDown={(event) => { if (event.key === "Enter") window.location.assign(href); }}
        >
          {/* The watermark: the ticker faint across the plot, the mark in its corner — over the chart, never in the pointer's way. */}
          <span className="t-wmark" aria-hidden="true">{ticker}</span>
          <span className="t-wmark-logo" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- the site's own favicon, a few hundred bytes. */}
            <img src="/favicon.svg" alt="" width={11} height={11} />TENQAY
          </span>
          <CandleChart compact candles={candles} interval="1mo" studies={STUDIES} openOn={MONTHS_SHOWN} loading={loading || !near} error={error} label={`${ticker}, ${INTERVAL_TITLES["1mo"].toLowerCase()} candles`} />
        </div>
      </Panel>
    </div>
  );
}
