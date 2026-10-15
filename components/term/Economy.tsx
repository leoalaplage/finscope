"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { EconEvent, Reaction } from "@/lib/econ";
import { BLS_SERIES, seriesForEvent, type EconSeries } from "@/lib/econ-series";
import type { ChartData, Preset } from "@/lib/term/fundamental-charts";
import { ComboChart } from "./FundamentalCharts";
import { Panel } from "./Panel";
import { MacroSnapshot } from "@/components/io/MacroSnapshot";

/**
 * ECO: the US economy as markets trade it (lib/econ.ts) — the releases just
 * out against the consensus and how the S&P 500 futures and the 10-year
 * yield took them, the ones coming, the whole calendar, and the official
 * series behind the headlines.
 */

interface Calendar { today: string; live?: boolean; events: EconEvent[]; reactions: Record<string, Reaction> }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayLabel = (date: string, today: string) => {
  if (date === today) return "Today";
  const day = new Date(`${date}T12:00:00Z`);
  const diff = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return `${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
};
const signedPercent = (value: number | null) => (value == null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(2)}%`);
const signedBp = (value: number | null) => (value == null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value)} bp`);

/**
 * The calendar, read again every minute — and every fifteen seconds from five
 * minutes before a market-moving release to twenty-five after it, when the
 * server reads Nasdaq afresh too (lib/econ.ts, releaseWindow).
 */
export function useEcon(): { data: Calendar | null; failed: boolean } {
  const [state, setState] = useState<{ data: Calendar | null; failed: boolean }>({ data: null, failed: false });
  const hot = !!state.data?.live;
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/econ${hot ? `?t=${Math.floor(Date.now() / 15_000)}` : ""}`).then((response) => (response.ok ? response.json() as Promise<Calendar> : null))
      .then((data) => { if (alive) setState((current) => ({ data: data ?? current.data, failed: !data && !current.data })); })
      .catch(() => { if (alive) setState((current) => ({ ...current, failed: !current.data })); });
    void load();
    const timer = setInterval(load, hot ? 15_000 : 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, [hot]);
  return state;
}

/** The official series, read once a page and shared by every chart and history on it. */
let seriesRequest: Promise<{ series: EconSeries[]; error?: string }> | null = null;
function loadSeries() {
  seriesRequest ??= fetch("/api/econ/series").then((response) => response.json() as Promise<{ series: EconSeries[]; error?: string }>)
    .catch(() => ({ series: [], error: "The Bureau of Labor Statistics did not answer." }));
  return seriesRequest;
}

/** An event's name, opening its history where the BLS publishes one. */
function EventName({ name, onOpen }: { name: string; onOpen: (name: string) => void }) {
  return seriesForEvent(name)
    ? <button type="button" className="t-eco-name" onClick={() => onOpen(name)} title="Open its history">{name}</button>
    : <>{name}</>;
}

const released = (data: Calendar, days = 3) => {
  const since = new Date(Date.parse(`${data.today}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  return data.events.filter((event) => event.importance === "high" && event.actual && event.date >= since && event.date <= data.today).reverse();
};
const coming = (data: Calendar, days = 7) => {
  const until = new Date(Date.parse(`${data.today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return data.events.filter((event) => event.importance === "high" && !event.actual && event.date >= data.today && event.date <= until && !/Speaks/i.test(event.name));
};

function Surprise({ event }: { event: EconEvent }) {
  if (!event.surprise) return null;
  return <span className="t-eco-surprise" data-surprise={event.surprise}>{event.surprise === "inline" ? "In line" : event.surprise === "above" ? "Above consensus" : "Below consensus"}</span>;
}

function ReactionLine({ reaction }: { reaction: Reaction | undefined }) {
  if (!reaction || (reaction.equity == null && reaction.yield10 == null)) return null;
  return (
    <span className="t-eco-reaction">
      {reaction.minutes} min after: S&amp;P fut <b data-dir={reaction.equity == null ? undefined : reaction.equity >= 0 ? "up" : "down"}>{signedPercent(reaction.equity)}</b>
      {" "}· 10Y <b>{signedBp(reaction.yield10)}</b>
    </span>
  );
}

/** For HOME and MKT: what came out in the last three days, and what is next this week. */
export function EconBrief() {
  const { data, failed } = useEcon();
  const [history, setHistory] = useState<string | null>(null);
  if (failed) return <p className="t-empty">The economic calendar could not be read just now.</p>;
  if (!data) return <p className="t-empty">Reading the economic calendar…</p>;
  const out = released(data).slice(0, 6);
  const next = coming(data).slice(0, 5);
  return (
    <div className="t-eco-brief">
      <div className="sheet">
        <table>
          <thead><tr><th className="key">Released</th><th>Actual</th><th>Cons.</th><th>Prev.</th><th>Market, 30 min</th></tr></thead>
          <tbody>
            {out.length ? out.map((event) => {
              const reaction = data.reactions[`${event.date} ${event.time}`];
              return (
                <tr key={`${event.date}-${event.time}-${event.name}`} data-surprise={event.surprise ?? undefined}>
                  <td className="key"><span className="t-dim">{dayLabel(event.date, data.today)} {event.time ?? ""}</span> <EventName name={event.name} onOpen={setHistory} /></td>
                  <td><b>{event.actual}</b></td>
                  <td>{event.consensus ?? "—"}</td>
                  <td className="t-dim">{event.previous ?? "—"}</td>
                  <td>{reaction?.equity != null ? <span data-dir={reaction.equity >= 0 ? "up" : "down"}>{signedPercent(reaction.equity)}</span> : "—"}{reaction?.yield10 != null ? <span className="t-dim"> · {signedBp(reaction.yield10)}</span> : null}</td>
                </tr>
              );
            }) : <tr><td className="key t-dim" colSpan={5}>No major US release in the last three days.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="sheet">
        <table>
          <thead><tr><th className="key">Next</th><th>Time ET</th><th>Cons.</th><th>Prev.</th></tr></thead>
          <tbody>
            {next.length ? next.map((event) => (
              <tr key={`${event.date}-${event.time}-${event.name}`}>
                <td className="key"><EventName name={event.name} onOpen={setHistory} /> <span className="t-dim">· {dayLabel(event.date, data.today)}</span></td>
                <td>{event.time ?? "—"}</td>
                <td>{event.consensus ?? "—"}</td>
                <td className="t-dim">{event.previous ?? "—"}</td>
              </tr>
            )) : <tr><td className="key t-dim" colSpan={4}>No major US release in the next seven days.</td></tr>}
          </tbody>
        </table>
      </div>
      <a className="t-eco-more" href="/t/eco">{data.live ? <span className="t-eco-live">LIVE</span> : null}Full calendar and US data · ECO</a>
      {history ? <EconHistory name={history} events={data.events} onClose={() => setHistory(null)} /> : null}
    </div>
  );
}

const IMPORTANCE = [{ id: "high", label: "Market-moving" }, { id: "medium", label: "+ Notable" }, { id: "low", label: "All" }] as const;

/** The ECO screen. */
export function EconomyScreen() {
  const { data, failed } = useEcon();
  const [level, setLevel] = useState<"high" | "medium" | "low">("medium");
  const [history, setHistory] = useState<string | null>(null);
  const [series, setSeries] = useState<{ series: EconSeries[]; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSeries().then((body) => { if (alive) setSeries(body); });
    return () => { alive = false; };
  }, []);

  const shown = useMemo(() => (data?.events ?? []).filter((event) => level === "low" || event.importance === "high" || (level === "medium" && event.importance === "medium")), [data, level]);
  const days = useMemo(() => [...new Set(shown.map((event) => event.date))], [shown]);

  return (
    <div className="t-grid t-eco">
      {history && data ? <EconHistory name={history} events={data.events} onClose={() => setHistory(null)} /> : null}
      <Panel code="ECO" title="Just released · United States" actions={data?.live ? <span className="t-eco-live" title="A market-moving release is due or just out: read every fifteen seconds">LIVE · 15 s</span> : null}>
        {failed ? <p className="t-empty">The economic calendar could not be read just now.</p> : !data ? <p className="t-empty">Reading the economic calendar…</p> : (
          <div className="t-eco-cards">
            {released(data).length ? released(data).slice(0, 8).map((event) => (
              <article key={`${event.date}-${event.time}-${event.name}`} className="t-eco-card" data-surprise={event.surprise ?? undefined}>
                <header><span><EventName name={event.name} onOpen={setHistory} /></span><span className="t-dim">{dayLabel(event.date, data.today)} · {event.time} ET</span></header>
                <b className="t-eco-actual">{event.actual}</b>
                <span className="t-eco-vs">Consensus {event.consensus ?? "—"} · previous {event.previous ?? "—"}</span>
                <Surprise event={event} />
                <ReactionLine reaction={data.reactions[`${event.date} ${event.time}`]} />
              </article>
            )) : <p className="t-empty">No major US release in the last three days.</p>}
          </div>
        )}
      </Panel>

      <Panel code="CAL" title="US economic calendar · New York time" actions={
        <div className="seg" role="group" aria-label="Importance">
          {IMPORTANCE.map((entry) => <button key={entry.id} type="button" aria-pressed={level === entry.id} onClick={() => setLevel(entry.id)}>{entry.label}</button>)}
        </div>
      }>
        {!data ? <p className="t-empty">{failed ? "The economic calendar could not be read just now." : "Reading the economic calendar…"}</p> : (
          <div className="sheet t-eco-calendar">
            <table>
              <thead><tr><th className="key">Time</th><th className="key">Event</th><th>Actual</th><th>Consensus</th><th>Previous</th><th>S&amp;P fut · 10Y, 30 min</th></tr></thead>
              {days.map((date) => (
                <tbody key={date} data-today={date === data.today || undefined}>
                  <tr className="t-eco-day"><th colSpan={6} scope="rowgroup">{dayLabel(date, data.today)} <span className="t-dim">{date}</span></th></tr>
                  {shown.filter((event) => event.date === date).map((event, index) => {
                    const reaction = data.reactions[`${event.date} ${event.time}`];
                    return (
                      <tr key={`${event.time}-${event.name}-${index}`} data-importance={event.importance} data-surprise={event.surprise ?? undefined} title={event.description ?? undefined}>
                        <td className="key t-dim">{event.time ?? "—"}</td>
                        <td className="key">{event.importance === "high" ? <span className="t-eco-dot" aria-label="Market-moving" /> : null}<EventName name={event.name} onOpen={setHistory} /></td>
                        <td>{event.actual ? <b>{event.actual}</b> : <span className="t-dim">—</span>}</td>
                        <td>{event.consensus ?? "—"}</td>
                        <td className="t-dim">{event.previous ?? "—"}</td>
                        <td>{reaction ? <>{reaction.equity != null ? <span data-dir={reaction.equity >= 0 ? "up" : "down"}>{signedPercent(reaction.equity)}</span> : "—"}<span className="t-dim"> · {signedBp(reaction.yield10)}</span></> : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}
        <p className="t-study-note">Times, prints and consensus from Nasdaq&apos;s public economic calendar (the consensus is the economists&apos;, a forecast); the market move is the S&amp;P 500 futures (ES) and the 10-year Treasury yield from the last price before the release to thirty minutes after it. Hover an event for what it measures; click an underlined one for its history.</p>
      </Panel>

      <Panel code="USD" title="US data · official series">
        {series == null ? <p className="t-empty">Reading the Bureau of Labor Statistics…</p> : !series.series.length ? (
          <p className="t-empty">The Bureau of Labor Statistics did not hand over its series just now{series.error && /threshold/i.test(series.error) ? ": its free allowance for this server is spent for today" : ""}. The latest prints are in the calendar above.</p>
        ) : <EconCharts series={series.series} />}
      </Panel>

      <Panel code="WRLD" title="World economies · annual and monthly">
        <MacroSnapshot />
      </Panel>
    </div>
  );
}

const COLORS = { blue: "var(--c1, #4c8dff)", amber: "var(--amber, #ffa028)", teal: "var(--c3, #2bb3a3)", violet: "var(--c4, #9a7bff)" };

function EconCharts({ series }: { series: EconSeries[] }) {
  const find = (id: string) => series.find((entry) => entry.id === id);
  const charts: Array<{ title: string; preset: Preset; data: ChartData; note: string }> = [];
  const add = (title: string, ids: Array<{ id: string; kind: "line" | "bar"; color: string; label?: string }>, unit: "percent" | "shares", months: number, note: string) => {
    const found = ids.map((entry) => ({ ...entry, data: find(entry.id) })).filter((entry) => entry.data);
    if (!found.length) return;
    const periods = [...new Set(found.flatMap((entry) => entry.data!.points.map((point) => point.period)))].sort().slice(-months);
    const specs = found.map((entry) => ({ id: entry.id, label: entry.label ?? entry.data!.label, kind: entry.kind, axis: "left" as const, color: entry.color, value: () => null }));
    charts.push({
      title, note,
      preset: { id: title, title, left: unit, series: specs },
      data: {
        labels: periods.map((period) => `${MONTHS[Number(period.slice(5)) - 1]} ${period.slice(2, 4)}`),
        names: periods.map((period) => `${MONTHS[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`),
        series: found.map((entry, index) => ({
          spec: specs[index],
          values: periods.map((period) => {
            const value = entry.data!.points.find((point) => point.period === period)?.value ?? null;
            return value == null ? null : unit === "percent" ? value / 100 : value * 1000;
          }),
        })),
      },
    });
  };
  add("Inflation · year on year", [{ id: "CUUR0000SA0", kind: "line", color: COLORS.amber }, { id: "CUUR0000SA0L1E", kind: "line", color: COLORS.blue }, { id: "WPUFD4", kind: "line", color: COLORS.violet }], "percent", 60, "CPI, core CPI (without food and energy) and PPI final demand, change on a year earlier.");
  add("Inflation · month on month", [{ id: "CUSR0000SA0", kind: "bar", color: COLORS.amber }, { id: "CUSR0000SA0L1E", kind: "line", color: COLORS.blue }], "percent", 24, "Seasonally adjusted, change on the month before.");
  add("Jobs · payrolls added", [{ id: "CES0000000001", kind: "bar", color: COLORS.teal, label: "Nonfarm payrolls, monthly change" }], "shares", 36, "Change in nonfarm payroll employment, seasonally adjusted.");
  add("Jobs · unemployment and wages", [{ id: "LNS14000000", kind: "line", color: COLORS.amber }, { id: "CES0500000003", kind: "line", color: COLORS.blue, label: "Average hourly earnings, y/y" }], "percent", 60, "Unemployment rate, and average hourly earnings on a year earlier.");
  return (
    <div className="t-eco-charts">
      {charts.map((chart) => (
        <figure key={chart.title} className="t-gf-card">
          <figcaption><h3>{chart.title}</h3></figcaption>
          <ComboChart preset={chart.preset} data={chart.data} currency="USD" height={200} />
          <ul className="t-gf-legend">
            {chart.data.series.map((entry) => <li key={entry.spec.id} data-kind={entry.spec.kind} style={{ "--key": entry.spec.color } as CSSProperties}><i aria-hidden="true" />{entry.spec.label} <span className="t-dim">{(() => { const last = entry.values.filter((value) => value != null).at(-1); return last == null ? "" : chart.preset.left === "percent" ? `${(last * 100).toFixed(2)}%` : `${Math.round(last / 1000)}K`; })()}</span></li>)}
          </ul>
          <p className="t-study-note">{chart.note}</p>
        </figure>
      ))}
      <p className="t-study-note t-eco-source">Source: U.S. Bureau of Labor Statistics, as published. Latest month {series.map((entry) => entry.latest).filter(Boolean).sort().at(-1)}.</p>
    </div>
  );
}

const RANGES = [{ years: 2, label: "2Y" }, { years: 5, label: "5Y" }, { years: 10, label: "10Y" }, { years: 20, label: "20Y" }];

/** An indicator's official history, opened from its name: twenty years of it, its last prints against the consensus. */
function EconHistory({ name, events, onClose }: { name: string; events: EconEvent[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = seriesForEvent(name);
  const spec = BLS_SERIES.find((entry) => entry.id === id);
  const [body, setBody] = useState<{ series: EconSeries[]; error?: string } | null>(null);
  const [years, setYears] = useState(5);
  useEffect(() => {
    let alive = true;
    void loadSeries().then((value) => { if (alive) setBody(value); });
    dialog.current?.showModal();
    return () => { alive = false; };
  }, []);
  const series = body?.series.find((entry) => entry.id === id) ?? null;
  const points = series ? series.points.slice(-years * 12) : [];
  const percent = series?.unit === "percent";
  const latest = series?.points.at(-1) ?? null;
  const before = series?.points.at(-2) ?? null;
  const values = points.map((point) => point.value);
  const format = (value: number | null | undefined) => (value == null ? "—" : percent ? `${value.toFixed(2)}%` : series?.id === "JTS000000000000000JOL" ? `${(value / 1000).toFixed(2)}M` : `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value)).toLocaleString("en-US")}K`);
  const kind: "bar" | "line" = spec && (spec.transform === "mom" || spec.transform === "diff") ? "bar" : "line";
  const chartSpec = { id: id ?? "series", label: spec?.label ?? name, kind, axis: "left" as const, color: "var(--amber, #ffa028)", value: () => null };
  const preset: Preset = { id: `history-${id}`, title: spec?.label ?? name, left: percent ? "percent" : "shares", series: [chartSpec] };
  const data: ChartData = {
    labels: points.map((point) => `${MONTHS[Number(point.period.slice(5)) - 1]} ${point.period.slice(2, 4)}`),
    names: points.map((point) => `${MONTHS[Number(point.period.slice(5)) - 1]} ${point.period.slice(0, 4)}`),
    series: [{ spec: chartSpec, values: points.map((point) => (percent ? point.value / 100 : point.value * 1000)) }],
  };
  const prints = events.filter((event) => event.name === name && event.actual).reverse();

  return (
    <dialog ref={dialog} className="t-help t-eco-dialog" onClose={onClose} aria-labelledby="t-eco-history-title">
      <header className="t-panel-head">
        <span className="t-panel-code">HIST</span>
        <h2 id="t-eco-history-title">{spec?.label ?? name} · history</h2>
        <div className="seg" role="group" aria-label="Range">
          {RANGES.map((range) => <button key={range.years} type="button" aria-pressed={years === range.years} onClick={() => setYears(range.years)}>{range.label}</button>)}
        </div>
        <button type="button" className="t-chip" onClick={() => dialog.current?.close()} aria-label="Close">Close</button>
      </header>
      <div className="t-panel-pad">
        {body == null ? <p className="t-empty">Reading the Bureau of Labor Statistics…</p> : !series ? <p className="t-empty">The Bureau of Labor Statistics did not hand over this series just now.</p> : (
          <>
            <div className="t-eco-hist-stats">
              <div><span>Latest · {latest ? `${MONTHS[Number(latest.period.slice(5)) - 1]} ${latest.period.slice(0, 4)}` : "—"}</span><b>{format(latest?.value)}</b></div>
              <div><span>Month before</span><b>{format(before?.value)}</b></div>
              <div><span>High · {years}Y</span><b>{format(values.length ? Math.max(...values) : null)}</b></div>
              <div><span>Low · {years}Y</span><b>{format(values.length ? Math.min(...values) : null)}</b></div>
              <div><span>Average · {years}Y</span><b>{format(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)}</b></div>
            </div>
            <ComboChart preset={preset} data={data} currency="USD" height={300} />
            {prints.length ? (
              <div className="sheet t-eco-hist-prints">
                <table>
                  <thead><tr><th className="key">Release</th><th>Actual</th><th>Consensus</th><th>Previous</th></tr></thead>
                  <tbody>{prints.map((event) => <tr key={`${event.date}-${event.time}`} data-surprise={event.surprise ?? undefined}><td className="key">{event.date} {event.time} ET</td><td><b>{event.actual}</b></td><td>{event.consensus ?? "—"}</td><td className="t-dim">{event.previous ?? "—"}</td></tr>)}</tbody>
                </table>
              </div>
            ) : null}
            <p className="t-study-note">Monthly, as the U.S. Bureau of Labor Statistics publishes it{spec ? <> (<a href={`https://data.bls.gov/timeseries/${spec.bls}`} target="_blank" rel="noreferrer">series {spec.bls} ↗</a>)</> : null}; {spec?.transform === "yoy" ? "the change on the same month a year earlier" : spec?.transform === "mom" ? "the change on the month before, seasonally adjusted" : spec?.transform === "diff" ? "the change in the number employed on the month before, in thousands" : "as printed"}. Revised figures replace the first estimates.</p>
          </>
        )}
      </div>
    </dialog>
  );
}
