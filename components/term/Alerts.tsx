"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Alert } from "@/lib/alerts";
import type { EconEvent } from "@/lib/econ";
import {
  describeRule, ECON_TOPICS, evaluate, FILING_KINDS, newRule, parseRules, quoteTickers, ruleTickers, RULES_KEY,
  type AlertRule, type Fired, type FilingKind, type RuleType,
} from "@/lib/alert-rules";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { useStoredHoldings } from "@/components/io/holdings";
import { useThesisNotes, type ThesisNote } from "@/components/io/thesis";
import { useAccount } from "@/components/io/account";
import { price as writePrice, shortDate } from "@/components/io/format";
import { Panel } from "./Panel";

/**
 * ALRT: the reader's alerts as rules they make, change, pause and delete
 * (lib/alert-rules.ts) — a price crossing a level, a big move, the filings
 * and insider purchases of a company or of everything they follow, the US
 * economic releases — and what those rules caught. Counted in the top bar
 * since the last visit here, announced by the browser where asked, and sent
 * by email for the rules marked so (lib/email-alerts.ts). The levels kept in
 * the reader's notes keep alerting as before.
 */

const SEEN_KEY = "finscope.io.alerts-seen.v1";
const NOTIFY_KEY = "finscope.io.alerts-notify.v1";
const EVENT = "finscope:alerts";
const REFRESH_MS = 5 * 60_000;
const KINDS: Record<Fired["kind"] | "note", string> = {
  price: "Price", move: "Big move", econ: "Economy", note: "Your note",
  results: "Results", report: "Report", leadership: "Leadership", flag: "Red flag", insider: "Insider buy", deal: "Deal",
};
const TYPES: Array<{ id: RuleType; label: string; hint: string }> = [
  { id: "price", label: "Price", hint: "When a stock rises above or falls below a price." },
  { id: "move", label: "Big move", hint: "When a stock moves more than a set percentage in a day." },
  { id: "filings", label: "Filings", hint: "Results, reports, leadership changes, deals and red flags filed with the SEC." },
  { id: "insider", label: "Insider buying", hint: "Officers and directors buying their own company's shares." },
  { id: "econ", label: "Economy", hint: "US releases: inflation, jobs, the Fed, retail sales, GDP…" },
];

const readKey = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeKey = (key: string, value: string) => { try { localStorage.setItem(key, value); window.dispatchEvent(new Event(EVENT)); } catch { /* Not kept. */ } };
const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify); window.addEventListener("storage", notify);
  return () => { window.removeEventListener(EVENT, notify); window.removeEventListener("storage", notify); };
};
const useKey = (key: string) => useSyncExternalStore(subscribe, () => readKey(key), () => null);

/** The reader's rules, and how to change them. */
function useRules(): [AlertRule[], (next: AlertRule[]) => void] {
  const raw = useKey(RULES_KEY);
  const rules = useMemo(() => parseRules(raw), [raw]);
  return [rules, (next) => writeKey(RULES_KEY, JSON.stringify(next))];
}

/** Every ticker the reader follows: watchlist, holdings, notes. */
function useFollowed(): string[] {
  const watchlist = useStoredWatchlist();
  const holdings = useStoredHoldings();
  const notes = useThesisNotes();
  return useMemo(() => [...new Set([...watchlist, ...holdings.map((position) => position.ticker), ...notes.map((note) => note.ticker)])].sort(), [watchlist, holdings, notes]);
}

type Caught = Fired | (Omit<Fired, "kind" | "ruleId"> & { kind: "note"; ruleId: null });

/** What the rules catch now, read again every five minutes. */
function useCaught(): { caught: Caught[]; loading: boolean; followed: string[]; rules: AlertRule[]; setRules: (next: AlertRule[]) => void } {
  const followed = useFollowed();
  const notes = useThesisNotes();
  const [rules, setRules] = useRules();
  const [answer, setAnswer] = useState<{ key: string; alerts: Alert[]; quotes: Record<string, { price: number | null; changePercent: number | null }>; econ: EconEvent[] } | null>(null);
  const filingTickers = ruleTickers(rules, followed).slice(0, 60);
  const priced = [...new Set([...quoteTickers(rules), ...notes.map((note) => note.ticker)])];
  const wantsEcon = rules.some((rule) => rule.enabled && rule.type === "econ");
  const key = `${filingTickers.join(",")}|${priced.join(",")}|${wantsEcon}`;

  useEffect(() => {
    const controller = new AbortController();
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const json = <T,>(url: string) => fetch(url, { signal: controller.signal }).then((response) => (response.ok ? response.json() as Promise<T> : null)).catch(() => null);
    const load = async () => {
      const [alerts, movers, econ] = await Promise.all([
        filingTickers.length ? json<{ alerts: Alert[] }>(`/api/alerts?tickers=${encodeURIComponent(filingTickers.join(","))}&since=${since}`) : null,
        priced.length ? json<{ watchlist?: Array<{ symbol: string; price: number | null; changePercent?: number | null }> }>(`/api/movers?tickers=${encodeURIComponent(priced.join(","))}`) : null,
        wantsEcon ? json<{ events: EconEvent[] }>("/api/econ") : null,
      ]);
      if (controller.signal.aborted) return;
      const quotes = Object.fromEntries((movers?.watchlist ?? []).map((quote) => [quote.symbol.toUpperCase(), { price: quote.price, changePercent: quote.changePercent ?? null }]));
      setAnswer({ key, alerts: alerts?.alerts ?? [], quotes, econ: econ?.events ?? [] });
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
    // The key stands for the lists it is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = answer?.key === key ? answer : null;
  const fired = useMemo(() => (current ? evaluate(rules, { followed, alerts: current.alerts, quotes: current.quotes, econ: current.econ, now: new Date() }) : []), [current, rules, followed]);
  const fromNotes = useMemo(() => (current ? noteLevels(notes, current.quotes) : []), [current, notes]);

  // A price alert fires once: marked as fired the first time it is seen, until the reader sets it again.
  useEffect(() => {
    const spent = new Set(fired.filter((entry) => entry.kind === "price").map((entry) => entry.ruleId));
    if (!spent.size) return;
    const now = new Date().toISOString();
    if (rules.some((rule) => spent.has(rule.id) && (rule.firedAt == null || (rule.armedAt != null && rule.armedAt > rule.firedAt)))) {
      setRules(rules.map((rule) => (spent.has(rule.id) ? { ...rule, firedAt: now } : rule)));
    }
  }, [fired, rules, setRules]);

  const caught = useMemo(() => [...fromNotes, ...fired].sort((left, right) => right.at.localeCompare(left.at)), [fromNotes, fired]);
  return { caught, loading: (filingTickers.length > 0 || priced.length > 0 || wantsEcon) && !current, followed, rules, setRules };
}

/** Each noted company's price against the levels and the value its newest note keeps. */
function noteLevels(notes: ThesisNote[], quotes: Record<string, { price: number | null }>): Caught[] {
  const newest = new Map<string, ThesisNote>();
  for (const note of notes) if (!newest.has(note.ticker)) newest.set(note.ticker, note);
  const now = new Date().toISOString();
  return [...newest.values()].flatMap((note): Caught[] => {
    const price = quotes[note.ticker]?.price;
    if (price == null) return [];
    const base = { ticker: note.ticker, kind: "note" as const, ruleId: null, at: now, url: `/t/s/${encodeURIComponent(note.ticker)}#note` };
    const currency = note.currency;
    const out: Caught[] = [];
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

const idOf = (alert: Caught) => `${alert.ticker}|${alert.kind}|${alert.title}|${alert.kind === "note" || alert.kind === "price" ? "" : alert.at}`;

/** In the top bar: how many alerts since the last visit to ALRT, and the browser's notifications where asked for. */
export function AlertsChip() {
  const { caught, rules } = useCaught();
  const seen = useKey(SEEN_KEY);
  const notify = useKey(NOTIFY_KEY) === "on";
  const fresh = caught.filter((alert) => !seen || alert.at > seen);
  useEffect(() => {
    if (!notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    let told: string[] = [];
    try { told = JSON.parse(sessionStorage.getItem("finscope.alerts-told") ?? "[]") as string[]; } catch { told = []; }
    const browser = new Set(rules.filter((rule) => rule.channels.browser).map((rule) => rule.id));
    for (const alert of fresh.filter((entry) => !told.includes(idOf(entry)) && (entry.ruleId == null || browser.has(entry.ruleId))).slice(0, 5)) {
      new Notification(`${alert.ticker ?? "US economy"} · ${KINDS[alert.kind]}`, { body: `${alert.title}${alert.detail ? ` — ${alert.detail}` : ""}`, tag: idOf(alert) });
      told.push(idOf(alert));
    }
    try { sessionStorage.setItem("finscope.alerts-told", JSON.stringify(told.slice(-200))); } catch { /* Told again next session. */ }
  }, [fresh, notify, rules]);
  return (
    <a href="/t/alerts" className="t-alerts-chip" data-fresh={fresh.length > 0 || undefined} title="Your alerts">
      ALRT{fresh.length ? <b>{fresh.length}</b> : null}
    </a>
  );
}

/** On HOME: what the alerts caught, the newest first, and how many since the last visit to ALRT. */
export function AlertsBrief() {
  const { caught, loading, rules } = useCaught();
  const seen = useKey(SEEN_KEY);
  const active = rules.filter((rule) => rule.enabled).length;
  if (!rules.length && !caught.length) return <p className="t-empty">No alerts set. <a href="/t/alerts">Create one on ALRT</a>: a price, a big move, filings, insider buying or a US release.</p>;
  if (loading) return <p className="t-empty">Reading what your alerts watch…</p>;
  const fresh = caught.filter((alert) => !seen || alert.at > seen).length;
  const today = new Date().toISOString().slice(0, 10);
  const todays = caught.filter((alert) => alert.at.slice(0, 10) === today).length;
  return (
    <div className="t-alrt-brief">
      <p className="t-alrt-brief-counts">
        <span><b className={fresh ? "t-amber" : undefined}>{fresh}</b> new</span>
        <span><b>{todays}</b> today</span>
        <span><b>{caught.length}</b> triggered</span>
        <span className="t-dim">{active} of {rules.length} alerts on</span>
      </p>
      {caught.length ? (
        <div className="sheet">
          <table>
            <tbody>
              {caught.slice(0, 6).map((alert, index) => (
                <tr key={`${idOf(alert)}-${index}`} data-fresh={!seen || alert.at > seen || undefined}>
                  <td className="key">{alert.ticker ? <a href={`/t/s/${encodeURIComponent(alert.ticker)}`}>{alert.ticker}</a> : <a href="/t/eco">US</a>}</td>
                  <td className="t-dim">{KINDS[alert.kind]}</td>
                  <td className="t-alrt-brief-what">{alert.title}</td>
                  <td className="t-dim">{alert.kind === "note" || alert.kind === "price" ? "now" : alert.kind === "move" ? "today" : shortDate(alert.at.slice(0, 10))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="t-empty">Nothing triggered in the last two weeks.</p>}
      <p className="t-study-note"><a href="/t/alerts">All alerts and rules · ALRT</a></p>
    </div>
  );
}

/** The ALRT screen. */
export function Alerts() {
  const { caught, loading, followed, rules, setRules } = useCaught();
  const { account } = useAccount();
  const seen = useKey(SEEN_KEY);
  const notify = useKey(NOTIFY_KEY) === "on";
  const [tab, setTab] = useState<"caught" | "rules">("caught");
  const [kind, setKind] = useState<Caught["kind"] | "all">("all");
  const [editing, setEditing] = useState<AlertRule | null>(null);

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
  const save = (rule: AlertRule) => {
    const exists = rules.some((entry) => entry.id === rule.id);
    setRules(exists ? rules.map((entry) => (entry.id === rule.id ? rule : entry)) : [rule, ...rules]);
    setEditing(null); setTab("rules");
  };
  const update = (id: string, change: Partial<AlertRule>) => setRules(rules.map((rule) => (rule.id === id ? { ...rule, ...change } : rule)));
  const remove = (rule: AlertRule) => { if (window.confirm(`Delete this alert?\n${describeRule(rule)}`)) setRules(rules.filter((entry) => entry.id !== rule.id)); };

  const shown = caught.filter((alert) => kind === "all" || alert.kind === kind);
  const kinds = [...new Set(caught.map((alert) => alert.kind))];
  const ruleOf = new Map(rules.map((rule) => [rule.id, rule]));
  const emailReady = !!account?.email?.verified;

  return (
    <div className="t-grid t-insb">
      <Panel code="ALRT" title="Alerts" actions={
        <div className="t-alrt-actions">
          <div className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={tab === "caught"} onClick={() => setTab("caught")}>Triggered <span>{caught.length}</span></button>
            <button type="button" aria-pressed={tab === "rules"} onClick={() => setTab("rules")}>My alerts <span>{rules.length}</span></button>
          </div>
          <button type="button" className="t-chip t-alrt-new" onClick={() => setEditing(newRule("price", followed[0] ?? null))}>+ New alert</button>
          <button type="button" className="t-chip" aria-pressed={notify} onClick={() => { void toggleNotify(); }}>{notify ? "Browser notifications on" : "Notify me in this browser"}</button>
        </div>
      }>
        <div className="t-panel-pad t-insb-body">
          {editing ? <RuleEditor key={editing.id} rule={editing} isNew={!rules.some((entry) => entry.id === editing.id)} followed={followed} emailReady={emailReady} signedIn={!!account} onSave={save} onCancel={() => setEditing(null)} /> : null}

          {tab === "caught" ? (
            loading ? <p className="t-empty">Reading the filings, prices and releases your alerts watch…</p> : (
              <>
                <div className="seg" role="group" aria-label="Kind">
                  <button type="button" aria-pressed={kind === "all"} onClick={() => setKind("all")}>All <span>{caught.length}</span></button>
                  {kinds.map((entry) => <button key={entry} type="button" aria-pressed={kind === entry} onClick={() => setKind(entry)}>{KINDS[entry]} <span>{caught.filter((alert) => alert.kind === entry).length}</span></button>)}
                </div>
                {shown.length ? (
                  <div className="sheet">
                    <table>
                      <thead><tr><th className="key">When</th><th>Stock</th><th>Kind</th><th>What</th><th>Alert</th><th aria-label="Source" /></tr></thead>
                      <tbody>
                        {shown.map((alert, index) => (
                          <tr key={`${idOf(alert)}-${index}`} data-fresh={!seen || alert.at > seen || undefined} data-kind={alert.kind}>
                            <td className="key">{alert.kind === "note" || alert.kind === "price" ? "Now" : alert.kind === "move" ? "Today" : shortDate(alert.at.slice(0, 10))}</td>
                            <td>{alert.ticker ? <a href={`/t/s/${encodeURIComponent(alert.ticker)}`}>{alert.ticker}</a> : <a href="/t/eco">US</a>}</td>
                            <td><span className="events-kind" data-kind={alert.kind === "flag" ? "governance" : alert.kind === "insider" ? "financing" : alert.kind === "price" || alert.kind === "move" || alert.kind === "note" ? "deals" : "results"}>{KINDS[alert.kind]}</span></td>
                            <td>{alert.title}{alert.detail ? <span className="t-dim"> · {alert.detail}</span> : null}</td>
                            <td className="t-dim">{alert.ruleId && ruleOf.get(alert.ruleId) ? <button type="button" className="t-alrt-link" onClick={() => setEditing(ruleOf.get(alert.ruleId!)!)}>Edit alert</button> : alert.kind === "note" ? "From your note" : ""}</td>
                            <td><a href={alert.url} target={alert.url.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{alert.url.startsWith("http") ? "SEC ↗" : "Open"}</a></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="t-empty">{rules.some((rule) => rule.enabled) ? "Nothing caught in the last two weeks." : "Every alert is paused or deleted. Add one with + New alert."}</p>}
                <p className="t-study-note">Filings and insider purchases of the last two weeks, prices and moves as they stand, US releases of the last week, for the alerts under My alerts{followed.length ? `; "everything you follow" is ${followed.length} companies (watchlists, portfolio, notes)` : ""}. Checked every five minutes while the terminal is open.</p>
              </>
            )
          ) : (
            <RuleList rules={rules} onEdit={setEditing} onToggle={(rule) => update(rule.id, { enabled: !rule.enabled })} onRearm={(rule) => update(rule.id, { armedAt: new Date().toISOString() })} onDelete={remove}
              onReset={() => { if (window.confirm("Replace your alerts with the three default ones?")) setRules(parseRules(null)); }} />
          )}
        </div>
      </Panel>
    </div>
  );
}

function RuleList({ rules, onEdit, onToggle, onRearm, onDelete, onReset }: {
  rules: AlertRule[]; onEdit: (rule: AlertRule) => void; onToggle: (rule: AlertRule) => void; onRearm: (rule: AlertRule) => void; onDelete: (rule: AlertRule) => void; onReset: () => void;
}) {
  if (!rules.length) return <p className="t-empty">No alerts. Add one with + New alert, or <button type="button" className="t-alrt-link" onClick={onReset}>bring back the defaults</button>.</p>;
  return (
    <>
      <div className="sheet t-alrt-rules">
        <table>
          <thead><tr><th className="key">On</th><th>Type</th><th>Alert</th><th>Sent to</th><th>Status</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rules.map((rule) => {
              const spent = rule.type === "price" && rule.firedAt != null && (!rule.armedAt || rule.armedAt <= rule.firedAt);
              return (
                <tr key={rule.id} data-off={!rule.enabled || undefined}>
                  <td className="key"><label className="t-alrt-switch"><input type="checkbox" checked={rule.enabled} onChange={() => onToggle(rule)} aria-label={rule.enabled ? "Pause this alert" : "Turn this alert on"} /><span aria-hidden="true" /></label></td>
                  <td>{TYPES.find((type) => type.id === rule.type)?.label}</td>
                  <td>{rule.label ? <b>{rule.label} · </b> : null}{describeRule(rule)}</td>
                  <td className="t-dim">{[rule.channels.browser ? "Terminal" : null, rule.channels.email ? "Email" : null].filter(Boolean).join(" · ") || "Nowhere"}</td>
                  <td>{!rule.enabled ? <span className="t-dim">Paused</span> : spent ? <span className="t-alrt-fired">Triggered {shortDate(rule.firedAt!.slice(0, 10))}</span> : <span className="t-dim">Watching</span>}</td>
                  <td className="t-alrt-row-actions">
                    <div>
                      {spent ? <button type="button" className="t-chip" onClick={() => onRearm(rule)}>Set again</button> : null}
                      <button type="button" className="t-chip" onClick={() => onEdit(rule)}>Edit</button>
                      <button type="button" className="t-chip t-alrt-delete" onClick={() => onDelete(rule)}>Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="t-study-note">Your alerts are kept in this browser, and on your account when signed in. Levels in your notes (NOTE on a company) alert as well. <button type="button" className="t-alrt-link" onClick={onReset}>Reset to the defaults</button></p>
    </>
  );
}

function RuleEditor({ rule, isNew, followed, emailReady, signedIn, onSave, onCancel }: {
  rule: AlertRule; isNew: boolean; followed: string[]; emailReady: boolean; signedIn: boolean; onSave: (rule: AlertRule) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<AlertRule>(rule);
  const [tickerText, setTickerText] = useState(rule.ticker ?? "");
  const set = (change: Partial<AlertRule>) => setDraft((current) => ({ ...current, ...change }));
  const changeType = (type: RuleType) => {
    const fresh = newRule(type, draft.ticker);
    setDraft({ ...fresh, id: draft.id, created: draft.created, enabled: draft.enabled, channels: draft.channels, ticker: type === "econ" ? null : (type === "price" || type === "move") ? (draft.ticker ?? followed[0] ?? null) : draft.ticker });
    if (type === "econ") setTickerText("");
  };
  const needsTicker = draft.type === "price" || draft.type === "move";
  const allowsAll = draft.type === "filings" || draft.type === "insider";
  const ticker = tickerText.trim().toUpperCase();
  const tickerOk = /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker);
  const problem = needsTicker && !tickerOk ? "Name the stock."
    : draft.type === "price" && !(draft.level != null && draft.level > 0) ? "Set the price."
    : draft.type === "move" && !(draft.movePct != null && draft.movePct > 0) ? "Set the size of the move."
    : draft.type === "filings" && !(draft.kinds?.length) ? "Choose at least one kind of filing."
    : draft.type === "econ" && !(draft.topics?.length) ? "Choose at least one release."
    : !draft.channels.browser && !draft.channels.email ? "Choose where to be told."
    : null;
  const submit = () => {
    if (problem) return;
    onSave({ ...draft, ticker: draft.type === "econ" ? null : allowsAll && !ticker ? null : ticker, ...(rule.firedAt && draft.type === "price" && (draft.level !== rule.level || draft.direction !== rule.direction) ? { armedAt: new Date().toISOString() } : {}) });
  };

  return (
    <form className="t-alrt-editor" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <h3>{isNew ? "New alert" : "Edit alert"} · {TYPES.find((type) => type.id === draft.type)?.label}</h3>
      <div className="seg" role="group" aria-label="Type of alert">
        {TYPES.map((type) => <button key={type.id} type="button" aria-pressed={draft.type === type.id} onClick={() => changeType(type.id)}>{type.label}</button>)}
      </div>
      <p className="t-dim t-alrt-hint">{TYPES.find((type) => type.id === draft.type)?.hint}</p>

      <div className="t-alrt-fields">
        {draft.type !== "econ" ? (
          <label>
            <span>{allowsAll ? "Company (empty: everything you follow)" : "Company"}</span>
            <input value={tickerText} placeholder={allowsAll ? "All you follow" : "AAPL"} list="t-alrt-followed" onChange={(event) => setTickerText(event.target.value)} autoComplete="off" spellCheck={false} />
            <datalist id="t-alrt-followed">{followed.map((entry) => <option key={entry} value={entry} />)}</datalist>
          </label>
        ) : null}

        {draft.type === "price" ? (
          <>
            <label><span>When it</span>
              <select value={draft.direction} onChange={(event) => set({ direction: event.target.value as "above" | "below" })}>
                <option value="above">rises above</option><option value="below">falls below</option>
              </select>
            </label>
            <label><span>Price ($)</span><input inputMode="decimal" value={draft.level ?? ""} placeholder="250" onChange={(event) => { const value = Number(event.target.value.replace(/[^0-9.]/g, "")); set({ level: event.target.value.trim() && Number.isFinite(value) && value > 0 ? value : undefined }); }} /></label>
          </>
        ) : null}

        {draft.type === "move" ? (
          <label><span>A day&apos;s move of at least (%)</span><input inputMode="decimal" value={draft.movePct ?? ""} placeholder="5" onChange={(event) => { const value = Number(event.target.value.replace(/[^0-9.]/g, "")); set({ movePct: Number.isFinite(value) && value > 0 ? value : undefined }); }} /></label>
        ) : null}

        {draft.type === "insider" ? (
          <label><span>Purchases from ($)</span><input inputMode="numeric" value={draft.minValue ?? 0} onChange={(event) => { const value = Number(event.target.value.replace(/[^0-9]/g, "")); set({ minValue: Number.isFinite(value) ? value : 0 }); }} /></label>
        ) : null}
      </div>

      {draft.type === "filings" ? (
        <fieldset className="t-alrt-checks"><legend>Which filings</legend>
          {FILING_KINDS.map((entry) => (
            <label key={entry.id}><input type="checkbox" checked={draft.kinds?.includes(entry.id) ?? false} onChange={(event) => set({ kinds: event.target.checked ? [...(draft.kinds ?? []), entry.id] : (draft.kinds ?? []).filter((kind: FilingKind) => kind !== entry.id) })} />{entry.label}</label>
          ))}
        </fieldset>
      ) : null}

      {draft.type === "econ" ? (
        <>
          <fieldset className="t-alrt-checks"><legend>Which releases</legend>
            {ECON_TOPICS.map((entry) => (
              <label key={entry.id}><input type="checkbox" checked={draft.topics?.includes(entry.id) ?? false} onChange={(event) => set({ topics: event.target.checked ? [...(draft.topics ?? []), entry.id] : (draft.topics ?? []).filter((topic) => topic !== entry.id) })} />{entry.label}</label>
            ))}
          </fieldset>
          <label className="t-alrt-inline"><input type="checkbox" checked={draft.onlySurprise ?? false} onChange={(event) => set({ onlySurprise: event.target.checked })} />Only when the print misses the economists&apos; consensus</label>
        </>
      ) : null}

      <div className="t-alrt-fields">
        <label><span>Name (optional)</span><input value={draft.label ?? ""} maxLength={80} placeholder="e.g. Buy zone" onChange={(event) => set({ label: event.target.value })} /></label>
      </div>

      <fieldset className="t-alrt-checks"><legend>Tell me</legend>
        <label><input type="checkbox" checked={draft.channels.browser} onChange={(event) => set({ channels: { ...draft.channels, browser: event.target.checked } })} />In the terminal and as a browser notification</label>
        <label><input type="checkbox" checked={draft.channels.email} onChange={(event) => set({ channels: { ...draft.channels, email: event.target.checked } })} />In the daily email</label>
        {draft.channels.email && !emailReady ? <span className="t-dim t-alrt-hint">{signedIn ? "Confirm an email address on your account to receive it." : "Sign in and confirm an email address to receive it."} <a href="/t/account#alerts">Account</a></span> : null}
      </fieldset>

      <div className="t-alrt-editor-actions">
        {problem ? <span className="t-alrt-problem">{problem}</span> : <span className="t-dim">{describeRule({ ...draft, ticker: draft.type === "econ" ? null : ticker || null })}</span>}
        <button type="button" className="t-chip" onClick={onCancel}>Cancel</button>
        <button type="submit" className="t-chip t-alrt-new" disabled={problem != null}>Save alert</button>
      </div>
    </form>
  );
}
