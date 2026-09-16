"use client";

import { useEffect, useRef, useState } from "react";
import type { CandleInterval } from "@/lib/adapters/candles";
import { INTERVAL_TITLES } from "@/lib/io/candle-chart";
import { CandleChart, IntervalPicker, lastMoveOf, percent, price, tone, useCandles } from "./CandleChart";
import { useStoredWatchlist } from "./watchlist";

/**
 * The watchlist as candles, three to a row, under the list itself.
 *
 * One interval for all of them, so the row reads as a comparison. A card asks
 * for its candles only when it scrolls near the screen: a list of sixty would
 * otherwise be sixty requests before the reader has looked past the first row.
 */
export function HomeCharts() {
  const tickers = useStoredWatchlist();
  const [interval, setCandleInterval] = useState<CandleInterval>("1d");
  if (!tickers.length) return null;
  return (
    <section className="home-charts" aria-labelledby="home-charts-title">
      <div className="quick-head home-charts-head">
        <h2 className="label" id="home-charts-title">Charts</h2>
        <IntervalPicker interval={interval} onInterval={setCandleInterval} />
      </div>
      <div className="home-charts-grid">
        {tickers.map((ticker) => <ChartCard key={ticker} ticker={ticker} interval={interval} />)}
      </div>
    </section>
  );
}

function ChartCard({ ticker, interval }: { ticker: string; interval: CandleInterval }) {
  const card = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = card.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setNear(true); }, { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  const { candles, error, loading } = useCandles(ticker, interval, near);
  const latest = lastMoveOf(candles);
  return (
    <article className="home-chart" ref={card}>
      <a className="home-chart-head" href={`/s/${encodeURIComponent(ticker)}`}>
        <b>{ticker}</b>
        {latest ? (
          <span>
            {price(latest.close)}
            {latest.move != null && latest.base ? <em data-tone={tone(latest.move)}> {percent(latest.move / latest.base)}</em> : null}
          </span>
        ) : null}
      </a>
      <CandleChart
        compact candles={candles} interval={interval} loading={loading || !near} error={error}
        label={`${ticker}, ${INTERVAL_TITLES[interval].toLowerCase()} candles`}
      />
    </article>
  );
}
