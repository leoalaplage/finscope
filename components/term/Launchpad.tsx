"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Native navigation, as in
   components/io/Shell.tsx: vinext's production RSC link bridge fails to hydrate. */

import { useStoredWatchlist } from "@/components/io/watchlist";
import { delta, price } from "@/components/io/format";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { Panel } from "./Panel";
import { useTape } from "./quotes";

const SECTORS = new Map(DEFAULT_WATCHLIST.map((company) => [company.ticker, company.sector]));

/**
 * The first screen: the reader's list, and how to drive the line above it.
 *
 * The list reads the same tape as the ticker strip, so opening the terminal
 * costs one request for both.
 */
export function Launchpad() {
  const tickers = useStoredWatchlist();
  const tape = useTape(tickers);
  const quotes = new Map((tape?.quotes ?? []).filter((quote) => quote.kind === "equity").map((quote) => [quote.symbol, quote]));

  return (
    <div className="t-grid t-launch">
      <Panel code="W" title="Watchlist" area="wl" actions={<a href="/">Edit on the classic site</a>}>
        <div className="sheet t-watch">
          <table>
            <thead>
              <tr>
                <th className="key">Ticker</th>
                <th className="key">Sector</th>
                <th>Last</th>
                <th>Chg %</th>
              </tr>
            </thead>
            <tbody>
              {tickers.map((ticker) => {
                const quote = quotes.get(ticker);
                const move = quote?.changePercent ?? null;
                return (
                  <tr key={ticker}>
                    <td className="key"><a href={`/t/s/${encodeURIComponent(ticker)}`}>{ticker}</a></td>
                    <td className="key t-dim">{SECTORS.get(ticker) ?? quote?.sector ?? ""}</td>
                    <td>{quote?.price == null ? "—" : price(quote.price, null)}</td>
                    <td data-dir={move == null ? undefined : move < 0 ? "down" : "up"}>{delta(move)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel code="HELP" title="Driving the terminal" area="how" className="t-how">
        <div className="t-panel-pad">
          <p>Type anywhere. The line at the top takes a security, then a function.</p>
          <p><code>AAPL</code> opens Apple. <code>AAPL GP</code> goes straight to its price graph, <code>NVDA FA</code> to Nvidia&apos;s figures.</p>
          <p>A function on its own applies to the security on screen: <code>HDS</code>, <code>CN</code>, <code>DCF</code>.</p>
          <p>A name works too: <code>coca cola</code>. <code>TAB</code> completes, <code>ESC</code> clears, <code>⌥1</code>–<code>⌥0</code> are the function keys.</p>
          <p><code>HELP</code> lists every command.</p>
        </div>
      </Panel>
    </div>
  );
}
