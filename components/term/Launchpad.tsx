"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Native navigation, as in
   components/io/Shell.tsx: vinext's production RSC link bridge fails to hydrate. */

import { useStoredWatchlist } from "@/components/io/watchlist";
import { delta, price } from "@/components/io/format";
import { MacroSnapshot } from "@/components/io/MacroSnapshot";
import { FilingsSection, NewsSection } from "@/components/io/Wire";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { EarningsCalendar } from "./EarningsCalendar";
import { Heatmap } from "./Heatmap";
import { Indices } from "./Indices";
import { Panel } from "./Panel";
import { useTape } from "./quotes";

const SECTORS = new Map(DEFAULT_WATCHLIST.map((company) => [company.ticker, company.sector]));

/**
 * The first screen: the market, the reader's list, and what is coming.
 *
 * Left, the averages, the watchlist with today's move and the calendar of its
 * next earnings; right, the heat map of the largest names over the wire and
 * what reached EDGAR today; macro last, full width. Every panel
 * is a function a reader can type (WEI, W, IMAP, EVTS, N, FIL, ECO), and every
 * panel reads an endpoint the document site already serves.
 */
export function Launchpad() {
  const tickers = useStoredWatchlist();
  const tape = useTape(tickers);
  const quotes = new Map((tape?.quotes ?? []).filter((quote) => quote.kind === "equity").map((quote) => [quote.symbol, quote]));

  return (
    <div className="t-grid t-launch">
      <div className="t-col" style={{ gridArea: "left" }}>
        <Panel code="WEI" title="Indices">
          <Indices />
        </Panel>
        <Panel code="W" title="Watchlist" actions={<a href="/">Edit on the classic site</a>}>
          <div className="sheet t-watch">
            <table>
              <thead>
                <tr>
                  <th className="key">Ticker</th>
                  <th>Last</th>
                  <th>Chg %</th>
                </tr>
              </thead>
              <tbody>
                {tickers.map((ticker) => {
                  const quote = quotes.get(ticker);
                  const move = quote?.changePercent ?? null;
                  return (
                    <tr key={ticker} title={SECTORS.get(ticker) ?? quote?.sector ?? undefined}>
                      <td className="key"><a href={`/t/s/${encodeURIComponent(ticker)}`}>{ticker}</a></td>
                      <td>{quote?.price == null ? "—" : price(quote.price, null)}</td>
                      <td data-dir={move == null ? undefined : move < 0 ? "down" : "up"}>{delta(move)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel code="EVTS" title="Earnings · watchlist">
          <EarningsCalendar tickers={tickers} />
        </Panel>
      </div>

      <div className="t-col" style={{ gridArea: "right" }}>
        <Panel code="IMAP" title="Today's moves">
          <Heatmap />
        </Panel>
        <div className="t-pair">
          <Panel code="N">
            <NewsSection />
          </Panel>
          <Panel code="FIL">
            <FilingsSection />
          </Panel>
        </div>
      </div>
      <Panel code="ECO" area="eco">
        <MacroSnapshot />
      </Panel>
    </div>
  );
}
