"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_SCREEN, SCREEN_FIELD, SCREEN_FIELDS, SCREEN_GROUPS, SCREEN_OPERATORS, SCREEN_PRESETS, SCREEN_STORAGE_KEY,
  conditionError, newCondition, readScreenStore, runScreen, saveScreen,
  type ScreenCondition, type ScreenConfig, type ScreenField, type ScreenRow, type ScreenStore,
} from "@/lib/free-screener";
import type { ScreenerFeed } from "@/lib/screener-feed";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { ExportMenu } from "@/components/io/ExportMenu";

const EVENT = "finscope:free-screener";
// A blocked/full browser store still permits editing for this tab's lifetime.
let volatileText: string | null = null;
let volatileOnly = false;
const readStore = () => {
  if (volatileOnly) return volatileText;
  try { return localStorage.getItem(SCREEN_STORAGE_KEY) ?? volatileText; } catch { return volatileText; }
};
const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify); window.addEventListener(EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(EVENT, notify); };
};
const serverStore = () => null;
function writeScreenStore(next: ScreenStore): boolean {
  volatileText = JSON.stringify(next);
  try { localStorage.setItem(SCREEN_STORAGE_KEY, volatileText); volatileOnly = false; }
  catch { volatileOnly = true; }
  window.dispatchEvent(new Event(EVENT));
  return !volatileOnly;
}
const numericFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const date = (value: string | null) => value ? value.slice(0, 10) : "unavailable";
const unitLabel = (field: ScreenField) => field.unit === "percent" ? "%" : field.unit === "billions" ? "bn, filing currency" : field.unit === "ratio" ? "×" : field.unit === "price" ? "quote currency" : "number";
function display(value: number | null | undefined, field: ScreenField) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${numericFormat.format(value)}${field.unit === "percent" ? "%" : field.unit === "ratio" ? "×" : field.unit === "billions" ? " bn" : ""}`;
}
function cellNote(row: ScreenRow, field: ScreenField) {
  const source = field.source === "fundamental" ? `SEC filings · ${row.period ?? "period not supplied by this stored row"} · read ${date(row.dates.fundamental)}`
    : field.source === "consensus" ? `Nasdaq / Zacks forecast · read ${date(row.dates.consensus)}${field.key === "forwardPe" || field.key === "peg" ? ` · ${row.epsBasis ?? "EPS unavailable"}` : ""}`
    : `Yahoo daily bars · session ${date(row.dates.technical)}`;
  const valuation = field.group === "Valuation" ? ` · price ${date(row.dates.price)} · shares ${row.sharesBasis ?? "unavailable"}` : "";
  const missing = row.values[field.key] == null ? ` · ${(field.group === "Valuation" ? row.reasons.valuation : row.reasons[field.source]) ?? "The source does not supply a usable value for this measure."}` : "";
  return `${source}${valuation}${field.unit === "price" || field.unit === "billions" ? ` · ${row.currency ?? "currency unavailable"}` : ""}${missing}`;
}

function MetricOptions({ compatible }: { compatible?: ScreenField }) {
  return <>{SCREEN_GROUPS.map((group) => <optgroup key={group} label={group}>
    {SCREEN_FIELDS.filter((field) => field.group === group && (!compatible || field.unit === compatible.unit)).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
  </optgroup>)}</>;
}

function Rule({ condition, index, onChange, onRemove }: { condition: ScreenCondition; index: number; onChange: (patch: Partial<ScreenCondition>) => void; onRemove: () => void }) {
  const field = SCREEN_FIELD[condition.field];
  const error = conditionError(condition);
  const noTarget = condition.op === "present" || condition.op === "missing";
  const otherAvailable = SCREEN_FIELD[condition.other]?.unit === field.unit;
  return <div className="free-rule">
    <div className="free-rule-controls">
      <label><span className="label">Metric {index + 1}</span><select value={condition.field} onChange={(event) => {
        const selected = SCREEN_FIELD[event.target.value];
        const other = SCREEN_FIELDS.find((candidate) => candidate.key !== selected.key && candidate.unit === selected.unit)?.key ?? selected.key;
        onChange({ field: selected.key, other, op: selected.source !== "technical" && condition.op.startsWith("cross") ? "gt" : condition.op });
      }}><MetricOptions /></select></label>
      <label><span className="label">Operator</span><select value={condition.op} onChange={(event) => onChange({ op: event.target.value as ScreenCondition["op"] })}>
        {SCREEN_OPERATORS.filter(([op]) => field.source === "technical" || !op.startsWith("cross")).map(([op, label]) => <option key={op} value={op}>{label}</option>)}
      </select></label>
      {!noTarget && condition.op !== "between" ? <label><span className="label">Compare with</span><select value={condition.target} onChange={(event) => onChange({ target: event.target.value as ScreenCondition["target"], other: otherAvailable ? condition.other : field.key })}>
        <option value="number">Number</option><option value="field">Another metric</option>
      </select></label> : null}
      {!noTarget && condition.target === "field" && condition.op !== "between" ? <label className="free-rule-target"><span className="label">Other metric</span><select value={condition.other} onChange={(event) => onChange({ other: event.target.value })}><MetricOptions compatible={field} /></select></label> : !noTarget ? <label className="free-rule-number"><span className="label">{condition.op === "between" ? "Minimum" : "Value"} · {unitLabel(field)}</span><input type="number" step="any" value={condition.value} aria-invalid={!!error} onChange={(event) => onChange({ value: event.target.value })} /></label> : null}
      {condition.op === "between" ? <label className="free-rule-number"><span className="label">Maximum · {unitLabel(field)}</span><input type="number" step="any" value={condition.upper} aria-invalid={!!error} onChange={(event) => onChange({ upper: event.target.value })} /></label> : null}
      <button type="button" className="free-remove" aria-label={`Remove criterion ${index + 1}`} onClick={onRemove}>Remove</button>
    </div>
    {error ? <p className="notice" role="alert">Criterion {index + 1}: {error}</p> : null}
  </div>;
}

export function FreeScreener() {
  const stored = useSyncExternalStore(subscribe, readStore, serverStore);
  const store = useMemo(() => readScreenStore(stored), [stored]);
  const config = store.current;
  const watchlist = useStoredWatchlist();
  const [feed, setFeed] = useState<ScreenerFeed | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [columnQuery, setColumnQuery] = useState("");
  const [detail, setDetail] = useState<{ ticker: string; key: string } | null>(null);
  const detailRow = detail ? feed?.rows.find((row) => row.ticker === detail.ticker) : null;
  const selected = store.saved.find((entry) => entry.id === store.selected);
  const name = nameOverride ?? selected?.name ?? "";
  const dirty = selected && JSON.stringify(selected.config) !== JSON.stringify(config);
  const result = useMemo(() => runScreen(feed?.rows ?? [], config, watchlist), [feed, config, watchlist]);
  const sectors = useMemo(() => [...new Set(feed?.rows.flatMap((row) => row.sector ? [row.sector] : []) ?? [])].sort(), [feed]);
  const pages = Math.max(1, Math.ceil(result.matches.length / 50));
  const shownPage = Math.min(page, pages);
  const visible = result.matches.slice((shownPage - 1) * 50, shownPage * 50);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch("/api/screener", { signal: controller.signal });
        if (!response.ok) throw new Error("The screener data could not be read.");
        const data = await response.json() as ScreenerFeed;
        if (!Array.isArray(data.rows) || !data.coverage) throw new Error("The screener returned an incomplete response.");
        if (!controller.signal.aborted) { setFeed(data); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The screener data could not be read.");
      } finally {
        if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(load, 60_000); }
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh]);

  function persist(next: ScreenStore) {
    setMessage(writeScreenStore(next) ? "" : "Browser storage is unavailable. Changes will last for this tab only.");
  }
  function change(patch: Partial<ScreenConfig>) { setPage(1); persist({ ...store, current: { ...config, ...patch } }); }
  function save(asNew: boolean) {
    if (!name.trim()) { setMessage("Give this search a name before saving it."); return; }
    if ((asNew || !selected) && store.saved.length >= 50) { setMessage("You have 50 saved searches. Delete one before adding another."); return; }
    if (result.errors.length) { setMessage("Complete the invalid criteria before saving."); return; }
    const next = saveScreen(store, name, !asNew && selected ? selected.id : crypto.randomUUID());
    persist(next); setNameOverride(null);
  }
  function toggleColumn(key: string) {
    const present = config.columns.includes(key);
    if ((present && config.columns.length === 1) || (!present && config.columns.length >= 24)) return;
    change({ columns: present ? config.columns.filter((field) => field !== key) : [...config.columns, key], ...(present && config.sort === key ? { sort: "ticker", descending: false } : {}) });
  }
  const exportRows = result.matches.map((row) => ({
    Ticker: row.ticker, Company: row.name, Sector: row.sector, Currency: row.currency,
    ...Object.fromEntries(config.columns.map((key) => [`${SCREEN_FIELD[key].label} (${unitLabel(SCREEN_FIELD[key])})`, row.values[key]])),
    "Financial period": row.period, "Filings read": row.dates.fundamental, "Price date": row.dates.price,
    "Consensus read": row.dates.consensus, "EPS forecast basis": row.epsBasis, "Technical session": row.dates.technical, "Shares basis": row.sharesBasis,
  }));

  return <div className="free-screener">
    <section className="free-controls" aria-label="Build a search">
      <div className="free-toolbar">
        <label><span className="label">Saved searches</span><select value={store.selected ?? ""} onChange={(event) => {
          const saved = store.saved.find((entry) => entry.id === event.target.value);
          setNameOverride(null); setPage(1); persist({ ...store, selected: saved?.id ?? null, current: saved?.config ?? DEFAULT_SCREEN });
        }}><option value="">New search</option>{store.saved.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <label className="free-save-name"><span className="label">Search name{dirty ? " · modified" : ""}</span><input value={name} maxLength={60} placeholder="My quality compounders" onChange={(event) => setNameOverride(event.target.value)} /></label>
        <button type="button" onClick={() => save(false)}>{selected ? "Update search" : "Save search"}</button>
        {selected ? <><button type="button" onClick={() => save(true)}>Save as new</button><button type="button" onClick={() => { persist({ ...store, selected: null, saved: store.saved.filter((entry) => entry.id !== selected.id) }); setNameOverride(null); }}>Delete saved search</button></> : null}
      </div>
      <p className="stat-note">Searches and columns are saved on this device.</p>
      {message ? <p className="notice" role="status">{message}</p> : null}
      <div className="free-toolbar free-scope">
        <label><span className="label">Universe</span><select value={config.scope} onChange={(event) => change({ scope: event.target.value as ScreenConfig["scope"] })}><option value="index">S&amp;P 500</option><option value="watchlist">My watchlist · index members</option></select></label>
        <label><span className="label">Find a company</span><input type="search" value={config.query} placeholder="Ticker or company" onChange={(event) => change({ query: event.target.value })} /></label>
        <label><span className="label">Start from a preset</span><select value="" onChange={(event) => {
          const preset = SCREEN_PRESETS[Number(event.target.value)];
          if (preset) { persist({ ...store, current: preset.config, selected: null }); setNameOverride(null); setPage(1); }
        }}><option value="" disabled>Choose…</option>{SCREEN_PRESETS.map((preset, at) => <option key={preset.name} value={at}>{preset.name}</option>)}</select></label>
        <button type="button" onClick={() => { persist({ ...store, selected: null, current: DEFAULT_SCREEN }); setNameOverride(null); setPage(1); }}>Reset search</button>
      </div>
      <details className="free-sectors"><summary>Sectors{config.sectors.length ? ` · ${config.sectors.length} selected` : " · all"}</summary><div className="free-checks">{[...new Set([...sectors, ...config.sectors])].map((sector) => <label key={sector}><input type="checkbox" checked={config.sectors.includes(sector)} onChange={() => change({ sectors: config.sectors.includes(sector) ? config.sectors.filter((entry) => entry !== sector) : [...config.sectors, sector] })} />{sector}</label>)}{!sectors.length ? <p className="stat-note">Sectors appear when financial data is available.</p> : null}</div></details>
      <div className="free-rule-heading"><h2>Criteria</h2><label>Match <select value={config.mode} onChange={(event) => change({ mode: event.target.value as ScreenConfig["mode"] })}><option value="all">all criteria</option><option value="any">any criterion</option></select></label></div>
      {!config.conditions.length ? <p className="stat-note">Add a criterion or choose a preset. Without criteria, all companies in your selection are shown.</p> : null}
      {config.conditions.map((condition, index) => <Rule key={condition.id} condition={condition} index={index} onChange={(patch) => change({ conditions: config.conditions.map((entry) => entry.id === condition.id ? { ...entry, ...patch } : entry) })} onRemove={() => change({ conditions: config.conditions.filter((entry) => entry.id !== condition.id) })} />)}
      <button type="button" disabled={config.conditions.length >= 30} onClick={() => change({ conditions: [...config.conditions, newCondition(crypto.randomUUID())] })}>+ Add criterion</button>
      <p className="stat-note">Percentages use percentage points: enter 15 for 15%. Missing values never pass a numeric criterion. Technical crossovers compare the last two daily sessions.</p>
    </section>

    <details className="free-columns"><summary>Columns · {config.columns.length} selected</summary>
      <label className="free-column-search"><span className="label">Find a column</span><input type="search" placeholder="Margin, growth, RSI…" value={columnQuery} onChange={(event) => setColumnQuery(event.target.value)} /></label>
      <div className="free-column-order" aria-label="Column order">{config.columns.map((key, at) => <div key={key}><span>{SCREEN_FIELD[key].label}</span><button type="button" aria-label={`Move ${SCREEN_FIELD[key].label} left`} disabled={at === 0} onClick={() => { const columns = [...config.columns]; [columns[at - 1], columns[at]] = [columns[at], columns[at - 1]]; change({ columns }); }}>←</button><button type="button" aria-label={`Move ${SCREEN_FIELD[key].label} right`} disabled={at === config.columns.length - 1} onClick={() => { const columns = [...config.columns]; [columns[at], columns[at + 1]] = [columns[at + 1], columns[at]]; change({ columns }); }}>→</button></div>)}</div>
      <div className="free-column-groups">{SCREEN_GROUPS.map((group) => {
        const fields = SCREEN_FIELDS.filter((field) => field.group === group && `${field.label} ${group}`.toLowerCase().includes(columnQuery.toLowerCase()));
        return fields.length ? <fieldset key={group}><legend>{group}</legend>{fields.map((field) => <label key={field.key}><input type="checkbox" checked={config.columns.includes(field.key)} disabled={config.columns.includes(field.key) ? config.columns.length === 1 : config.columns.length >= 24} onChange={() => toggleColumn(field.key)} />{field.label}</label>)}</fieldset> : null;
      })}</div>
    </details>

    <section aria-label="Search results" className="free-results">
      <div className="free-result-heading"><h2 aria-live="polite">{result.matches.length} matches <small>of {result.considered} selected companies</small></h2><button type="button" onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}>Refresh data</button></div>
      {loading && !feed ? <p className="notice" role="status">Reading the prepared financial, consensus and technical snapshots…</p> : null}
      {error ? <p className="notice" role="alert">{error}{feed ? " The last successful snapshot remains visible." : " Use Refresh data to try again."}</p> : null}
      {feed ? <p className="free-coverage">Coverage · filings {feed.coverage.fundamental}/{feed.members} · prices {feed.coverage.price}/{feed.members} · consensus {feed.coverage.consensus}/{feed.members} · technicals {feed.coverage.technical}/{feed.members}<br /><span className="stat-note">Index membership {feed.asOf}. Consensus is a forecast from Nasdaq / Zacks; technical signals use Yahoo daily bars. Click a value to see its source and date.</span></p> : null}
      {config.scope === "watchlist" && feed ? <p className="stat-note">{watchlist.filter((ticker) => !feed.rows.some((row) => row.ticker === ticker)).length} watchlist companies outside this index are not screened.</p> : null}
      {result.errors.length ? <p className="notice" role="alert">Complete the highlighted criteria to evaluate this search.</p> : result.unknown ? <p className="notice" role="status">{result.unknown} companies cannot be evaluated because a required value is missing or stale.</p> : null}
      {feed && !loading && !result.errors.length && !result.matches.length ? <p className="notice">No company matches this search. Try changing a threshold or removing a criterion.</p> : null}
      <div className="sheet free-sheet" role="region" aria-label="Matching companies">
        <table><thead><tr><th className="key" aria-sort={config.sort === "ticker" ? config.descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => change({ sort: "ticker", descending: config.sort === "ticker" ? !config.descending : false })}>Company{config.sort === "ticker" ? config.descending ? " ↓" : " ↑" : ""}</button></th><th>Sector</th>{config.columns.map((key) => <th key={key} aria-sort={config.sort === key ? config.descending ? "descending" : "ascending" : "none"}><button type="button" title={unitLabel(SCREEN_FIELD[key])} onClick={() => change({ sort: key, descending: config.sort === key ? !config.descending : true })}>{SCREEN_FIELD[key].label}{config.sort === key ? config.descending ? " ↓" : " ↑" : ""}</button></th>)}</tr></thead>
          <tbody>{visible.map((row) => <tr key={row.ticker}><th scope="row" className="key"><a href={`/t/s/${encodeURIComponent(row.ticker)}`}>{row.ticker}</a><small>{row.name}</small></th><td>{row.sector ?? "—"}</td>{config.columns.map((key) => <td key={key} title={cellNote(row, SCREEN_FIELD[key])}><button type="button" className="free-cell" aria-label={`${row.ticker}, ${SCREEN_FIELD[key].label}: ${display(row.values[key], SCREEN_FIELD[key])}. Show source and date.`} onClick={() => setDetail({ ticker: row.ticker, key })}>{display(row.values[key], SCREEN_FIELD[key])}</button></td>)}</tr>)}</tbody>
        </table>
      </div>
      {detail && detailRow ? <div className="free-source" role="status"><p><b>{detail.ticker} · {SCREEN_FIELD[detail.key].label}</b><br />{cellNote(detailRow, SCREEN_FIELD[detail.key])}</p><button type="button" onClick={() => setDetail(null)}>Close source</button></div> : null}
      <div className="free-pagination"><button type="button" disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}>Previous</button><span>Page {shownPage} / {pages}</span><button type="button" disabled={shownPage >= pages} onClick={() => setPage(shownPage + 1)}>Next</button></div>
      {result.matches.length ? <ExportMenu name={name || "fundamental-screener"} rows={exportRows} provenance={[
        `SEC filings; Nasdaq / Zacks consensus forecasts; Yahoo daily bars. S&P 500 membership ${feed?.asOf ?? "unavailable"}.`,
        `Match ${config.mode}: ${config.conditions.map((condition) => `${SCREEN_FIELD[condition.field].label} ${condition.op} ${condition.target === "field" ? SCREEN_FIELD[condition.other].label : condition.value}${condition.op === "between" ? ` to ${condition.upper}` : ""}`).join("; ") || "no numeric criteria"}.`,
        "Missing values remain empty. Source dates, the financial period and EPS/share bases are supplied per row. Market cap is in billions of the matching quote/filing currency.",
      ]} /> : null}
    </section>
  </div>;
}
