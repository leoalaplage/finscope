"use client";

import { useEffect, useRef, useState } from "react";
import { INTERVAL_TITLES } from "@/lib/io/candle-chart";
import { CandleChart, lastMoveOf, percent, price, useCandles } from "@/components/io/CandleChart";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { Panel } from "./Panel";

/**
 * MKT · the watchlist as monthly candles, one panel a company, three to a
 * row, under the watchlist's performance. A panel asks for its candles only
 * once it nears the screen: a list of sixty would otherwise be sixty requests
 * before the reader has scrolled past the first row.
 */
export function WatchlistCharts({ area }: { area: string }) {
  const tickers = useStoredWatchlist();
  if (!tickers.length) return null;
  return (
    <div className="t-wcharts" style={{ gridArea: area }}>
      {tickers.map((ticker) => <WatchlistChart key={ticker} ticker={ticker} />)}
    </div>
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
  return (
    <div ref={frame} className="t-wchart-frame">
      <Panel
        code={ticker} id={`wch-${ticker.toLowerCase()}`} title="Monthly" className="t-wchart"
        actions={latest ? (
          <span>
            {price(latest.close)}{" "}
            {move != null ? <span className="t-wchart-move" data-dir={move < 0 ? "down" : "up"}>{percent(move)}</span> : null}
            {" · "}<a href={`/t/s/${encodeURIComponent(ticker)}`}>Open</a>
          </span>
        ) : <a href={`/t/s/${encodeURIComponent(ticker)}`}>Open</a>}
      >
        <CandleChart compact candles={candles} interval="1mo" loading={loading || !near} error={error} label={`${ticker}, ${INTERVAL_TITLES["1mo"].toLowerCase()} candles`} />
      </Panel>
    </div>
  );
}
