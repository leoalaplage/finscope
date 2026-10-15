"use client";

import { useEffect, useState } from "react";
import { readPrefs } from "./prefs";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { WatchlistEditor } from "@/components/io/WatchlistEditor";
import { delta, price } from "@/components/io/format";
import { NewsSection } from "@/components/io/Wire";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { EarningsCalendar } from "./EarningsCalendar";
import { Heatmap } from "./Heatmap";
import { Indices } from "./Indices";
import { Panel } from "./Panel";
import { MiniEcal } from "./EarningsCal";
import { EconBrief } from "./Economy";
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
  const [editing, setEditing] = useState(false);
  const tape = useTape(tickers);
  const quotes = new Map((tape?.quotes ?? []).filter((quote) => quote.kind === "equity").map((quote) => [quote.symbol, quote]));
  // Arriving from elsewhere, once a visit, the terminal opens where the reader chose on SET (components/term/prefs.ts).
  useEffect(() => {
    const start = readPrefs().start;
    if (start === "/t") return;
    let arrived = true;
    try { arrived = !document.referrer.startsWith(window.location.origin) && !sessionStorage.getItem("finscope.term.started"); sessionStorage.setItem("finscope.term.started", "1"); } catch { arrived = false; }
    if (arrived) window.location.replace(start);
  }, []);

  return (
    <div className="t-grid t-launch">
      <div className="t-col" style={{ gridArea: "left" }}>
        <Panel code="WEI" title="Indices">
          <Indices />
        </Panel>
        <Panel code="W" title="Watchlist" actions={<button type="button" className="t-chip" onClick={() => setEditing(true)}>Edit</button>}>
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
          <Heatmap height={380} compact />
        </Panel>
        <div className="t-pair">
          <Panel code="N">
            <NewsSection />
          </Panel>
          {/* The next three days of results, where the filings feed was: FIL is still a function, and the filings are on every company. */}
          <Panel code="ECAL" title="Earnings · next 3 days">
            <MiniEcal />
          </Panel>
        </div>
      </div>
      <Panel code="ECO" title="US economy · releases against the consensus" area="eco">
        <EconBrief />
      </Panel>
      {editing ? <WatchlistEditor tickers={tickers} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
