"use client";

import { useEffect, useMemo, useState } from "react";
import { readPrefs } from "./prefs";
import { markOnboarded, ONBOARDED_KEY } from "./Welcome";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { useStoredHoldings } from "@/components/io/holdings";
import { WatchlistEditor } from "@/components/io/WatchlistEditor";
import { delta, price } from "@/components/io/format";
import { NewsSection } from "@/components/io/Wire";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { EarningsCalendar } from "./EarningsCalendar";
import { Heatmap } from "./Heatmap";
import { Indices } from "./Indices";
import { Panel } from "./Panel";
import { MiniEcal } from "./EarningsCal";
import { EconBrief, useEcon } from "./Economy";
import { AlertsBrief } from "./Alerts";
import { FedPanel, PortfolioGlance, RatesPanel, SessionSummary, SignalsPanel, WatchEarnings, useHomeData } from "./Home";
import { useTape } from "./quotes";

const SECTORS = new Map(DEFAULT_WATCHLIST.map((company) => [company.ticker, company.sector]));

/**
 * The first screen: the market, the reader's list, and what is coming.
 *
 * Across the top, the session written out beside the Treasuries, the dollar
 * and the Fed's odds. Left, the averages, the book at a glance, the watchlist
 * and its next earnings; right, the US releases against their consensus, the
 * heat map, the alerts caught and the new highs, lows and heavy volume, then
 * the wire beside the week's earnings of the reader's names and the calendar. Every panel is a function a reader can type
 * (components/term/Home.tsx for the newer ones).
 */
export function Launchpad() {
  const tickers = useStoredWatchlist();
  const holdings = useStoredHoldings();
  const [editing, setEditing] = useState(false);
  const followed = useMemo(() => [...new Set([...tickers, ...holdings.map((position) => position.ticker)])], [tickers, holdings]);
  const tape = useTape(followed);
  const home = useHomeData(followed);
  const { data: econ } = useEcon();
  const quotes = new Map((tape?.quotes ?? []).filter((quote) => quote.kind === "equity").map((quote) => [quote.symbol, quote]));
  // Arriving from elsewhere, once a visit, the terminal opens where the reader chose on SET (components/term/prefs.ts).
  useEffect(() => {
    /*
     * A first visit opens the tour, once. A reader with anything already kept
     * here — a list, a book, alerts, preferences — is not new: they are marked
     * as toured and left where they are.
     */
    try {
      if (!localStorage.getItem(ONBOARDED_KEY) && !navigator.webdriver) {
        const known = Object.keys(localStorage).some((key) => key.startsWith("finscope.") && key !== ONBOARDED_KEY);
        if (!known) { window.location.replace("/t/welcome"); return; }
        markOnboarded();
      }
    } catch { /* No storage: no tour, no harm. */ }
    const start = readPrefs().start;
    if (start === "/t") return;
    let arrived = true;
    try { arrived = !document.referrer.startsWith(window.location.origin) && !sessionStorage.getItem("finscope.term.started"); sessionStorage.setItem("finscope.term.started", "1"); } catch { arrived = false; }
    if (arrived) window.location.replace(start);
  }, []);

  return (
    <div className="t-grid t-launch">
      <Panel code="SUM" title={home.phase === "pre" ? "Before the open" : home.phase === "open" ? "The session so far" : "The session"} area="sum">
        <SessionSummary data={home} tape={tape} econ={econ} />
      </Panel>
      <Panel code="RATES" title="Treasuries and the dollar" area="rates">
        <RatesPanel data={home} />
      </Panel>
      <Panel code="FED" title="Fed · rate odds from futures" area="fed">
        <FedPanel data={home} />
      </Panel>
      <div className="t-col" style={{ gridArea: "left" }}>
        <Panel code="WEI" title="Indices">
          <Indices />
        </Panel>
        <Panel code="PORT" title="Portfolio · today">
          <PortfolioGlance positions={holdings} tape={tape} />
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
        <Panel code="EVTS" id="evts-next" title="Next earnings · watchlist">
          <EarningsCalendar tickers={tickers} />
        </Panel>
      </div>

      <div className="t-col" style={{ gridArea: "right" }}>
        <Panel code="ECO" title="US economy · releases against the consensus">
          <EconBrief />
        </Panel>
        <Panel code="IMAP" title="Today's moves">
          <Heatmap height={380} compact />
        </Panel>
        {/* Two columns to the bottom: the alerts over the wire, and the signals over the earnings. */}
        <div className="t-pair">
          <div className="t-stack">
            <Panel code="ALRT" title="Alerts">
              <AlertsBrief />
            </Panel>
            <Panel code="N">
              <NewsSection />
            </Panel>
          </div>
          <div className="t-stack">
            <Panel code="SIGS" title="52-week highs, lows and volume">
              <SignalsPanel data={home} />
            </Panel>
            <Panel code="EVTS" title="Earnings this week">
              <WatchEarnings data={home} tickers={followed} />
            </Panel>
            <Panel code="ECAL" title="Earnings · next 3 days">
              <MiniEcal />
            </Panel>
          </div>
        </div>
      </div>
      {editing ? <WatchlistEditor tickers={tickers} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
