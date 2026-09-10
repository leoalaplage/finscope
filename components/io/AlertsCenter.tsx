"use client";

import { useEffect, useState } from "react";
import { INSIDER_SHAPE, type InsiderRecord } from "@/lib/adapters/insiders";
import { IO_VIEW } from "@/lib/io/view-version";
import type { IoCompanyView } from "@/lib/io/view";
import { SUMMARY_SHAPE } from "@/lib/data-version";
import { QS_MODEL_VERSION } from "@/lib/qs/insight";
import { edgarUrl, percent, shortDate } from "./format";
import { parseTickers, useStoredWatchlist } from "./watchlist";

type AlertKind = "filing" | "insider" | "valuation" | "grade";
interface Rule { ticker: string; filing: boolean; insider: boolean; valuation: boolean; grade: boolean; yieldFloor: number }
interface Snapshot { filing: string | null; insider: string | null; grade: string | null; yieldAbove: boolean | null }
interface AlertEvent { id: string; ticker: string; kind: AlertKind; date: string; title: string; detail: string; href: string | null }
interface ScorePayload { grade?: string }

const RULES_KEY = "finscope.io.alert-rules.v1";
const SNAPSHOTS_KEY = "finscope.io.alert-snapshots.v1";
const EVENTS_KEY = "finscope.io.alert-events.v1";

const read = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Local alerts are best effort. */ } };

export function AlertsCenter() {
  const watchlist = useStoredWatchlist();
  const followed = watchlist.join(",");
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      const saved = read<Rule[]>(RULES_KEY, []);
      setRules(saved.length ? saved : followed.split(",").filter(Boolean).slice(0, 5).map((ticker) => ({ ticker, filing: true, insider: true, valuation: true, grade: true, yieldFloor: .04 })));
      setEvents(read<AlertEvent[]>(EVENTS_KEY, []));
    }, 0);
    return () => clearTimeout(timer);
  }, [followed]);

  const persistRules = (next: Rule[]) => { setRules(next); write(RULES_KEY, next); };
  const add = () => {
    const ticker = parseTickers(draft)[0]; if (!ticker || rules.some((rule) => rule.ticker === ticker) || rules.length >= 20) return;
    persistRules([...rules, { ticker, filing: true, insider: true, valuation: true, grade: true, yieldFloor: .04 }]); setDraft("");
  };
  const patchRule = (ticker: string, patch: Partial<Rule>) => persistRules(rules.map((rule) => rule.ticker === ticker ? { ...rule, ...patch } : rule));

  const check = async () => {
    setChecking(true); setMessage("Checking filed and market data");
    const previous = read<Record<string, Snapshot>>(SNAPSHOTS_KEY, {});
    const found: AlertEvent[] = [];
    const next: Record<string, Snapshot> = { ...previous };
    await Promise.all(rules.map(async (rule) => {
      try {
        const [viewResponse, insiderResponse, scoreResponse, quoteResponse] = await Promise.all([
          fetch(`/api/io/${encodeURIComponent(rule.ticker)}?view=${IO_VIEW}`),
          fetch(`/api/io/${encodeURIComponent(rule.ticker)}/insiders?v=${INSIDER_SHAPE}`),
          fetch(`/api/io/${encodeURIComponent(rule.ticker)}/score?v=${QS_MODEL_VERSION}.${SUMMARY_SHAPE}`),
          fetch(`/api/io/${encodeURIComponent(rule.ticker)}/quote`),
        ]);
        if (!viewResponse.ok) return;
        const view = await viewResponse.json() as IoCompanyView;
        const insiders = insiderResponse.ok ? await insiderResponse.json() as InsiderRecord : null;
        const score = scoreResponse.ok ? await scoreResponse.json() as ScorePayload : null;
        const quote = quoteResponse.ok ? await quoteResponse.json() as { price?: number; currency?: string } : null;
        const periods = [...view.annual, ...view.quarterly].sort((left, right) => (right.publishedAt || right.filingDate).localeCompare(left.publishedAt || left.filingDate));
        const filing = periods[0] ?? null;
        const deal = insiders?.transactions.filter((row) => row.kind === "open-market").sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
        const period = view.ttm ?? view.annual.at(-1) ?? null;
        const fcf = period?.values.freeCashFlow;
        const compatible = !quote?.currency || !view.basis?.currency || quote.currency === view.basis.currency;
        const fcfYield = compatible && fcf != null && view.basis?.shares && quote?.price ? fcf / (view.basis.shares * quote.price) : null;
        const snapshot: Snapshot = { filing: filing?.accession ?? null, insider: deal?.accession ?? null, grade: score?.grade ?? null, yieldAbove: fcfYield == null ? null : fcfYield >= rule.yieldFloor };
        const before = previous[rule.ticker];
        if (before && rule.filing && snapshot.filing && before.filing !== snapshot.filing && filing) found.push({ id: `${rule.ticker}-filing-${snapshot.filing}`, ticker: rule.ticker, kind: "filing", date: filing.publishedAt || filing.filingDate, title: `New ${filing.fiscalQuarter || filing.label} filing`, detail: `Period ended ${shortDate(filing.end)}`, href: edgarUrl(view.company.cik, filing.accession) });
        if (before && rule.insider && snapshot.insider && before.insider !== snapshot.insider && deal) found.push({ id: `${rule.ticker}-insider-${snapshot.insider}`, ticker: rule.ticker, kind: "insider", date: deal.date, title: `New insider ${deal.direction === "acquired" ? "purchase" : "sale"}`, detail: `${deal.owner} · ${deal.codeLabel}`, href: deal.sourceUrl });
        if (before && rule.grade && snapshot.grade && before.grade && before.grade !== snapshot.grade) found.push({ id: `${rule.ticker}-grade-${Date.now()}`, ticker: rule.ticker, kind: "grade", date: new Date().toISOString(), title: `Grade changed ${before.grade} → ${snapshot.grade}`, detail: "Fixed-scale FinScope quality score", href: `/s/${encodeURIComponent(rule.ticker)}#score` });
        if (before && rule.valuation && before.yieldAbove === false && snapshot.yieldAbove === true && fcfYield != null) found.push({ id: `${rule.ticker}-value-${Date.now()}`, ticker: rule.ticker, kind: "valuation", date: new Date().toISOString(), title: `FCF yield crossed ${percent(rule.yieldFloor, 1)}`, detail: `Now ${percent(fcfYield, 1)}`, href: `/s/${encodeURIComponent(rule.ticker)}#valuation-section` });
        next[rule.ticker] = snapshot;
      } catch { /* One unavailable company does not stop the other checks. */ }
    }));
    const merged = [...found, ...events].filter((event, index, all) => all.findIndex((candidate) => candidate.id === event.id) === index).sort((left, right) => right.date.localeCompare(left.date)).slice(0, 100);
    write(SNAPSHOTS_KEY, next); write(EVENTS_KEY, merged); setEvents(merged); setChecking(false);
    setMessage(found.length ? `${found.length} new ${found.length === 1 ? "alert" : "alerts"}` : Object.keys(previous).length ? "No new alert" : "Baseline saved — future changes will appear here");
  };

  return (
    <main className="wrap" id="main-content" tabIndex={-1}>
      <header className="head"><div className="head-row"><div><div className="head-id"><h1 className="head-ticker">Alerts</h1><p className="head-note">Local monitoring, sourced to the event</p></div><div className="head-meta"><span className="label">Nothing leaves this browser</span></div></div><button className="watchlist-save" type="button" onClick={check} disabled={checking}>{checking ? "Checking…" : "Check now"}</button></div></header>
      <section className="section alert-rules" style={{ borderTop: 0 }}>
        <div className="section-head"><h2 className="label">Rules</h2><span className="label" aria-live="polite">{message}</span></div>
        <div className="alert-add"><input aria-label="Ticker to monitor" value={draft} onChange={(event) => setDraft(event.target.value.toUpperCase())} placeholder="Ticker" /><button type="button" onClick={add}>Add company</button></div>
        <div className="alert-rule-list">{rules.map((rule) => <div className="alert-rule" key={rule.ticker}><a href={`/s/${encodeURIComponent(rule.ticker)}`}>{rule.ticker}</a>{(["filing", "insider", "grade", "valuation"] as AlertKind[]).map((kind) => <label key={kind}><input type="checkbox" checked={rule[kind]} onChange={(event) => patchRule(rule.ticker, { [kind]: event.target.checked })} />{kind}</label>)}<label>FCF yield ≥ <input type="number" min="0" max="50" step=".5" value={Number((rule.yieldFloor * 100).toFixed(1))} onChange={(event) => patchRule(rule.ticker, { yieldFloor: Math.max(0, Number(event.target.value) / 100) })} />%</label><button type="button" aria-label={`Remove ${rule.ticker}`} onClick={() => persistRules(rules.filter((entry) => entry.ticker !== rule.ticker))}>×</button></div>)}</div>
      </section>
      <section className="section"><div className="section-head"><h2 className="label">Event center</h2><span className="label">{events.length} kept</span></div>{events.length ? <ol className="alert-events">{events.map((event) => <li key={event.id}><time dateTime={event.date}>{shortDate(event.date)}</time><span>{event.kind}</span>{event.href ? <a href={event.href} target={event.href.startsWith("http") ? "_blank" : undefined} rel={event.href.startsWith("http") ? "noreferrer" : undefined}><strong>{event.ticker} · {event.title}</strong><small>{event.detail}</small></a> : <div><strong>{event.ticker} · {event.title}</strong><small>{event.detail}</small></div>}</li>)}</ol> : <div className="guided-empty"><strong>No change recorded yet</strong><p>Run the first check to save a baseline. The next check will surface new filings, open-market insider decisions, grade changes and valuation thresholds.</p><button type="button" onClick={check}>Create baseline</button></div>}</section>
    </main>
  );
}
