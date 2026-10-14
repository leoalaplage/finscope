"use client";

import { useEffect, useState } from "react";
import { WatchlistEditor } from "@/components/io/WatchlistEditor";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { Panel } from "./Panel";

/**
 * SET: what the terminal keeps, and the means to change it.
 *
 * Everything a reader sets up here lives in their own browser — no account,
 * nothing sent anywhere — so this screen says what each thing is, how much of
 * it there is, and lets each be cleared on its own. The terminal has one
 * theme; the document site's light and dark setting lives on its own page.
 */

interface Kept { name: string; what: string; keys: string[] }

const KEPT: Kept[] = [
  { name: "Watchlist", what: "The companies on the launchpad, the tape and the screener; cleared, it returns to the default list.", keys: ["finscope.io.watchlists.v1", "finscope.io.home-watchlist.v1"] },
  { name: "Portfolio", what: "Holdings entered on PORT: tickers, shares and prices paid.", keys: ["finscope.io.portfolio.v1"] },
  { name: "Chart workspace", what: "Charts, intervals, studies and the layouts saved by name on CHART.", keys: ["finscope.term.workspace.v1"] },
  { name: "Drawings", what: "Trend lines, levels, zones and retracements drawn on each symbol.", keys: ["finscope.term.drawings.v1"] },
  { name: "Scanner", what: "The last universe and rule on SCAN.", keys: ["finscope.term.scan.v1"] },
  { name: "Backtest", what: "The last symbol, rules and options on BT.", keys: ["finscope.term.backtest.v1"] },
  { name: "Recent company", what: "The company Compare, DCF and Chart open on.", keys: ["finscope.lastCompany"] },
];

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const size = (bytes: number) => (bytes ? bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB` : "—");

export function TermSettings() {
  const watchlist = useStoredWatchlist();
  const [editing, setEditing] = useState(false);
  const [sizes, setSizes] = useState<Record<string, number> | null>(null);
  const measure = () => setSizes(Object.fromEntries(KEPT.map((item) => [item.name, item.keys.reduce((sum, key) => sum + (read(key)?.length ?? 0), 0)])));
  // Measured after mount: storage is the browser's, and the server has none.
  useEffect(() => {
    const timer = setTimeout(measure, 0);
    return () => clearTimeout(timer);
  }, []);

  const clear = (item: Kept) => {
    if (!window.confirm(`Clear ${item.name.toLowerCase()} from this browser? This cannot be undone.`)) return;
    for (const key of item.keys) { try { localStorage.removeItem(key); } catch { /* Nothing kept to clear. */ } }
    // Every screen that reads these hears it, as it would a write from another tab.
    window.dispatchEvent(new StorageEvent("storage"));
    measure();
  };

  return (
    <div className="t-grid t-settings">
      <Panel code="SET" title="Kept on this device" area="kept">
        <div className="sheet t-kept">
          <table>
            <thead><tr><th className="key">What</th><th className="key">Holds</th><th>Size</th><th /></tr></thead>
            <tbody>
              {KEPT.map((item) => (
                <tr key={item.name}>
                  <th className="key">{item.name}</th>
                  <td className="key t-dim">{item.what}</td>
                  <td>{sizes ? size(sizes[item.name]) : "…"}</td>
                  <td className="t-row-links">
                    {item.name === "Watchlist" ? <button type="button" className="t-chip" onClick={() => setEditing(true)}>Edit</button> : null}
                    <button type="button" className="t-chip" disabled={!sizes?.[item.name]} onClick={() => clear(item)}>Clear</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="t-study-note">Kept in this browser. Signed in to <a href="/t/account">an account</a>, the same copy follows you to every device; otherwise another browser or device starts empty.</p>
      </Panel>

      <Panel code="SET" id="set-about" title="About the terminal" area="about">
        <div className="t-panel-pad t-about">
          <p>Dark only, by design.</p>
          <p>Filings come from SEC EDGAR; prices from Yahoo Finance and may be delayed; the earnings calendar and its consensus forecasts from Nasdaq, labelled as the analysts&apos; wherever they appear.</p>
          <p>Research information only, not investment advice. Type <code>HELP</code> anywhere for every command.</p>
        </div>
      </Panel>

      {editing ? <WatchlistEditor tickers={watchlist} onClose={() => { setEditing(false); measure(); }} /> : null}
    </div>
  );
}
