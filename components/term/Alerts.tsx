"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Alert, AlertKind } from "@/lib/alerts";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { useStoredHoldings } from "@/components/io/holdings";
import { useThesisNotes, type ThesisNote } from "@/components/io/thesis";
import { price as writePrice, shortDate } from "@/components/io/format";
import { Panel } from "./Panel";

/**
 * ALRT: what changed for the companies a reader follows — their watchlist,
 * their holdings and the companies they have written a note on. Filings and
 * insider purchases from the server (lib/alerts.ts); the price alerts here, in
 * the browser, against the levels and the values the reader's own notes keep.
 * Counted in the top bar since the last visit to this page, and announced by
 * the browser while the terminal is open, where the reader asks for it.
 */

const SEEN_KEY = "finscope.io.alerts-seen.v1";
const NOTIFY_KEY = "finscope.io.alerts-notify.v1";
const EVENT = "finscope:alerts";
const REFRESH_MS = 10 * 60_000;
const KINDS: Record<AlertKind | "price", string> = {
  price: "Price", results: "Results", report: "Report", leadership: "Leadership", flag: "Flag", insider: "Insider buy", deal: "Deal",
};

const readKey = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeKey = (key: string, value: string) => { try { localStorage.setItem(key, value); window.dispatchEvent(new Event(EVENT)); } catch { /* Not kept. */ } };
const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify); window.addEventListener("storage", notify);
  return () => { window.removeEventListener(EVENT, notify); window.removeEventListener("storage", notify); };
};
const useKey = (key: string) => useSyncExternalStore(subscribe, () => readKey(key), () => null);

/** Every ticker the reader follows: watchlist, holdings, notes. */
function useFollowed(): string[] {
  const watchlist = useStoredWatchlist();
  const holdings = useStoredHoldings();
  const notes = useThesisNotes();
  return useMemo(() => [...new Set([...watchlist, ...holdings.map((position) => position.ticker), ...notes.map((note) => note.ticker)])].sort(), [watchlist, holdings, notes]);
}

interface PriceAlert { ticker: string; kind: "price"; at: string; title: string; detail: string | null; url: string }

/** The filing alerts of the last two weeks and the price alerts of now, refreshed every ten minutes. */
function useAlerts(): { alerts: Array<Alert | PriceAlert>; loading: boolean; followed: string[] } {
  const followed = useFollowed();
  const notes = useThesisNotes();
  const [answer, setAnswer] = useState<{ key: string; alerts: Alert[]; prices: Record<string, number> } | null>(null);
  const key = followed.join(",");
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const load = async () => {
      const [alerts, movers] = await Promise.all([
        fetch(`/api/alerts?tickers=${encodeURIComponent(key)}&since=${since}`, { signal: controller.signal }).then((response) => (response.ok ? response.json() as Promise<{ alerts: Alert[] }> : null)).catch(() => null),
        fetch(`/api/movers?tickers=${encodeURIComponent(key)}`, { signal: controller.signal }).then((response) => (response.ok ? response.json() as Promise<{ watchlist?: Array<{ symbol: string; price: number | null }> }> : null)).catch(() => null),
      ]);
      if (controller.signal.aborted) return;
      const prices = Object.fromEntries((movers?.watchlist ?? []).filter((quote) => quote.price != null).map((quote) => [quote.symbol.toUpperCase(), quote.price!]));
      setAnswer({ key, alerts: alerts?.alerts ?? [], prices });
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [key]);

  const current = answer?.key === key ? answer : null;
  const priceAlerts = useMemo(() => (current ? priceAlertsFrom(notes, current.prices) : []), [current, notes]);
  const alerts = useMemo(() => [...priceAlerts, ...(current?.alerts ?? [])], [priceAlerts, current]);
  return { alerts, loading: !!key && !current, followed };
}

/** Each noted company's price against the levels and the value its newest note keeps. */
function priceAlertsFrom(notes: ThesisNote[], prices: Record<string, number>): PriceAlert[] {
  const newest = new Map<string, ThesisNote>();
  for (const note of notes) if (!newest.has(note.ticker)) newest.set(note.ticker, note);
  const now = new Date().toISOString();
  return [...newest.values()].flatMap((note): PriceAlert[] => {
    const price = prices[note.ticker];
    if (price == null) return [];
    const at = now;
    const base = { ticker: note.ticker, kind: "price" as const, at, url: `/t/s/${encodeURIComponent(note.ticker)}#note` };
    const currency = note.currency;
    const out: PriceAlert[] = [];
    const levels = notes.find((entry) => entry.ticker === note.ticker && (entry.buyBelow != null || entry.sellAbove != null));
    if (levels?.buyBelow != null && price <= levels.buyBelow) out.push({ ...base, title: `Below your level of ${writePrice(levels.buyBelow, currency)}`, detail: `At ${writePrice(price, currency)}` });
    if (levels?.sellAbove != null && price >= levels.sellAbove) out.push({ ...base, title: `Above your level of ${writePrice(levels.sellAbove, currency)}`, detail: `At ${writePrice(price, currency)}` });
    if (note.fairValue != null && note.price != null) {
      if (note.price < note.fairValue && price >= note.fairValue) out.push({ ...base, title: "Reached the value in your note", detail: `${writePrice(price, currency)} against ${writePrice(note.fairValue, currency)} on ${shortDate(note.written)}` });
      if (note.price > note.fairValue && price <= note.fairValue) out.push({ ...base, title: "Fell to the value in your note", detail: `${writePrice(price, currency)} against ${writePrice(note.fairValue, currency)} on ${shortDate(note.written)}` });
    }
    return out;
  });
}

/** In the top bar: how many alerts since the last visit to ALRT, and the browser's notifications where asked for. */
export function AlertsChip() {
  const { alerts } = useAlerts();
  const seen = useKey(SEEN_KEY);
  const notify = useKey(NOTIFY_KEY) === "on";
  const fresh = alerts.filter((alert) => !seen || alert.at > seen);
  useEffect(() => {
    if (!notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    let told: string[] = [];
    try { told = JSON.parse(sessionStorage.getItem("finscope.alerts-told") ?? "[]") as string[]; } catch { told = []; }
    const id = (alert: Alert | PriceAlert) => `${alert.ticker}|${alert.kind}|${alert.title}|${alert.kind === "price" ? "" : alert.at}`;
    for (const alert of fresh.filter((entry) => !told.includes(id(entry))).slice(0, 5)) {
      new Notification(`${alert.ticker} · ${KINDS[alert.kind]}`, { body: `${alert.title}${alert.detail ? ` — ${alert.detail}` : ""}`, tag: id(alert) });
      told.push(id(alert));
    }
    try { sessionStorage.setItem("finscope.alerts-told", JSON.stringify(told.slice(-200))); } catch { /* Told again next session. */ }
  }, [fresh, notify]);
  return (
    <a href="/t/alerts" className="t-alerts-chip" data-fresh={fresh.length > 0 || undefined} title="Alerts on the companies you follow">
      ALRT{fresh.length ? <b>{fresh.length}</b> : null}
    </a>
  );
}

/** The ALRT page. */
export function Alerts() {
  const { alerts, loading, followed } = useAlerts();
  const seen = useKey(SEEN_KEY);
  const notify = useKey(NOTIFY_KEY) === "on";
  const [kind, setKind] = useState<AlertKind | "price" | "all">("all");
  // Opening the page is reading it: the count in the top bar starts again from now.
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => writeKey(SEEN_KEY, new Date().toISOString()), 1500);
    return () => clearTimeout(timer);
  }, [loading]);
  const toggleNotify = async () => {
    if (notify) { writeKey(NOTIFY_KEY, "off"); return; }
    if (typeof Notification === "undefined") return;
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission === "granted") writeKey(NOTIFY_KEY, "on");
  };
  const shown = alerts.filter((alert) => kind === "all" || alert.kind === kind);
  const kinds = [...new Set(alerts.map((alert) => alert.kind))];

  return (
    <div className="t-grid t-insb">
      <Panel code="ALRT" title={`Alerts · ${followed.length} companies you follow`} actions={
        <button type="button" className="t-chip" aria-pressed={notify} onClick={() => { void toggleNotify(); }}>
          {notify ? "Browser notifications on" : "Notify me in this browser"}
        </button>
      }>
        <div className="t-panel-pad t-insb-body">
          {!followed.length ? <p className="t-empty">Follow companies (watchlist, portfolio or a note) to be alerted on them.</p> : loading ? <p className="t-empty">Reading the filings of the companies you follow…</p> : (
            <>
              <div className="seg" role="group" aria-label="Kind">
                <button type="button" aria-pressed={kind === "all"} onClick={() => setKind("all")}>All <span>{alerts.length}</span></button>
                {kinds.map((entry) => <button key={entry} type="button" aria-pressed={kind === entry} onClick={() => setKind(entry)}>{KINDS[entry]} <span>{alerts.filter((alert) => alert.kind === entry).length}</span></button>)}
              </div>
              {shown.length ? (
                <div className="sheet">
                  <table>
                    <thead><tr><th className="key">When</th><th>Stock</th><th>Kind</th><th>What</th><th aria-label="Source" /></tr></thead>
                    <tbody>
                      {shown.map((alert, index) => (
                        <tr key={`${alert.ticker}-${alert.kind}-${alert.at}-${index}`} data-fresh={!seen || alert.at > seen || undefined} data-kind={alert.kind}>
                          <td className="key">{alert.kind === "price" ? "Now" : shortDate(alert.at.slice(0, 10))}</td>
                          <td><a href={`/t/s/${encodeURIComponent(alert.ticker)}`}>{alert.ticker}</a></td>
                          <td><span className="events-kind" data-kind={alert.kind === "flag" ? "governance" : alert.kind === "insider" ? "financing" : alert.kind === "price" ? "deals" : "results"}>{KINDS[alert.kind]}</span></td>
                          <td>{alert.title}{alert.detail ? <span className="t-dim"> · {alert.detail}</span> : null}</td>
                          <td><a href={alert.url} target={alert.url.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{alert.url.startsWith("http") ? "SEC ↗" : "Note"}</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="t-empty">Nothing in the last two weeks for the companies you follow.</p>}
              <p className="t-study-note">Filings of the last two weeks (results, reports, leadership changes, deals and red flags) and insider purchases, for your watchlist, your holdings and the companies you have noted; price alerts against the levels and the DCF values your notes keep. Checked every ten minutes while the terminal is open. Kept in this browser.</p>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
