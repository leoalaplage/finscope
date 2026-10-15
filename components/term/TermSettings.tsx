"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WatchlistEditor } from "@/components/io/WatchlistEditor";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { useAccount } from "@/components/io/account";
import { SYNC_EVENT, syncStatus } from "@/components/io/AccountSync";
import { parseRules, RULES_KEY } from "@/lib/alert-rules";
import { COMPANY_FUNCTIONS, GLOBAL_FUNCTIONS } from "@/lib/term/command";
import { START_SCREENS, useTermPrefs, writePrefs, type Clock, type Density, type UpDown } from "./prefs";
import { Panel } from "./Panel";

/**
 * SET: how the terminal looks and opens, where alerts go, the account, and
 * what this browser keeps — to see, export, restore and clear.
 */

interface Kept { name: string; what: string; keys: string[] }

const KEPT: Kept[] = [
  { name: "Watchlists", what: "The companies on the launchpad, the tape and the screener; cleared, the default list returns.", keys: ["finscope.io.watchlists.v1", "finscope.io.home-watchlist.v1"] },
  { name: "Portfolio", what: "Positions and trades entered on PORT.", keys: ["finscope.io.portfolio.v1", "finscope.io.portfolio.trades.v1"] },
  { name: "Notes", what: "Your theses on companies (NOTE), with their price levels.", keys: ["finscope.io.thesis.v1"] },
  { name: "Alerts", what: "Your alert rules (ALRT) and what has been read.", keys: [RULES_KEY, "finscope.io.alerts-seen.v1", "finscope.io.alerts-notify.v1"] },
  { name: "Saved screens", what: "Screens saved on SCRN.", keys: ["finscope.free-screener.v1"] },
  { name: "Chart workspace", what: "Charts, intervals, studies and named layouts on CHART.", keys: ["finscope.term.workspace.v1", "finscope.chart.studies"] },
  { name: "Drawings", what: "Trend lines, levels, zones and retracements drawn on each symbol.", keys: ["finscope.term.drawings.v1"] },
  { name: "Scanner and backtests", what: "The last rules on SCAN and BT.", keys: ["finscope.term.scan.v1", "finscope.term.backtest.v1"] },
  { name: "Preferences", what: "The choices on this page, the chart styles and the last company opened.", keys: ["finscope.term.prefs.v1", "finscope.term.price.style", "finscope.term.market.style", "finscope.lastCompany"] },
];

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const size = (bytes: number) => (bytes ? bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB` : "—");
const announce = () => window.dispatchEvent(new StorageEvent("storage"));
/** Every key this site keeps in the browser; the session's own bookkeeping aside. */
const ownKeys = () => {
  const keys: string[] = [];
  try { for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index); if (key?.startsWith("finscope.") && key !== "finscope.sync.stamps.v1") keys.push(key); } } catch { /* None readable. */ }
  return keys.sort();
};

const subscribeStore = (notify: () => void) => {
  const events = ["storage", "finscope:price-style", "finscope:market-style", "finscope:alerts", SYNC_EVENT];
  for (const event of events) window.addEventListener(event, notify);
  return () => { for (const event of events) window.removeEventListener(event, notify); };
};
const useStored = (key: string) => useSyncExternalStore(subscribeStore, () => read(key), () => null);
const noSync = { state: "idle" as const, at: null };

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ id: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className="t-set-row">
      <span className="t-set-label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map((option) => <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>{option.label}</button>)}
      </div>
    </div>
  );
}

export function TermSettings() {
  const watchlist = useStoredWatchlist();
  const prefs = useTermPrefs();
  const { account } = useAccount();
  const sync = useSyncExternalStore(subscribeStore, syncStatus, () => noSync);
  const priceStyle = useStored("finscope.term.price.style") === "area" ? "area" : "candles";
  const marketStyle = useStored("finscope.term.market.style") === "area" ? "area" : "candles";
  const notify = useStored("finscope.io.alerts-notify.v1") === "on";
  const rules = parseRules(useStored(RULES_KEY));
  const [editing, setEditing] = useState(false);
  const [sizes, setSizes] = useState<Record<string, number> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const measure = () => setSizes(Object.fromEntries(KEPT.map((item) => [item.name, item.keys.reduce((sum, key) => sum + (read(key)?.length ?? 0), 0)])));
  // Measured after mount: storage is the browser's, and the server has none.
  useEffect(() => {
    const timer = setTimeout(measure, 0);
    return () => clearTimeout(timer);
  }, []);

  const writeStyle = (key: string, event: string, value: string) => {
    try { localStorage.setItem(key, value); window.dispatchEvent(new Event(event)); } catch { /* This visit only. */ }
  };
  const toggleNotify = async () => {
    if (notify) { writeStyle("finscope.io.alerts-notify.v1", "finscope:alerts", "off"); return; }
    if (typeof Notification === "undefined") { setMessage("This browser cannot show notifications."); return; }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission === "granted") writeStyle("finscope.io.alerts-notify.v1", "finscope:alerts", "on");
    else setMessage("Notifications are blocked for this site in the browser's settings.");
  };
  const clear = (item: Kept) => {
    if (!window.confirm(`Clear ${item.name.toLowerCase()} from this browser? This cannot be undone.`)) return;
    for (const key of item.keys) { try { localStorage.removeItem(key); } catch { /* Nothing kept to clear. */ } }
    announce(); measure();
  };
  const exportAll = () => {
    const items = Object.fromEntries(ownKeys().map((key) => [key, read(key)]));
    const blob = new Blob([JSON.stringify({ app: "Tenqay", exportedAt: new Date().toISOString(), items }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `tenqay-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage(`Exported ${Object.keys(items).length} stores.`);
  };
  const importAll = async (picked: File | undefined) => {
    if (!picked) return;
    try {
      const body = JSON.parse(await picked.text()) as { items?: Record<string, unknown> };
      const entries = Object.entries(body.items ?? {}).filter(([key, value]) => key.startsWith("finscope.") && typeof value === "string") as Array<[string, string]>;
      if (!entries.length) { setMessage("That file holds no Tenqay data."); return; }
      if (!window.confirm(`Restore ${entries.length} stores from this file? What this browser holds for them is replaced.`)) return;
      for (const [key, value] of entries) localStorage.setItem(key, value);
      announce(); measure();
      setMessage(`Restored ${entries.length} stores.${account ? " They will sync to your account in a few seconds." : ""}`);
    } catch {
      setMessage("That file could not be read as a Tenqay backup.");
    } finally {
      if (file.current) file.current.value = "";
    }
  };
  const clearAll = () => {
    if (!window.confirm("Clear everything Tenqay keeps in this browser — watchlists, portfolio, notes, alerts, layouts? This cannot be undone here.")) return;
    for (const key of ownKeys()) { try { localStorage.removeItem(key); } catch { /* Nothing to clear. */ } }
    announce(); measure();
    setMessage(account ? "Cleared from this browser. Your account keeps its copy: sign out first to keep it from coming back." : "Cleared from this browser.");
  };

  return (
    <div className="t-grid t-settings">
      {message ? <p className="t-set-message" role="status">{message} <button type="button" className="t-alrt-link" onClick={() => setMessage(null)}>Dismiss</button></p> : null}

      <Panel code="SET" title="Display" area="display">
        <div className="t-panel-pad t-set-body">
          <Choice<Density> label="Density" value={prefs.density} onChange={(density) => writePrefs({ density })}
            options={[{ id: "compact", label: "Compact" }, { id: "standard", label: "Standard" }, { id: "large", label: "Large" }]} />
          <Choice<UpDown> label="Up and down" value={prefs.colors} onChange={(colors) => writePrefs({ colors })}
            options={[{ id: "green-red", label: "Green / red" }, { id: "blue-orange", label: "Blue / orange" }, { id: "mono", label: "Monochrome" }]} />
          <p className="t-set-sample">Sample: <span data-dir="up">▲ +1.24%</span> <span data-dir="down">▼ −0.86%</span></p>
          <Choice<"candles" | "area"> label="Company price chart" value={priceStyle} onChange={(value) => writeStyle("finscope.term.price.style", "finscope:price-style", value)}
            options={[{ id: "candles", label: "Candles" }, { id: "area", label: "Area" }]} />
          <Choice<"candles" | "area"> label="Market chart" value={marketStyle} onChange={(value) => writeStyle("finscope.term.market.style", "finscope:market-style", value)}
            options={[{ id: "candles", label: "Candles" }, { id: "area", label: "Area" }]} />
          <Choice<Clock> label="Clock" value={prefs.clock} onChange={(clock) => writePrefs({ clock })}
            options={[{ id: "ny", label: "New York" }, { id: "local", label: "Local" }, { id: "both", label: "Both" }]} />
          <Choice<"on" | "off"> label="Ticker tape" value={prefs.tape ? "on" : "off"} onChange={(value) => writePrefs({ tape: value === "on" })}
            options={[{ id: "on", label: "Shown" }, { id: "off", label: "Hidden" }]} />
          <p className="t-study-note">Dark only, by design. Kept on this device: a phone and a desk screen can differ.</p>
        </div>
      </Panel>

      <Panel code="SET" title="Start" area="start">
        <div className="t-panel-pad t-set-body">
          <div className="t-set-row">
            <span className="t-set-label">Open on</span>
            <select className="t-set-select" value={START_SCREENS.some((screen) => screen.path === prefs.start) ? prefs.start : "company"} onChange={(event) => writePrefs({ start: event.target.value === "company" ? `/t/s/${watchlist[0] ?? "AAPL"}` : event.target.value })} aria-label="Screen to open on">
              {START_SCREENS.map((screen) => <option key={screen.path} value={screen.path}>{screen.label}</option>)}
              <option value="company">A company…</option>
            </select>
            {prefs.start.startsWith("/t/s/") ? (
              <input className="t-set-select" defaultValue={decodeURIComponent(prefs.start.slice(5))} aria-label="Company ticker" placeholder="AAPL" maxLength={12}
                onBlur={(event) => { const ticker = event.target.value.trim().toUpperCase(); if (/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)) writePrefs({ start: `/t/s/${encodeURIComponent(ticker)}` }); }} />
            ) : null}
          </div>
          <p className="t-study-note">Where Tenqay opens when you arrive from elsewhere (a bookmark, tenqay.com). HOME is always one key away.</p>
          <div className="t-set-row">
            <span className="t-set-label">Watchlist</span>
            <span className="t-dim">{watchlist.length} companies</span>
            <button type="button" className="t-chip" onClick={() => setEditing(true)}>Edit watchlist</button>
          </div>
        </div>
      </Panel>

      <Panel code="SET" title="Alerts" area="alerts">
        <div className="t-panel-pad t-set-body">
          <div className="t-set-row">
            <span className="t-set-label">Your alerts</span>
            <span>{rules.filter((rule) => rule.enabled).length} on · {rules.filter((rule) => !rule.enabled).length} paused</span>
            <a className="t-chip" href="/t/alerts">Manage alerts</a>
          </div>
          <div className="t-set-row">
            <span className="t-set-label">Browser notifications</span>
            <span className={notify ? undefined : "t-dim"}>{notify ? "On in this browser" : "Off"}</span>
            <button type="button" className="t-chip" onClick={() => { void toggleNotify(); }}>{notify ? "Turn off" : "Turn on"}</button>
          </div>
          <div className="t-set-row">
            <span className="t-set-label">Daily email</span>
            <span className={account?.email?.verified && account.email.alerts ? undefined : "t-dim"}>
              {!account ? "Needs an account" : !account.email ? "No address" : !account.email.verified ? `Waiting for confirmation · ${account.email.address}` : account.email.alerts ? `On · ${account.email.address}` : `Off · ${account.email.address}`}
            </span>
            <a className="t-chip" href="/t/account#alerts">{account ? "Email settings" : "Sign in"}</a>
          </div>
        </div>
      </Panel>

      <Panel code="SET" title="Account" area="account">
        <div className="t-panel-pad t-set-body">
          {account ? (
            <>
              <div className="t-set-row"><span className="t-set-label">Signed in as</span><span>{account.name}</span><a className="t-chip" href="/t/account">Account</a></div>
              <div className="t-set-row"><span className="t-set-label">Sync</span><span className={sync.state === "failed" ? "t-alrt-problem" : undefined}>{sync.state === "failed" ? "Not synced, retrying" : sync.state === "syncing" ? "Syncing…" : sync.at ? `In sync, ${new Date(sync.at).toLocaleTimeString()}` : "Waiting"}</span></div>
            </>
          ) : (
            <div className="t-set-row"><span className="t-set-label">Not signed in</span><span className="t-dim">Everything stays in this browser.</span><a className="t-chip" href="/t/account">Sign in or create an account</a></div>
          )}
          <div className="t-set-row"><span className="t-set-label">Welcome tour</span><span className="t-dim">What a new reader sees on a first visit.</span><a className="t-chip" href="/t/welcome">View the tour</a></div>
        </div>
      </Panel>

      <Panel code="SET" title="Kept on this device" area="kept" actions={
        <div className="t-alrt-actions">
          <button type="button" className="t-chip" onClick={exportAll}>Export everything</button>
          <button type="button" className="t-chip" onClick={() => file.current?.click()}>Restore from a file</button>
          <button type="button" className="t-chip t-alrt-delete" onClick={clearAll}>Clear everything</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(event) => { void importAll(event.target.files?.[0]); }} />
        </div>
      }>
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
                    <button type="button" className="t-chip" disabled={!sizes?.[item.name]} onClick={() => clear(item)}>Clear</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="t-study-note">Kept in this browser{account ? ", and on your account: sync follows you to every device" : ". Signed in to an account, the same copy follows you to every device"}. Export makes a file you can restore here or on another device.</p>
      </Panel>

      <Panel code="KEYS" title="Keyboard" area="keys">
        <div className="t-panel-pad t-set-body t-set-keys">
          <p><kbd>/</kbd> or any letter: the command line · <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd>: the command line from anywhere · <kbd>Esc</kbd>: close · <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd>: move through a table · <kbd>⌥1</kbd>…<kbd>⌥9</kbd>: the function keys on the bar.</p>
          <p>Type a ticker, then a function: <code>AAPL DES</code>, <code>DAL KPI</code>, <code>NVDA DCF</code>. On their own: {GLOBAL_FUNCTIONS.map((spec) => <code key={spec.code} title={spec.name}>{spec.code}</code>)}.</p>
          <p className="t-dim">Company functions: {COMPANY_FUNCTIONS.map((spec) => spec.code).join(" · ")}. <code>HELP</code> lists them all with what they do.</p>
        </div>
      </Panel>

      <Panel code="SET" id="set-about" title="About Tenqay" area="about">
        <div className="t-panel-pad t-about">
          <p>Filings and financial statements: SEC EDGAR. Prices: Yahoo Finance, may be delayed. Earnings dates, analysts&apos; consensus and the economic calendar: Nasdaq, labelled as forecasts wherever they appear. US official statistics: the Bureau of Labor Statistics. Treasury yields: the U.S. Treasury.</p>
          <p>Research information only, not investment advice.</p>
        </div>
      </Panel>

      {editing ? <WatchlistEditor tickers={watchlist} onClose={() => { setEditing(false); measure(); }} /> : null}
    </div>
  );
}
