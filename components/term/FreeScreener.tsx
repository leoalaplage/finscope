"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_SCREEN, SCREEN_FIELD, SCREEN_FIELDS, SCREEN_GROUPS, SCREEN_OPERATORS, SCREEN_STORAGE_KEY,
  conditionError, newCondition, readScreenStore, runScreen, saveScreen,
  type ScreenCondition, type ScreenConfig, type ScreenField, type ScreenRow, type ScreenStore,
} from "@/lib/free-screener";
import {
  FILTER_TABS, RECIPES, SHORT, SIGNED, VIEWS,
  conditionFor, customBounds, customCondition, describeCondition, formatValue, isQuickCondition, optionIndex,
} from "@/lib/screener-filters";
import type { ScreenerFeed } from "@/lib/screener-feed";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { ExportMenu } from "@/components/io/ExportMenu";

/**
 * EQS: a Finviz-style screener over the S&P 500 (lib/free-screener.ts).
 *
 * Filters first, as a grid of drop-downs with ready thresholds, tab by tab;
 * the matches straight under them in a dense table whose columns come in
 * views (Overview, Valuation, Growth…); advanced rules — one metric against
 * another, crossovers, any/all — for what the grid cannot say. Every cell
 * names its source and date on hover; a value that is missing stays empty
 * and never passes a filter.
 */

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

const date = (value: string | null) => (value ? value.slice(0, 10) : "unavailable");
const unitLabel = (field: ScreenField) => (field.unit === "percent" ? "%" : field.unit === "billions" ? "$ bn" : field.unit === "ratio" ? "×" : field.unit === "price" ? "price" : "");
const headerOf = (key: string) => SHORT[key] ?? SCREEN_FIELD[key]?.label ?? key;

function cellNote(row: ScreenRow, field: ScreenField) {
  const source = field.source === "fundamental" ? `SEC filings · ${row.period ?? "latest period"} · read ${date(row.dates.fundamental)}`
    : field.source === "consensus" ? `Analysts' forecast, Zacks via Nasdaq · read ${date(row.dates.consensus)}${field.key === "forwardPe" || field.key === "peg" ? ` · EPS: ${row.epsBasis ?? "unavailable"}` : ""}`
    : `Yahoo daily bars · session ${date(row.dates.technical)}`;
  const valuation = field.group === "Valuation" ? ` · price ${date(row.dates.price)} · shares ${row.sharesBasis ?? "unavailable"}` : "";
  const missing = row.values[field.key] == null ? ` · ${(field.group === "Valuation" ? row.reasons.valuation : row.reasons[field.source]) ?? "The source gives no usable value."}` : "";
  return `${field.label}: ${source}${valuation}${missing}`;
}

const PAGE_SIZES = [50, 100, 250];

export function FreeScreener() {
  const stored = useSyncExternalStore(subscribe, readStore, serverStore);
  const store = useMemo(() => readScreenStore(stored), [stored]);
  const config = store.current;
  const watchlist = useStoredWatchlist();
  const [feed, setFeed] = useState<ScreenerFeed | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [tab, setTab] = useState(FILTER_TABS[0].id);
  const [customOpen, setCustomOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const selected = store.saved.find((entry) => entry.id === store.selected);
  const name = nameOverride ?? selected?.name ?? "";
  const dirty = Boolean(selected && JSON.stringify(selected.config) !== JSON.stringify(config));
  const view = config.view ?? "custom";
  const columns = VIEWS.find((entry) => entry.id === view)?.columns ?? config.columns;
  const quick = config.conditions.filter(isQuickCondition);
  const advanced = config.conditions.filter((condition) => !isQuickCondition(condition));
  const result = useMemo(() => runScreen(feed?.rows ?? [], config, watchlist), [feed, config, watchlist]);
  const sectors = useMemo(() => [...new Set(feed?.rows.flatMap((row) => (row.sector ? [row.sector] : [])) ?? [])].sort(), [feed]);
  const pages = Math.max(1, Math.ceil(result.matches.length / pageSize));
  const shownPage = Math.min(page, pages);
  const visible = result.matches.slice((shownPage - 1) * pageSize, shownPage * pageSize);

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
        if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(load, 5 * 60_000); }
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  function persist(next: ScreenStore) {
    setMessage(writeScreenStore(next) ? "" : "Browser storage is unavailable: changes last for this tab only.");
  }
  function change(patch: Partial<ScreenConfig>) { setPage(1); persist({ ...store, current: { ...config, ...patch } }); }
  function setQuick(filterId: string, condition: ScreenCondition | null) {
    const id = `f:${filterId}`;
    const others = config.conditions.filter((entry) => entry.id !== id);
    change({ conditions: condition ? [...others, condition] : others });
  }
  function save(asNew: boolean) {
    if (!name.trim()) { setMessage("Name this screen to save it."); return; }
    if ((asNew || !selected) && store.saved.length >= 50) { setMessage("50 screens are saved: delete one first."); return; }
    if (result.errors.length) { setMessage("Complete the advanced rules before saving."); return; }
    persist(saveScreen(store, name, !asNew && selected ? selected.id : crypto.randomUUID()));
    setNameOverride(null);
  }
  function sortBy(key: string) {
    change({ sort: key, descending: config.sort === key ? !config.descending : key !== "ticker" });
  }
  function toggleColumn(key: string) {
    const present = config.columns.includes(key);
    if ((present && config.columns.length === 1) || (!present && config.columns.length >= 24)) return;
    change({ view: "custom", columns: present ? config.columns.filter((field) => field !== key) : [...config.columns, key] });
  }
  function moveColumn(at: number, by: number) {
    const next = [...config.columns];
    [next[at], next[at + by]] = [next[at + by], next[at]];
    change({ view: "custom", columns: next });
  }

  const tabCount = (tabId: string) => FILTER_TABS.find((entry) => entry.id === tabId)!.filters.filter((entry) => quick.some((condition) => condition.id === `f:${entry.id}`)).length;
  const exportRows = result.matches.map((row) => ({
    Ticker: row.ticker, Company: row.name, Sector: row.sector, Currency: row.currency,
    ...Object.fromEntries(columns.map((key) => [`${SCREEN_FIELD[key].label}${unitLabel(SCREEN_FIELD[key]) ? ` (${unitLabel(SCREEN_FIELD[key])})` : ""}`, row.values[key]])),
    "Financial period": row.period, "Filings read": row.dates.fundamental, "Price date": row.dates.price,
    "Consensus read": row.dates.consensus, "EPS forecast basis": row.epsBasis, "Technical session": row.dates.technical,
  }));
  const activeTab = FILTER_TABS.find((entry) => entry.id === tab);

  return (
    <div className="eqs">
      <div className="eqs-bar">
        <select aria-label="Saved screens" value={store.selected ?? ""} onChange={(event) => {
          const saved = store.saved.find((entry) => entry.id === event.target.value);
          setNameOverride(null); setPage(1); persist({ ...store, selected: saved?.id ?? null, current: saved?.config ?? DEFAULT_SCREEN });
        }}>
          <option value="">New screen</option>
          {store.saved.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <input className="eqs-name" aria-label="Screen name" value={name} maxLength={60} placeholder="Name this screen" onChange={(event) => setNameOverride(event.target.value)} />
        <button type="button" className="t-chip" onClick={() => save(false)}>{selected ? (dirty ? "Update ●" : "Saved") : "Save"}</button>
        {selected ? <>
          <button type="button" className="t-chip" onClick={() => save(true)}>Save as</button>
          <button type="button" className="t-chip" onClick={() => { persist({ ...store, selected: null, saved: store.saved.filter((entry) => entry.id !== selected.id) }); setNameOverride(null); }}>Delete</button>
        </> : null}
        <span className="eqs-sep" />
        <select aria-label="Universe" value={config.scope} onChange={(event) => change({ scope: event.target.value as ScreenConfig["scope"] })}>
          <option value="index">S&amp;P 500</option><option value="watchlist">My watchlist</option>
        </select>
        <select aria-label="Sector" value={config.sectors.length === 1 ? config.sectors[0] : config.sectors.length ? "__many" : ""} onChange={(event) => change({ sectors: event.target.value ? [event.target.value] : [] })}>
          <option value="">Any sector</option>
          {config.sectors.length > 1 ? <option value="__many" disabled>{config.sectors.length} sectors</option> : null}
          {sectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
        </select>
        <input type="search" className="eqs-find" aria-label="Find a company" value={config.query} placeholder="Ticker or name" onChange={(event) => change({ query: event.target.value })} />
        <span className="eqs-sep" />
        <span className="t-dim">Screens</span>
        {RECIPES.map((recipe) => (
          <button key={recipe.name} type="button" className="t-chip" onClick={() => {
            persist({ ...store, selected: null, current: { ...DEFAULT_SCREEN, conditions: recipe.conditions, view: recipe.view, sort: recipe.sort, descending: recipe.descending } });
            setNameOverride(null); setPage(1);
          }}>{recipe.name}</button>
        ))}
      </div>
      {message ? <p className="eqs-message" role="status">{message}</p> : null}

      <section className="eqs-filters" aria-label="Filters">
        <div className="eqs-tabs" role="tablist" aria-label="Filter groups">
          {FILTER_TABS.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)}>
              {entry.label}{tabCount(entry.id) ? <b>{tabCount(entry.id)}</b> : null}
            </button>
          ))}
          <button type="button" role="tab" aria-selected={tab === "advanced"} onClick={() => setTab("advanced")}>
            Advanced rules{advanced.length ? <b>{advanced.length}</b> : null}
          </button>
          <span className="eqs-match">
            Match
            <select aria-label="Match" value={config.mode} onChange={(event) => change({ mode: event.target.value as ScreenConfig["mode"] })}>
              <option value="all">all filters</option><option value="any">any filter</option>
            </select>
          </span>
        </div>

        {activeTab ? (
          <div className="eqs-grid">
            {activeTab.filters.map((entry) => {
              const condition = quick.find((item) => item.id === `f:${entry.id}`);
              const index = condition ? optionIndex(entry.id, condition) : -2;
              const custom = customOpen === entry.id || index === -1;
              const bounds = condition && index === -1 ? customBounds(condition) : { low: "", high: "" };
              const field = SCREEN_FIELD[entry.field];
              return (
                <div key={entry.id} className="eqs-filter" data-active={condition ? true : undefined}>
                  <label htmlFor={`eqs-${entry.id}`}>{entry.label}</label>
                  <select id={`eqs-${entry.id}`} value={custom ? "custom" : index >= 0 ? String(index) : ""} onChange={(event) => {
                    const value = event.target.value;
                    if (value === "custom") { setCustomOpen(entry.id); return; }
                    setCustomOpen(null);
                    setQuick(entry.id, value === "" ? null : conditionFor(entry.id, entry.options[Number(value)]));
                  }}>
                    <option value="">Any</option>
                    {entry.options.map((option, at) => <option key={option.label} value={at}>{option.label}</option>)}
                    {field.source !== "technical" || !entry.options.some((option) => option.other) ? <option value="custom">Custom range…</option> : null}
                  </select>
                  {custom ? (
                    <span className="eqs-range">
                      <input type="number" step="any" aria-label={`${entry.label} from`} placeholder="min" defaultValue={bounds.low}
                        onBlur={(event) => setQuick(entry.id, customCondition(entry.id, event.target.value, (event.target.nextElementSibling?.nextElementSibling as HTMLInputElement | null)?.value ?? ""))} />
                      <span>to</span>
                      <input type="number" step="any" aria-label={`${entry.label} to`} placeholder="max" defaultValue={bounds.high}
                        onBlur={(event) => setQuick(entry.id, customCondition(entry.id, (event.target.previousElementSibling?.previousElementSibling as HTMLInputElement | null)?.value ?? "", event.target.value))} />
                      <span className="t-dim">{unitLabel(field)}</span>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="eqs-advanced">
            {advanced.map((condition, index) => (
              <Rule key={condition.id} condition={condition} index={index}
                onChange={(patch) => change({ conditions: config.conditions.map((entry) => (entry.id === condition.id ? { ...entry, ...patch } : entry)) })}
                onRemove={() => change({ conditions: config.conditions.filter((entry) => entry.id !== condition.id) })} />
            ))}
            <button type="button" className="t-chip" disabled={config.conditions.length >= 30} onClick={() => change({ conditions: [...config.conditions, newCondition(crypto.randomUUID())] })}>+ Rule</button>
            <span className="t-dim"> One metric against a number or another metric, ranges, crossovers over the last two sessions. Percentages in points: 15 is 15%.</span>
          </div>
        )}

        {config.conditions.length ? (
          <div className="eqs-chips">
            {config.conditions.map((condition) => (
              <button key={condition.id} type="button" className="eqs-chip" data-invalid={conditionError(condition) ? true : undefined}
                title="Remove this filter" onClick={() => { if (customOpen && condition.id === `f:${customOpen}`) setCustomOpen(null); change({ conditions: config.conditions.filter((entry) => entry.id !== condition.id) }); }}>
                {describeCondition(condition)} <span aria-hidden="true">×</span>
              </button>
            ))}
            <button type="button" className="eqs-clear" onClick={() => { setCustomOpen(null); change({ conditions: [] }); }}>Clear all</button>
          </div>
        ) : null}
      </section>

      <section className="eqs-results" aria-label="Results">
        <div className="eqs-views">
          <div className="eqs-tabs" role="tablist" aria-label="Columns">
            {VIEWS.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={view === entry.id} onClick={() => { setPicking(false); change({ view: entry.id }); }}>{entry.label}</button>
            ))}
            <button type="button" role="tab" aria-selected={view === "custom"} onClick={() => { change({ view: "custom" }); setPicking(view === "custom" ? !picking : true); }}>
              Custom{view === "custom" ? (picking ? " ▴" : " ▾") : ""}
            </button>
          </div>
          <span className="eqs-count" aria-live="polite">
            <b>{result.matches.length}</b> of {result.considered}
            {result.unknown ? <span className="t-dim" title="A filter needs a value these companies do not have yet."> · {result.unknown} not evaluable</span> : null}
          </span>
          <select aria-label="Rows per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} rows</option>)}
          </select>
          {result.matches.length ? <ExportMenu name={name || "screener"} rows={exportRows} provenance={[
            `SEC filings; analysts' consensus (Zacks via Nasdaq); Yahoo daily bars. S&P 500 membership ${feed?.asOf ?? "unavailable"}.`,
            `Match ${config.mode}: ${config.conditions.map(describeCondition).join("; ") || "no filters"}.`,
            "Missing values stay empty. Each row carries its financial period, source dates and EPS basis.",
          ]} /> : null}
        </div>

        {view === "custom" && picking ? (
          <div className="eqs-picker">
            <div className="eqs-order" aria-label="Column order">
              {config.columns.map((key, at) => (
                <span key={key}>
                  <button type="button" aria-label={`Move ${SCREEN_FIELD[key].label} left`} disabled={at === 0} onClick={() => moveColumn(at, -1)}>‹</button>
                  {headerOf(key)}
                  <button type="button" aria-label={`Move ${SCREEN_FIELD[key].label} right`} disabled={at === config.columns.length - 1} onClick={() => moveColumn(at, 1)}>›</button>
                </span>
              ))}
            </div>
            <div className="eqs-groups">
              {SCREEN_GROUPS.map((group) => (
                <fieldset key={group}>
                  <legend>{group}</legend>
                  {SCREEN_FIELDS.filter((field) => field.group === group).map((field) => (
                    <label key={field.key}>
                      <input type="checkbox" checked={config.columns.includes(field.key)} onChange={() => toggleColumn(field.key)} />{field.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </div>
        ) : null}

        {loading && !feed ? <p className="eqs-message" role="status">Reading the financial, consensus and technical snapshots…</p> : null}
        {error ? <p className="eqs-message" role="alert">{error}{feed ? " The last snapshot read stays on screen." : ""}</p> : null}
        {result.errors.length ? <p className="eqs-message" role="alert">An advanced rule is incomplete: complete or remove it to see results.</p> : null}
        {feed && !loading && !result.errors.length && !result.matches.length ? <p className="eqs-message">No company passes these filters.</p> : null}

        <div className="sheet eqs-sheet" role="region" aria-label="Matching companies">
          <table>
            <thead>
              <tr>
                <th className="eqs-n" scope="col">#</th>
                <th className="key" scope="col" aria-sort={config.sort === "ticker" ? (config.descending ? "descending" : "ascending") : "none"}>
                  <button type="button" className="t-sort" onClick={() => sortBy("ticker")}>Ticker{config.sort === "ticker" ? (config.descending ? " ▼" : " ▲") : ""}</button>
                </th>
                <th className="eqs-company" scope="col">Company</th>
                <th className="eqs-sector" scope="col">Sector</th>
                {columns.map((key) => (
                  <th key={key} scope="col" title={`${SCREEN_FIELD[key].label}${unitLabel(SCREEN_FIELD[key]) ? ` · ${unitLabel(SCREEN_FIELD[key])}` : ""}`} aria-sort={config.sort === key ? (config.descending ? "descending" : "ascending") : "none"}>
                    <button type="button" className="t-sort" onClick={() => sortBy(key)}>
                      {headerOf(key)}{config.sort === key ? (config.descending ? " ▼" : " ▲") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, at) => (
                <tr key={row.ticker}>
                  <td className="eqs-n">{(shownPage - 1) * pageSize + at + 1}</td>
                  <th scope="row" className="key"><a href={`/t/s/${encodeURIComponent(row.ticker)}`}>{row.ticker}</a></th>
                  <td className="eqs-company" title={row.name}>{row.name}</td>
                  <td className="eqs-sector">{row.sector ?? "—"}</td>
                  {columns.map((key) => {
                    const field = SCREEN_FIELD[key];
                    const value = row.values[key];
                    return (
                      <td key={key} title={cellNote(row, field)} data-source={field.source}
                        data-dir={SIGNED.has(key) && value != null && value !== 0 ? (value > 0 ? "up" : "down") : undefined}>
                        {formatValue(value, field, row.currency)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="eqs-foot">
          {pages > 1 ? (
            <span className="eqs-pages">
              <button type="button" className="t-chip" disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}>‹</button>
              {Array.from({ length: pages }, (_, index) => index + 1).map((number) => (
                <button key={number} type="button" className="t-chip" aria-pressed={number === shownPage} onClick={() => setPage(number)}>{number}</button>
              ))}
              <button type="button" className="t-chip" disabled={shownPage >= pages} onClick={() => setPage(shownPage + 1)}>›</button>
            </span>
          ) : null}
          {feed ? (
            <span className="t-dim">
              Data · filings {feed.coverage.fundamental}/{feed.members} · prices {feed.coverage.price}/{feed.members} · consensus {feed.coverage.consensus}/{feed.members} · technicals {feed.coverage.technical}/{feed.members}.
              {" "}Consensus is a forecast (Zacks via Nasdaq), read daily; hover a value for its source and date. Index membership {feed.asOf}.
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function MetricOptions({ compatible }: { compatible?: ScreenField }) {
  return <>{SCREEN_GROUPS.map((group) => (
    <optgroup key={group} label={group}>
      {SCREEN_FIELDS.filter((field) => field.group === group && (!compatible || field.unit === compatible.unit)).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
    </optgroup>
  ))}</>;
}

/** One advanced rule on a single line: metric, operator, a number or another metric. */
function Rule({ condition, index, onChange, onRemove }: { condition: ScreenCondition; index: number; onChange: (patch: Partial<ScreenCondition>) => void; onRemove: () => void }) {
  const field = SCREEN_FIELD[condition.field];
  const error = conditionError(condition);
  const noTarget = condition.op === "present" || condition.op === "missing";
  const otherAvailable = SCREEN_FIELD[condition.other]?.unit === field.unit;
  return (
    <div className="t-rule-row eqs-rule" data-invalid={error ? true : undefined}>
      <span className="t-rule-and">{index ? "and" : "if"}</span>
      <select aria-label={`Rule ${index + 1} metric`} value={condition.field} onChange={(event) => {
        const picked = SCREEN_FIELD[event.target.value];
        const other = SCREEN_FIELDS.find((candidate) => candidate.key !== picked.key && candidate.unit === picked.unit)?.key ?? picked.key;
        onChange({ field: picked.key, other, op: picked.source !== "technical" && condition.op.startsWith("cross") ? "gt" : condition.op });
      }}><MetricOptions /></select>
      <select aria-label={`Rule ${index + 1} operator`} value={condition.op} onChange={(event) => onChange({ op: event.target.value as ScreenCondition["op"] })}>
        {SCREEN_OPERATORS.filter(([op]) => field.source === "technical" || !op.startsWith("cross")).map(([op, label]) => <option key={op} value={op}>{label}</option>)}
      </select>
      {!noTarget && condition.op !== "between" ? (
        <select aria-label={`Rule ${index + 1} compares with`} value={condition.target} onChange={(event) => onChange({ target: event.target.value as ScreenCondition["target"], other: otherAvailable ? condition.other : field.key })}>
          <option value="number">a number</option><option value="field">a metric</option>
        </select>
      ) : null}
      {!noTarget && condition.target === "field" && condition.op !== "between" ? (
        <select aria-label={`Rule ${index + 1} other metric`} value={condition.other} onChange={(event) => onChange({ other: event.target.value })}><MetricOptions compatible={field} /></select>
      ) : !noTarget ? (
        <input type="number" step="any" aria-label={`Rule ${index + 1} value`} value={condition.value} aria-invalid={!!error} onChange={(event) => onChange({ value: event.target.value })} />
      ) : null}
      {condition.op === "between" ? <><span className="t-rule-op">and</span><input type="number" step="any" aria-label={`Rule ${index + 1} upper bound`} value={condition.upper} aria-invalid={!!error} onChange={(event) => onChange({ upper: event.target.value })} /></> : null}
      <span className="t-dim">{unitLabel(field)}</span>
      <button type="button" className="t-chip" aria-label={`Remove rule ${index + 1}`} onClick={onRemove}>×</button>
      {error ? <span className="eqs-error" role="alert">{error}</span> : null}
    </div>
  );
}
