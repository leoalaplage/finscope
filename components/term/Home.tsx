"use client";

import { useEffect, useMemo, useState } from "react";
import type { Position } from "@/lib/portfolio";
import type { FedWatch } from "@/lib/fedwatch";
import type { Rates } from "@/lib/rates";
import type { Signal, Signals } from "@/lib/home-signals";
import type { EconEvent, Reaction } from "@/lib/econ";
import { phaseAt, sessionSummary, type Phase } from "@/lib/session-summary";
import { EARNINGS_DAY_SHAPE, type ReportTime } from "@/lib/adapters/nasdaq-earnings";
import { delta, money, price, shortDate } from "@/components/io/format";
import type { Tape } from "./quotes";

/**
 * What HOME reads beyond its original panels, and the panels that show it:
 * the book at a glance (PORT), the reader's names reporting this week against the
 * consensus (EVTS), new highs, lows and heavy volume (SIGS), the Treasuries
 * and the dollar (RATES), the Fed as futures price it (FED), and the session
 * written out from those numbers (SUM, lib/session-summary.ts).
 *
 * Each source is one request the HOME screen makes once and hands to every
 * panel that needs it, so the summary costs nothing beyond the panels.
 */

const DAY = 86_400_000;

function useJson<T>(url: string | null, refreshMs: number): T | null | undefined {
  const [state, setState] = useState<{ url: string; value: T | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const load = () => fetch(url).then((response) => (response.ok ? response.json() as Promise<T> : null)).catch(() => null)
      .then((value) => { if (alive) setState((current) => ({ url, value: value ?? (current?.url === url ? current.value : null) })); });
    void load();
    const timer = setInterval(load, refreshMs);
    return () => { alive = false; clearInterval(timer); };
  }, [url, refreshMs]);
  return state?.url === url ? state.value : undefined;
}

/** The time now, moved on every thirty seconds, so the session's phase and day turn over by themselves. */
function useNow(stepMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), stepMs); return () => clearInterval(timer); }, [stepMs]);
  return now;
}

const newYorkDate = (at: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(at));
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** The trading week a reader means by "this week": Monday to Friday, the next one at the weekend. */
function weekOf(today: string): { from: string; to: string } {
  const day = weekday(today);
  const monday = day === 0 ? addDays(today, 1) : day === 6 ? addDays(today, 2) : addDays(today, 1 - day);
  return { from: monday, to: addDays(monday, 4) };
}
const nextWeekday = (date: string) => { let next = addDays(date, 1); while (weekday(next) === 0 || weekday(next) === 6) next = addDays(next, 1); return next; };

interface EarningsRow { ticker: string; name: string; time: ReportTime; marketCap: number | null; consensusEps: number | null; reportedEps: number | null; surprise: number | null; sp500?: boolean }
interface EarningsDays { days?: Array<{ date: string; rows: EarningsRow[] }> }
interface EconCalendar { today: string; live?: boolean; events: EconEvent[]; reactions: Record<string, Reaction> }
interface Heat { columns: string[]; rows: Array<Array<string | number | null>> }

export interface HomeData {
  now: number;
  today: string;
  phase: Phase;
  rates: Rates | null | undefined;
  fed: FedWatch | null | undefined;
  signals: (Signals & { builtAt?: string }) | null | undefined;
  earnings: EarningsDays | null | undefined;
  heat: Heat | null | undefined;
}

/** Every source the new panels read, once for the screen. */
export function useHomeData(followed: string[]): HomeData {
  const now = useNow();
  const today = newYorkDate(now);
  const phase = phaseAt(new Date(now));
  const live = phase === "open";
  const week = weekOf(today);
  const rates = useJson<Rates>("/api/rates", live ? 60_000 : 300_000);
  const fed = useJson<FedWatch>("/api/fedwatch", 900_000);
  const signals = useJson<Signals>(`/api/signals${followed.length ? `?tickers=${encodeURIComponent(followed.join(","))}` : ""}`, 300_000);
  // From this week's Monday to the next weekday after today, so the evening already shows tomorrow morning's reports.
  const span = Math.max(5, Math.round((Date.parse(nextWeekday(today)) - Date.parse(week.from)) / DAY) + 1);
  const earnings = useJson<EarningsDays>(`/api/earnings-days?from=${week.from < today ? week.from : today}&days=${span}&v=${EARNINGS_DAY_SHAPE}`, live ? 300_000 : 900_000);
  const heat = useJson<Heat>("/api/heatmap", live ? 120_000 : 600_000);
  return { now, today, phase, rates, fed, signals, earnings, heat };
}

const sign = (value: number, places = 1) => `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(places)}`;
const dir = (value: number | null | undefined) => (value == null || value === 0 ? undefined : value > 0 ? "up" : "down");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const meetingLabel = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8))}`;

/* ---------- PORT: the book at a glance ---------- */

export function PortfolioGlance({ positions, tape }: { positions: Position[]; tape: Tape | null }) {
  if (!positions.length) {
    return <p className="t-empty">No holdings yet. <a href="/t/portfolio">Add your positions on PORT</a> to see the book&apos;s day here.</p>;
  }
  const quotes = new Map((tape?.quotes ?? []).filter((quote) => quote.kind === "equity").map((quote) => [quote.symbol, quote]));
  const lines = positions.flatMap((position) => {
    const quote = quotes.get(position.ticker);
    if (quote?.price == null) return [];
    const value = position.shares * quote.price;
    const before = quote.changePercent == null ? null : value / (1 + quote.changePercent);
    return [{ ticker: position.ticker, value, day: before == null ? null : value - before, change: quote.changePercent, cost: position.cost == null ? null : position.cost * position.shares }];
  });
  if (!lines.length) return <p className="t-empty">{tape ? "No price for the holdings just now." : "Pricing the book…"}</p>;
  const value = lines.reduce((sum, line) => sum + line.value, 0);
  const moved = lines.filter((line) => line.day != null);
  const day = moved.reduce((sum, line) => sum + line.day!, 0);
  const dayChange = day / (value - day);
  const costed = lines.filter((line) => line.cost != null);
  const gain = costed.length ? costed.reduce((sum, line) => sum + line.value - line.cost!, 0) : null;
  const costBase = costed.reduce((sum, line) => sum + line.cost!, 0);
  const up = [...moved].filter((line) => line.day! > 0).sort((a, b) => b.day! - a.day!).slice(0, 3);
  const down = [...moved].filter((line) => line.day! < 0).sort((a, b) => a.day! - b.day!).slice(0, 3);
  const missing = positions.length - lines.length;
  return (
    <div className="t-glance">
      <div className="t-glance-head">
        <div><span className="t-dim">Value</span><b>{money(value, "USD")}</b></div>
        <div><span className="t-dim">Today</span><b data-dir={dir(day)}>{day >= 0 ? "+" : "−"}{money(Math.abs(day), "USD")}</b><span data-dir={dir(day)}>{delta(dayChange)}</span></div>
        {gain != null ? <div><span className="t-dim">Unrealised{costed.length < lines.length ? "*" : ""}</span><b data-dir={dir(gain)}>{gain >= 0 ? "+" : "−"}{money(Math.abs(gain), "USD")}</b><span data-dir={dir(gain)}>{delta(costBase ? gain / costBase : null)}</span></div> : null}
      </div>
      <div className="t-glance-movers">
        <Contributors title="Adding most" lines={up} />
        <Contributors title="Costing most" lines={down} />
      </div>
      <p className="t-study-note">
        {lines.length} positions priced{missing ? `, ${missing} without a price` : ""}{gain != null && costed.length < lines.length ? "; *unrealised gain on the positions with a cost entered" : ""}. <a href="/t/portfolio">PORT</a>
      </p>
    </div>
  );
}

function Contributors({ title, lines }: { title: string; lines: Array<{ ticker: string; day: number | null; change: number | null }> }) {
  return (
    <div>
      <span className="t-dim">{title}</span>
      {lines.length ? lines.map((line) => (
        <a key={line.ticker} href={`/t/s/${encodeURIComponent(line.ticker)}`} className="t-glance-line">
          <span>{line.ticker}</span><span data-dir={dir(line.day)}>{line.day! >= 0 ? "+" : "−"}{money(Math.abs(line.day!), "USD")}</span><span className="t-dim">{delta(line.change)}</span>
        </a>
      )) : <span className="t-glance-line t-dim">—</span>}
    </div>
  );
}

/* ---------- EVTS: the reader's names reporting this week ---------- */

export function WatchEarnings({ data, tickers }: { data: HomeData; tickers: string[] }) {
  if (data.earnings === undefined) return <p className="t-empty">Reading this week&apos;s calendar…</p>;
  if (data.earnings === null) return <p className="t-empty">The earnings calendar could not be read just now.</p>;
  const week = weekOf(data.today);
  const followed = new Set(tickers);
  const rows = (data.earnings.days ?? []).filter((entry) => entry.date >= week.from && entry.date <= week.to)
    .flatMap((entry) => entry.rows.filter((row) => followed.has(row.ticker)).map((row) => ({ ...row, date: entry.date })));
  if (!rows.length) return <p className="t-empty">None of your names reports this week ({shortDate(week.from)} – {shortDate(week.to)}). <a href="/t/ecal">ECAL</a></p>;
  return (
    <div className="sheet t-week-earnings">
      <table>
        <thead><tr><th className="key">Day</th><th>Ticker</th><th>Time</th><th>Cons. EPS</th><th>Actual</th><th>Surprise</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.date}-${row.ticker}`} data-today={row.date === data.today || undefined}>
              <td className="key">{row.date === data.today ? "Today" : new Date(`${row.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</td>
              <td><a href={`/t/s/${encodeURIComponent(row.ticker)}#ee`}>{row.ticker}</a></td>
              <td className="t-dim">{row.time === "before" ? "☀ open" : row.time === "after" ? "☾ close" : "—"}</td>
              <td>{row.consensusEps == null ? "—" : price(row.consensusEps, "USD")}</td>
              <td>{row.reportedEps == null ? <span className="t-dim">due</span> : <b>{price(row.reportedEps, "USD")}</b>}</td>
              <td data-dir={dir(row.surprise)}>{row.surprise == null ? "—" : `${sign(row.surprise)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-study-note">Earnings per share against the analysts&apos; consensus, from Nasdaq&apos;s calendar. Full week: <a href="/t/ecal">ECAL</a>.</p>
    </div>
  );
}

/* ---------- SIGS: new highs, new lows, heavy volume ---------- */

export function SignalsPanel({ data }: { data: HomeData }) {
  const [tab, setTab] = useState<"highs" | "lows" | "volume">("highs");
  const signals = data.signals;
  if (signals === undefined) return <p className="t-empty">Reading the index…</p>;
  if (signals === null) return <p className="t-empty">The scanner&apos;s snapshot is being built.</p>;
  const list: Signal[] = signals[tab];
  return (
    <div className="t-sigs">
      <div className="seg" role="group" aria-label="Signal">
        <button type="button" aria-pressed={tab === "highs"} onClick={() => setTab("highs")}>52w highs <span>{signals.counts.highs}</span></button>
        <button type="button" aria-pressed={tab === "lows"} onClick={() => setTab("lows")}>52w lows <span>{signals.counts.lows}</span></button>
        <button type="button" aria-pressed={tab === "volume"} onClick={() => setTab("volume")}>Volume ≥2× <span>{signals.counts.volume}</span></button>
      </div>
      {list.length ? (
        <div className="sheet">
          <table>
            <thead><tr><th className="key">Ticker</th><th>Last</th><th>Chg %</th><th>{tab === "volume" ? "Vol / 20d" : "When"}</th></tr></thead>
            <tbody>
              {list.map((signal) => (
                <tr key={`${signal.ticker}-${signal.when}`} data-watched={signal.watched || undefined}>
                  <td className="key" title={signal.name}><a href={`/t/s/${encodeURIComponent(signal.ticker)}`}>{signal.ticker}</a>{signal.watched ? <span className="t-amber" title="In your list"> ★</span> : null}</td>
                  <td>{price(signal.price, null)}</td>
                  <td data-dir={dir(signal.change)}>{delta(signal.change)}</td>
                  <td className="t-dim">{tab === "volume" ? `${signal.ratio?.toFixed(1)}×` : signal.when === "today" ? <span className="t-amber">today</span> : "last session"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="t-empty">None {tab === "volume" ? "trading twice their usual volume" : `at a new 52-week ${tab === "highs" ? "high" : "low"}`}.</p>}
      <p className="t-study-note">S&amp;P 500, your names first (★). Today&apos;s highs and lows from the half-hourly prices; volume from the last whole session{signals.session ? ` (${shortDate(signals.session)})` : ""}. <a href="/t/screener">SCRN</a></p>
    </div>
  );
}

/* ---------- RATES: Treasuries and the dollar ---------- */

export function RatesPanel({ data }: { data: HomeData }) {
  const rates = data.rates;
  if (rates === undefined) return <p className="t-empty">Reading the Treasury market…</p>;
  if (rates === null) return <p className="t-empty">No rates source answered just now.</p>;
  return (
    <div className="sheet t-rates">
      <table>
        <thead><tr><th className="key">US</th><th>Last</th><th>Day</th></tr></thead>
        <tbody>
          {rates.rows.map((row) => (
            <tr key={row.id} data-unit={row.unit}>
              <td className="key">{row.label}</td>
              <td>{row.last == null ? "—" : row.unit === "yield" ? `${row.last.toFixed(3)}%` : row.unit === "spread" ? `${sign(row.last, 1)} bp` : row.last.toFixed(2)}</td>
              {/* A yield rising is not a gain for anyone holding the bond: the colour follows the number, as on every rates screen. */}
              <td data-dir={dir(row.change)}>{row.change == null ? "—" : row.unit === "index" ? `${sign(row.change, 2)}%` : `${sign(row.change, 1)} bp`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-study-note">{rates.live ? "Live" : `As of ${rates.asOf}`} · {rates.source}. Curve: <a href="/t/market">MKT</a></p>
    </div>
  );
}

/* ---------- FED: the odds of each coming decision ---------- */

export function FedPanel({ data }: { data: HomeData }) {
  const fed = data.fed;
  if (fed === undefined) return <p className="t-empty">Reading the fed funds futures…</p>;
  if (fed === null) return <p className="t-empty">The futures or the New York Fed did not answer just now.</p>;
  const split = (odds: Record<string, number>) => ({
    cut: Object.entries(odds).filter(([move]) => Number(move) < 0).reduce((sum, [, p]) => sum + p, 0),
    hold: odds["0"] ?? 0,
    hike: Object.entries(odds).filter(([move]) => Number(move) > 0).reduce((sum, [, p]) => sum + p, 0),
  });
  const percent = (p: number) => (p < 0.005 ? "—" : `${Math.round(p * 100)}%`);
  return (
    <div className="t-fed">
      <p className="t-fed-now">
        Target <b>{fed.lower.toFixed(2)}–{fed.upper.toFixed(2)}%</b> · effective <b>{fed.effr.toFixed(2)}%</b> <span className="t-dim">({shortDate(fed.asOf)})</span>
      </p>
      <div className="sheet">
        <table>
          <thead><tr><th className="key">Meeting</th><th>Cut</th><th>Hold</th><th>Hike</th><th>Likely range</th><th>Implied</th><th>vs now</th></tr></thead>
          <tbody>
            {fed.rows.map((row) => {
              const odds = split(row.odds);
              const likely = [...row.ranges].sort((a, b) => b.p - a.p)[0];
              return (
                <tr key={row.date}>
                  <td className="key">{meetingLabel(row.date)} <span className="t-dim">{row.date.slice(2, 4)}</span></td>
                  <td>{percent(odds.cut)}</td>
                  <td>{percent(odds.hold)}</td>
                  <td>{percent(odds.hike)}</td>
                  <td>{likely ? <>{likely.lower.toFixed(2)}–{likely.upper.toFixed(2)} <span className="t-dim">{percent(likely.p)}</span></> : "—"}</td>
                  <td>{row.implied.toFixed(2)}%</td>
                  <td data-dir={dir(row.fromToday)}>{sign(row.fromToday, 0)} bp</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="t-study-note">Each meeting&apos;s own move, read from CBOT 30-day fed funds futures the way CME&apos;s FedWatch reads them; the range counts every meeting up to it. An estimate from prices, not a forecast.</p>
    </div>
  );
}

/* ---------- SUM: the session, written out ---------- */

export function SessionSummary({ data, tape, econ }: { data: HomeData; tape: Tape | null; econ: EconCalendar | null }) {
  const lines = useMemo(() => {
    const index = (symbol: string) => tape?.quotes.find((quote) => quote.kind === "index" && quote.symbol === symbol);
    const future = (symbol: string) => tape?.quotes.find((quote) => quote.kind === "future" && quote.symbol === symbol);
    const columns = data.heat?.columns ?? [];
    const at = (field: string) => columns.indexOf(field);
    const members = (data.heat?.rows ?? []).map((row) => ({
      ticker: String(row[at("ticker")]), sector: String(row[at("sector")]),
      change: typeof row[at("d1")] === "number" ? (row[at("d1")] as number) / 100 : null,
      cap: typeof row[at("cap")] === "number" ? row[at("cap")] as number : null,
    }));
    const releases = (econ?.events ?? []).filter((event) => event.date === data.today && event.importance === "high" && event.actual).map((event) => ({
      name: event.name, actual: event.actual!, consensus: event.consensus, surprise: event.surprise,
      equity: econ?.reactions[`${event.date} ${event.time}`]?.equity ?? null,
    }));
    const today = data.earnings?.days?.find((entry) => entry.date === data.today)?.rows ?? [];
    const results = today.filter((row) => (row.marketCap ?? 0) >= 10e9 && row.surprise != null).map((row) => ({ ticker: row.ticker, surprise: row.surprise }));
    const meeting = data.fed?.rows[0];
    const fedOdds = meeting ? {
      date: meeting.date,
      hike: Object.entries(meeting.odds).filter(([move]) => Number(move) > 0).reduce((sum, [, p]) => sum + p, 0),
      cut: Object.entries(meeting.odds).filter(([move]) => Number(move) < 0).reduce((sum, [, p]) => sum + p, 0),
    } : null;
    return sessionSummary({
      phase: data.phase,
      indices: ([["SPX", "S&P 500"], ["NASDAQ", "Nasdaq"], ["DOW", "Dow"]] as const).flatMap(([symbol, label]) => { const quote = index(symbol); return quote ? [{ label, change: quote.changePercent }] : []; }),
      futures: ["ES=F", "NQ=F", "YM=F"].map((symbol) => future(symbol)).filter((quote) => quote != null).map((quote) => ({ label: quote!.label, change: quote!.changePercent })),
      members, rates: data.rates?.rows ?? [], releases, results, fed: fedOdds,
      signals: data.signals ? { highs: data.signals.counts.highs, lows: data.signals.counts.lows } : null,
    });
  }, [data, tape, econ]);
  if (!lines.length) return <p className="t-empty">Writing the session from the numbers…</p>;
  return (
    <div className="t-summary">
      {lines.map((line) => <p key={line}>{line}</p>)}
      <p className="t-study-note">Written from the figures on this screen, in fixed templates: no figure is guessed, and a sentence without its numbers is left out.</p>
    </div>
  );
}
