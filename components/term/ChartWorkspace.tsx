"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CandleChart, IntervalPicker, lastMoveOf, percent, price, tone, useCandles, type CompareSeries } from "@/components/io/CandleChart";
import type { Candles, CandleInterval } from "@/lib/adapters/candles";
import { chooseSymbol } from "@/components/io/choose-symbol";
import { INTERVAL_TITLES } from "@/lib/io/candle-chart";
import { STUDY_GROUPS, STUDY_NAMES, type Study } from "@/lib/io/technicals";
import { TOOL_GROUPS, TOOLS, type Drawing, type Tool } from "@/lib/term/drawings";
import { redoDrawings, setSymbolDrawings, undoDrawings, useDrawingStore } from "@/components/io/drawings-store";
import {
  COMPARE_LIMIT, LAYOUTS, readWorkspaceStore, saveLayout, withSymbol, type ChartCell, type Layout, type WorkspaceStore,
} from "@/lib/term/workspace";

const COMPARE_COLORS = ["#22d3ee", "#f472b6", "#a3e635"];

/** The candles of every compared symbol at the chart's interval, in one effect. */
function useCompared(symbols: string[], interval: CandleInterval): CompareSeries[] {
  const key = `${symbols.join(",")}:${interval}`;
  const [loaded, setLoaded] = useState<{ key: string; series: Record<string, Candles | null> }>({ key: "", series: {} });
  useEffect(() => {
    if (!symbols.length) return;
    const controller = new AbortController();
    Promise.all(symbols.map((symbol) => fetch(`/api/candles/${encodeURIComponent(symbol)}?interval=${interval}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<Candles> : null))
      .catch(() => null)))
      .then((answers) => {
        if (controller.signal.aborted) return;
        setLoaded({ key, series: Object.fromEntries(symbols.map((symbol, index) => [symbol, answers[index]])) });
      });
    return () => controller.abort();
    // `key` carries both inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return symbols.map((symbol, index) => ({
    symbol, color: COMPARE_COLORS[index % COMPARE_COLORS.length], candles: loaded.key === key ? loaded.series[symbol] ?? null : null,
  }));
}

/**
 * The chart workspace: one, two or four charts, the studies of the one in
 * focus in a side panel, drawing tools across the top, and layouts kept by
 * name.
 *
 * Everything a reader sets up here lives in their own browser — the workspace
 * as they left it, the layouts they saved, and what they drew on each symbol —
 * so it is there the next time without an account. The pure parts, the shape
 * of a workspace and of a drawing, are lib/term/workspace.ts and
 * lib/term/drawings.ts; this is only the screen.
 */

const STORE_KEY = "finscope.term.workspace.v1";
const CHANGE_EVENT = "finscope:term-workspace";

function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(CHANGE_EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(CHANGE_EVENT, notify); };
}
const readKey = (key: string) => () => { try { return localStorage.getItem(key); } catch { return null; } };
function writeKey(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* this visit only */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const readStore = readKey(STORE_KEY);

/** A ticker typed into a chart's header, resolved the way the site's search resolves one. */
function SymbolField({ symbol, onSymbol }: { symbol: string; onSymbol: (next: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const submit = async () => {
    const typed = (text ?? "").trim();
    setText(null);
    if (!typed || typed.toUpperCase() === symbol) return;
    if (/^\^/.test(typed)) { onSymbol(typed.toUpperCase()); return; }
    try {
      const response = await fetch(`/api/resolve?q=${encodeURIComponent(typed)}`);
      const matches = response.ok ? await response.json() as { ticker: string }[] : [];
      onSymbol(chooseSymbol(typed, matches) ?? typed.toUpperCase());
    } catch {
      onSymbol(typed.toUpperCase());
    }
  };
  return (
    <form className="t-symbol" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <input
        value={text ?? symbol}
        onFocus={(event) => { setText(""); event.currentTarget.select(); }}
        onBlur={() => setText(null)}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") { setText(null); event.currentTarget.blur(); } }}
        aria-label="Symbol"
        spellCheck={false}
        autoCapitalize="characters"
      />
    </form>
  );
}

function ChartCellView({
  cell, index, active, tool, magnet, compact, drawings, onFocus, onChange, onDrawings, onToolDone,
}: {
  cell: ChartCell;
  index: number;
  active: boolean;
  tool: Tool;
  magnet: boolean;
  compact: boolean;
  drawings: Drawing[];
  onToolDone: () => void;
  onFocus: () => void;
  onChange: (next: ChartCell) => void;
  onDrawings: ((next: Drawing[]) => void) | undefined;
}) {
  const { candles, error, loading } = useCandles(cell.symbol, cell.interval);
  const compared = useCompared(cell.compare, cell.interval);
  // The market, read only when the relative-strength pane is open.
  const [market] = useCompared(cell.studies.includes("rs") ? ["^GSPC"] : [], cell.interval);
  const [adding, setAdding] = useState<string | null>(null);
  const latest = lastMoveOf(candles);
  const studies = useMemo(() => new Set<Study>(cell.studies), [cell.studies]);
  const company = !cell.symbol.startsWith("^");
  return (
    <section className="t-chart-cell" data-active={active} onPointerDownCapture={onFocus} aria-label={`Chart ${index + 1}: ${cell.symbol}`}>
      <header className="t-panel-head">
        <span className="t-code">{index + 1}</span>
        <SymbolField symbol={cell.symbol} onSymbol={(symbol) => onChange({ ...cell, symbol })} />
        <span className="t-chart-name">{candles && candles.name !== candles.symbol ? candles.name : ""}</span>
        {latest ? (
          <span className="t-chart-last">
            {price(latest.close)}
            {latest.move != null && latest.base ? <em data-tone={tone(latest.move)}> {percent(latest.move / latest.base)}</em> : null}
          </span>
        ) : null}
        <div className="t-panel-actions">
          {cell.compare.map((symbol, position) => (
            <button
              key={symbol} type="button" className="t-chip" style={{ borderColor: COMPARE_COLORS[position % COMPARE_COLORS.length] }}
              title={`Stop comparing ${symbol}`} onClick={() => onChange({ ...cell, compare: cell.compare.filter((item) => item !== symbol) })}
            >
              {symbol} ✕
            </button>
          ))}
          {cell.compare.length < COMPARE_LIMIT ? (
            adding == null ? (
              <button type="button" className="t-chip" title="Draw another symbol over this one" onClick={() => setAdding("")}>+ CMP</button>
            ) : (
              <form onSubmit={(event) => {
                event.preventDefault();
                const symbol = adding.trim().toUpperCase();
                if (symbol && symbol !== cell.symbol && !cell.compare.includes(symbol)) onChange({ ...cell, compare: [...cell.compare, symbol] });
                setAdding(null);
              }}>
                <input
                  className="t-chip-input"
                  // The field the reader just asked for.
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus value={adding} onChange={(event) => setAdding(event.target.value)} onBlur={() => setAdding(null)}
                  onKeyDown={(event) => { if (event.key === "Escape") setAdding(null); }}
                  placeholder="^GSPC" aria-label="Symbol to compare" spellCheck={false}
                />
              </form>
            )
          ) : null}
          <button
            type="button" className="t-chip" aria-pressed={cell.log} title="Logarithmic price axis"
            onClick={() => onChange({ ...cell, log: !cell.log })}
          >
            LOG
          </button>
          <IntervalPicker interval={cell.interval} onInterval={(interval) => onChange({ ...cell, interval })} />
          {company ? <a href={`/t/s/${encodeURIComponent(cell.symbol)}`} title="Company screen">DES</a> : null}
        </div>
      </header>
      <CandleChart
        candles={candles} interval={cell.interval} loading={loading} error={error} studies={studies} compact={compact}
        label={`${cell.symbol}, ${INTERVAL_TITLES[cell.interval].toLowerCase()} candles`}
        drawings={drawings} tool={tool} onDrawingsChange={onDrawings} onToolDone={onToolDone} magnet={magnet}
        zoomable logScale={cell.log} compare={compared} benchmark={market?.candles ?? null}
      />
    </section>
  );
}

export function ChartWorkspace() {
  const storedText = useSyncExternalStore(subscribe, readStore, () => null);
  const store = useMemo(() => readWorkspaceStore(storedText), [storedText]);
  const drawn = useDrawingStore();
  const [tool, setTool] = useState<Tool>("cursor");
  const [magnet, setMagnet] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);

  const workspace = store.current;
  const commit = (next: WorkspaceStore) => writeKey(STORE_KEY, next);
  const update = (change: Partial<typeof workspace>) => commit({ ...store, current: { ...workspace, ...change } });
  const setCell = (index: number, cell: ChartCell) => update({ cells: workspace.cells.map((item, at) => (at === index ? cell : item)) });
  const activeCell = workspace.cells[workspace.active] ?? workspace.cells[0];

  /*
   * A link here names a symbol (`AAPL CHART`, the company screen's "open in
   * chart"); it goes into the chart in focus once, on arrival, and the address
   * is then cleaned so a reload does not overwrite what the reader did since.
   */
  useEffect(() => {
    const url = new URL(window.location.href);
    const asked = url.searchParams.get("s");
    if (!asked) return;
    const current = readWorkspaceStore(readStore());
    writeKey(STORE_KEY, { ...current, current: withSymbol(current.current, asked) });
    url.searchParams.delete("s");
    window.history.replaceState(null, "", url);
  }, []);

  /*
   * ⌥ and a letter picks a tool, as in the platforms readers come from: the
   * letters alone already belong to the command line. Escape puts the cursor
   * back.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === "Escape" && !typing) { setTool("cursor"); return; }
      // ⌘Z and ⇧⌘Z (Ctrl on other systems) undo and redo a change to the drawings.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.code === "KeyZ" && !typing) {
        event.preventDefault();
        if (event.shiftKey) redoDrawings(); else undoDrawings();
        return;
      }
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.code === "KeyG") { event.preventDefault(); setMagnet((on) => !on); return; }
      const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
      const found = TOOLS.find((item) => item.key === letter);
      if (!found) return;
      event.preventDefault();
      setTool(found.tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleStudy = (study: Study) => {
    const has = activeCell.studies.includes(study);
    setCell(workspace.active, { ...activeCell, studies: has ? activeCell.studies.filter((item) => item !== study) : [...activeCell.studies, study] });
  };
  const setDrawings = (symbol: string, next: Drawing[]) => setSymbolDrawings(symbol, next);
  const shown = workspace.cells.slice(0, workspace.layout);

  return (
    <div className="t-chartspace">
      <div className="t-chart-toolbar" role="toolbar" aria-label="Chart workspace">
        <span className="t-code">GP</span>
        <div className="seg" role="group" aria-label="Layout">
          {LAYOUTS.map((layout) => (
            <button
              key={layout} type="button" aria-pressed={workspace.layout === layout}
              title={layout === 1 ? "One chart" : layout === 2 ? "Two charts" : "Four charts"}
              onClick={() => update({ layout: layout as Layout, active: Math.min(workspace.active, layout - 1) })}
            >
              {layout === 1 ? "▣ 1" : layout === 2 ? "◫ 2" : "⊞ 4"}
            </button>
          ))}
        </div>
        <div className="t-tools" role="group" aria-label="Drawing tools">
          {TOOL_GROUPS.map((group) => (
            <div key={group.name} className="seg" role="group" aria-label={group.name}>
              {group.tools.map((item) => (
                <button
                  key={item.tool} type="button" aria-pressed={tool === item.tool} disabled={hidden && item.tool !== "cursor"}
                  title={`${item.title} · ⌥${item.key}`} aria-label={item.title} onClick={() => setTool(item.tool)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Drawing options">
          <button type="button" aria-pressed={magnet} title="Magnet: points snap to the open, high, low or close · ⌥G" onClick={() => setMagnet(!magnet)}>Magnet</button>
          <button type="button" aria-pressed={hidden} title="Hide every drawing" onClick={() => { setHidden(!hidden); setTool("cursor"); }}>Hide</button>
          <button type="button" title="Undo · ⌘Z" aria-label="Undo" onClick={() => undoDrawings()}>↶</button>
          <button type="button" title="Redo · ⇧⌘Z" aria-label="Redo" onClick={() => redoDrawings()}>↷</button>
        </div>
        <button
          type="button" className="t-text-button"
          onClick={() => setDrawings(activeCell.symbol, [])}
          disabled={!(drawn[activeCell.symbol]?.length)}
          title={`Remove every drawing on ${activeCell.symbol}`}
        >
          Clear {activeCell.symbol}
        </button>

        <div className="t-layouts">
          <span className="label">Layouts</span>
          {store.saved.length ? (
            <select
              aria-label="Open a saved layout" value=""
              onChange={(event) => {
                const found = store.saved.find((item) => item.name === event.target.value);
                if (found) commit({ ...store, current: found.workspace });
              }}
            >
              <option value="" disabled>Open…</option>
              {store.saved.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          ) : null}
          {naming == null ? (
            <button type="button" className="t-text-button" onClick={() => setNaming("")}>Save as…</button>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); commit(saveLayout(store, naming)); setNaming(null); }}>
              <input
                // A field the reader asked for by pressing "Save as…".
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus value={naming} onChange={(event) => setNaming(event.target.value)} placeholder="Name" aria-label="Layout name" maxLength={40}
                onKeyDown={(event) => { if (event.key === "Escape") setNaming(null); }}
              />
              <button type="submit" className="t-text-button">Save</button>
            </form>
          )}
          {store.saved.length ? (
            <select
              aria-label="Delete a saved layout" value=""
              onChange={(event) => commit({ ...store, saved: store.saved.filter((item) => item.name !== event.target.value) })}
            >
              <option value="" disabled>Delete…</option>
              {store.saved.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          ) : null}
        </div>
      </div>

      <div className="t-chart-body">
        <div className="t-charts" data-layout={workspace.layout}>
          {shown.map((cell, index) => (
            <ChartCellView
              key={index}
              cell={cell}
              index={index}
              active={workspace.layout > 1 && index === workspace.active}
              tool={tool}
              magnet={magnet}
              compact={workspace.layout === 4}
              drawings={hidden ? [] : drawn[cell.symbol] ?? []}
              onToolDone={() => setTool("cursor")}
              onFocus={() => { if (index !== workspace.active) update({ active: index }); }}
              onChange={(next) => setCell(index, next)}
              onDrawings={hidden ? undefined : (next) => setDrawings(cell.symbol, next)}
            />
          ))}
        </div>

        <aside className="t-studies" aria-label={`Studies on ${activeCell.symbol}`}>
          <header className="t-panel-head">
            <span className="t-code">IND</span>
            <h2>{activeCell.symbol}</h2>
          </header>
          {STUDY_GROUPS.map((group) => (
            <div className="t-study-group" key={group.name}>
              <h3>{group.name}</h3>
              {group.studies.map((study) => (
                <label key={study} className="t-study">
                  <input type="checkbox" checked={activeCell.studies.includes(study)} onChange={() => toggleStudy(study)} />
                  <span>{STUDY_NAMES[study]}</span>
                </label>
              ))}
            </div>
          ))}
          <p className="t-study-note">
            Wheel to zoom; drag the chart to move it in any direction, the price axis to stretch it, the dates to compress it;
            double-click to reset. Click a drawing to select, move or restyle it; Delete removes it. Drawings are saved on the
            symbol, across intervals, layouts and visits, and on the company screen: {drawn[activeCell.symbol]?.length ?? 0} on {activeCell.symbol}.
          </p>
        </aside>
      </div>
    </div>
  );
}
