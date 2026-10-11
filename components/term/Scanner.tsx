"use client";

import { useEffect, useMemo, useState } from "react";
import { useStoredWatchlist, parseTickers } from "@/components/io/watchlist";
import { price, shortDate } from "@/components/io/format";
import type { Candles } from "@/lib/adapters/candles";
import {
  allHold, cleanConditions, computeSeries, FIELD_OF, fieldsOf, readSnapshot, SCAN_PRESETS, snapshotOf,
  type Condition, type Field, type Snapshot,
} from "@/lib/term/rules";
import { ConditionEditor } from "./ConditionEditor";
import { Panel } from "./Panel";
import { useStoredText, writeStored } from "./stored";

/**
 * The technical scanner: a rule, run over a universe, on the last daily bar.
 *
 * The S&P 500 comes precomputed from the scheduled run (/api/scan); the
 * reader's watchlist, or any list pasted in, is read here, one price history
 * per company, six at a time. The rule itself is evaluated in the browser
 * either way, so changing it answers at once.
 */

const KEY = "finscope.term.scan.v1";
type Universe = "sp500" | "watchlist" | "custom";
interface Row { ticker: string; name: string; asOf: number; values: Snapshot }
interface Stored { universe: Universe; custom: string; conditions: Condition[] }

const DEFAULTS: Stored = { universe: "sp500", custom: "", conditions: SCAN_PRESETS[0].conditions };

function readStored(text: string | null): Stored {
  try {
    const raw = JSON.parse(text ?? "null") as Partial<Stored> | null;
    if (!raw) return DEFAULTS;
    return {
      universe: raw.universe === "watchlist" || raw.universe === "custom" ? raw.universe : "sp500",
      custom: typeof raw.custom === "string" ? raw.custom.slice(0, 2000) : "",
      conditions: cleanConditions(raw.conditions),
    };
  } catch {
    return DEFAULTS;
  }
}

/** Price histories read in the browser, for a list the index snapshot does not hold. */
function useListRows(tickers: string[], enabled: boolean) {
  const key = tickers.join(",");
  const [state, setState] = useState<{ key: string; rows: Row[]; done: number }>({ key: "", rows: [], done: 0 });
  useEffect(() => {
    if (!enabled || !key) return;
    const controller = new AbortController();
    const queue = key.split(",");
    const rows: Row[] = [];
    let done = 0;
    const worker = async () => {
      for (let ticker = queue.shift(); ticker; ticker = queue.shift()) {
        try {
          const response = await fetch(`/api/candles/${encodeURIComponent(ticker)}?interval=1d`, { signal: controller.signal });
          if (response.ok) {
            const candles = await response.json() as Candles;
            if (candles.c?.length > 1) {
              rows.push({ ticker, name: candles.name ?? ticker, asOf: candles.t[candles.t.length - 1], values: snapshotOf(computeSeries(candles)) });
            }
          }
        } catch {
          if (controller.signal.aborted) return;
        }
        done++;
        if (!controller.signal.aborted) setState({ key, rows: [...rows], done });
      }
    };
    void Promise.all(Array.from({ length: 6 }, worker));
    return () => controller.abort();
  }, [key, enabled]);
  return state.key === key ? state : { key, rows: [], done: 0 };
}

const formatValue = (field: Field, value: number | null) => {
  if (value == null) return "—";
  const unit = FIELD_OF[field].unit;
  if (unit === "percent") return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
  if (unit === "volume") return value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(0)}K` : value.toFixed(0);
  if (unit === "ratio") return `${value.toFixed(2)}×`;
  if (unit === "pattern") return value ? "yes" : "";
  if (unit === "index") return value.toFixed(1);
  return price(value, null);
};

export function Scanner() {
  const stored = readStored(useStoredText(KEY));
  const save = (change: Partial<Stored>) => writeStored(KEY, { ...stored, ...change });
  const watchlist = useStoredWatchlist();
  const customTickers = useMemo(() => parseTickers(stored.custom).slice(0, 60), [stored.custom]);
  const [index, setIndex] = useState<{ rows: Row[]; builtAt: string | null; members: number; building: boolean } | null>(null);
  const [sort, setSort] = useState<{ field: Field | "ticker"; down: boolean }>({ field: "chg1", down: true });

  /*
   * The index snapshot, asked again every fifteen seconds while it is still
   * being filled, so the matches grow in front of the reader.
   */
  useEffect(() => {
    if (stored.universe !== "sp500") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => fetch("/api/scan", { signal: controller.signal })
      .then((response) => response.json() as Promise<{ rows?: Row[]; builtAt?: string; members?: number; building?: boolean }>)
      .then((body) => {
        setIndex({ rows: body.rows ?? [], builtAt: body.builtAt ?? null, members: body.members ?? 0, building: Boolean(body.building) });
        if (body.building) timer = setTimeout(read, 15_000);
      })
      .catch(() => { if (!controller.signal.aborted) setIndex({ rows: [], builtAt: null, members: 0, building: false }); });
    void read();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [stored.universe]);

  const list = useListRows(stored.universe === "watchlist" ? watchlist : customTickers, stored.universe !== "sp500");
  const universeRows = useMemo(() => (stored.universe === "sp500" ? index?.rows ?? [] : list.rows), [stored.universe, index, list.rows]);
  const used = fieldsOf(stored.conditions);
  const columns = (["close", "chg1", ...used.filter((field) => field !== "close" && field !== "chg1")] as Field[]).slice(0, 8);

  const matches = useMemo(() => {
    const found = universeRows.filter((row) => allHold(stored.conditions, readSnapshot(row.values)));
    const value = (row: Row) => (sort.field === "ticker" ? null : row.values[sort.field]?.[0] ?? null);
    return found.sort((a, b) => {
      if (sort.field === "ticker") return sort.down ? b.ticker.localeCompare(a.ticker) : a.ticker.localeCompare(b.ticker);
      const left = value(a) ?? -Infinity;
      const right = value(b) ?? -Infinity;
      return sort.down ? right - left : left - right;
    });
  }, [universeRows, stored.conditions, sort]);

  const loading = stored.universe === "sp500" ? index == null : list.done < (stored.universe === "watchlist" ? watchlist.length : customTickers.length);
  const total = stored.universe === "sp500" ? index?.members ?? 0 : stored.universe === "watchlist" ? watchlist.length : customTickers.length;
  const latest = universeRows.reduce((most, row) => Math.max(most, row.asOf), 0);
  const header = (field: Field | "ticker", text: string, key = true) => (
    <th
      className={key ? "key" : undefined} aria-sort={sort.field === field ? (sort.down ? "descending" : "ascending") : "none"}
    >
      <button type="button" className="t-sort" onClick={() => setSort({ field, down: sort.field === field ? !sort.down : true })}>
        {text}{sort.field === field ? (sort.down ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div className="t-grid t-scan">
      <Panel code="SCAN" title="Rule" area="rule" actions={
        <select
          aria-label="Start from a preset" value=""
          onChange={(event) => { const preset = SCAN_PRESETS[Number(event.target.value)]; if (preset) save({ conditions: preset.conditions }); }}
        >
          <option value="" disabled>Presets…</option>
          {SCAN_PRESETS.map((preset, at) => <option key={preset.name} value={at}>{preset.name}</option>)}
        </select>
      }>
        <div className="t-panel-pad">
          <div className="t-scan-universe">
            <div className="seg" role="group" aria-label="Universe">
              <button type="button" aria-pressed={stored.universe === "sp500"} onClick={() => save({ universe: "sp500" })}>S&amp;P 500</button>
              <button type="button" aria-pressed={stored.universe === "watchlist"} onClick={() => save({ universe: "watchlist" })}>Watchlist</button>
              <button type="button" aria-pressed={stored.universe === "custom"} onClick={() => save({ universe: "custom" })}>List</button>
            </div>
            {stored.universe === "custom" ? (
              <input
                className="t-scan-list" value={stored.custom} onChange={(event) => save({ custom: event.target.value })}
                placeholder="AMD, SMCI, ARM, TSM…" aria-label="Tickers to scan" spellCheck={false}
              />
            ) : null}
          </div>
          <ConditionEditor conditions={stored.conditions} onChange={(conditions) => save({ conditions })} label="Scan rule" />
          <p className="t-study-note">
            Daily bars, read on the last close{latest ? ` (${shortDate(new Date(latest * 1000).toISOString())})` : ""}. Every line must hold.
            {stored.universe === "sp500" && index?.builtAt ? ` Index snapshot ${universeRows.length} of ${index.members}, refreshed through the day.` : ""}
          </p>
        </div>
      </Panel>

      <Panel code="SCAN" id="scan-matches" title={`Matches · ${matches.length} of ${universeRows.length}${loading && total ? ` · reading ${stored.universe === "sp500" ? "" : `${list.done}/${total}`}` : ""}`} area="hits">
        {stored.universe === "sp500" && index?.building ? (
          <p className="t-empty">Reading the index: {index.rows.length} of {index.members} companies so far. Matches appear as they are read.</p>
        ) : null}
        {!stored.conditions.length ? <p className="t-empty">Add a condition to scan.</p> : null}
        {matches.length ? (
          <div className="sheet t-scan-sheet">
            <table>
              <thead>
                <tr>
                  {header("ticker", "Ticker")}
                  <th className="key">Name</th>
                  {columns.map((field) => <th key={field}>{headerButton(field, sort, setSort)}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {matches.map((row) => (
                  <tr key={row.ticker}>
                    <td className="key"><a href={`/t/chart?s=${encodeURIComponent(row.ticker)}`}>{row.ticker}</a></td>
                    <td className="key t-dim">{row.name}</td>
                    {columns.map((field) => {
                      const value = row.values[field]?.[0] ?? null;
                      const unit = FIELD_OF[field].unit;
                      return (
                        <td key={field} data-dir={unit === "percent" && value != null ? (value < 0 ? "down" : "up") : undefined}>
                          {formatValue(field, value)}
                        </td>
                      );
                    })}
                    <td className="t-row-links">
                      <a href={`/t/s/${encodeURIComponent(row.ticker)}`}>DES</a>
                      <a href={`/t/backtest?s=${encodeURIComponent(row.ticker)}`}>BT</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading && stored.conditions.length ? <p className="t-empty">Nothing in this universe meets every line today.</p> : null}
      </Panel>
    </div>
  );
}

function headerButton(field: Field, sort: { field: Field | "ticker"; down: boolean }, setSort: (next: { field: Field | "ticker"; down: boolean }) => void) {
  return (
    <button type="button" className="t-sort" onClick={() => setSort({ field, down: sort.field === field ? !sort.down : true })}>
      {FIELD_OF[field].name}{sort.field === field ? (sort.down ? " ↓" : " ↑") : ""}
    </button>
  );
}
