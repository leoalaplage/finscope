import { CANDLE_INTERVALS, type CandleInterval } from "@/lib/adapters/candles";
import { DEFAULT_STUDIES, STUDIES, type Study } from "@/lib/io/technicals";
import { cleanParams, type StudyParams } from "@/lib/io/study-params";

/**
 * The chart workspace as a value: how many charts, what each shows, which one
 * the side panel is setting up — and the named layouts a reader has kept.
 *
 * Read back from the reader's own browser, so everything here is checked on
 * the way in: a stored workspace from an older shape, or one edited by hand,
 * opens as the nearest sensible workspace rather than as an error.
 */

export const LAYOUTS = [1, 2, 4] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface ChartCell {
  symbol: string;
  interval: CandleInterval;
  studies: Study[];
  /** Prices on a logarithmic axis. */
  log: boolean;
  /** The axis in percent from the first candle on screen; never with the logarithmic one. */
  percent: boolean;
  /** Other symbols drawn over this one, rebased to it; three at most. */
  compare: string[];
  /** The studies' settings where the reader changed them (lib/io/study-params.ts). */
  params: StudyParams;
}

export const COMPARE_LIMIT = 3;
/** What the charts of a layout share: a symbol typed in one, an interval picked in one, the crosshair. */
export interface Links { symbol: boolean; interval: boolean; crosshair: boolean }
export const DEFAULT_LINKS: Links = { symbol: false, interval: false, crosshair: true };
export interface Workspace { layout: Layout; cells: ChartCell[]; active: number; links: Links }
export interface SavedLayout { name: string; workspace: Workspace }
export interface WorkspaceStore { current: Workspace; saved: SavedLayout[] }

/** Four cells always exist; a layout of one or two shows the first of them. */
const CELL_COUNT = 4;
const SYMBOL = /^\^?[A-Z0-9][A-Z0-9.-]{0,11}$/;
export const SAVED_LIMIT = 20;

const DEFAULT_SYMBOLS = ["AAPL", "NVDA", "MSFT", "^GSPC"];

export function defaultCell(symbol: string): ChartCell {
  return { symbol, interval: "1d", studies: [...DEFAULT_STUDIES, "volume"], log: false, percent: false, compare: [], params: {} };
}

export function defaultWorkspace(first?: string | null): Workspace {
  const symbols = first ? [first, ...DEFAULT_SYMBOLS.filter((symbol) => symbol !== first)] : DEFAULT_SYMBOLS;
  return { layout: 1, cells: symbols.slice(0, CELL_COUNT).map(defaultCell), active: 0, links: DEFAULT_LINKS };
}

function cleanCell(value: unknown, fallback: ChartCell): ChartCell {
  if (typeof value !== "object" || value == null) return fallback;
  const cell = value as Partial<ChartCell>;
  const symbol = typeof cell.symbol === "string" && SYMBOL.test(cell.symbol.toUpperCase()) ? cell.symbol.toUpperCase() : fallback.symbol;
  const interval = CANDLE_INTERVALS.includes(cell.interval as CandleInterval) ? cell.interval as CandleInterval : fallback.interval;
  const studies = Array.isArray(cell.studies) ? STUDIES.filter((study) => (cell.studies as unknown[]).includes(study)) : fallback.studies;
  const log = cell.log === true;
  const compare = Array.isArray(cell.compare)
    ? [...new Set(cell.compare.filter((item): item is string => typeof item === "string").map((item) => item.toUpperCase()))]
      .filter((item) => SYMBOL.test(item) && item !== symbol).slice(0, COMPARE_LIMIT)
    : [];
  return { symbol, interval, studies, log, percent: cell.percent === true && !log, compare, params: cleanParams(cell.params) };
}

export function cleanWorkspace(value: unknown): Workspace {
  const fallback = defaultWorkspace();
  if (typeof value !== "object" || value == null) return fallback;
  const raw = value as Partial<Workspace>;
  const layout = LAYOUTS.includes(raw.layout as Layout) ? raw.layout as Layout : fallback.layout;
  const cells = fallback.cells.map((cell, index) => cleanCell(Array.isArray(raw.cells) ? raw.cells[index] : null, cell));
  const active = Number.isInteger(raw.active) && raw.active! >= 0 && raw.active! < layout ? raw.active! : 0;
  const stored = (typeof raw.links === "object" && raw.links != null ? raw.links : {}) as Partial<Links>;
  const links: Links = {
    symbol: stored.symbol === true, interval: stored.interval === true, crosshair: stored.crosshair !== false,
  };
  return { layout, cells, active, links };
}

export function readWorkspaceStore(text: string | null): WorkspaceStore {
  try {
    const parsed = JSON.parse(text ?? "null") as Partial<WorkspaceStore> | null;
    const saved = Array.isArray(parsed?.saved)
      ? parsed.saved
        .filter((item): item is SavedLayout => typeof item?.name === "string" && item.name.trim().length > 0)
        .slice(0, SAVED_LIMIT)
        .map((item) => ({ name: item.name.trim().slice(0, 40), workspace: cleanWorkspace(item.workspace) }))
      : [];
    return { current: cleanWorkspace(parsed?.current), saved };
  } catch {
    return { current: defaultWorkspace(), saved: [] };
  }
}

/** Keeps a layout under a name, replacing one of the same name, newest first. */
export function saveLayout(store: WorkspaceStore, name: string): WorkspaceStore {
  const kept = name.trim().slice(0, 40);
  if (!kept) return store;
  const others = store.saved.filter((item) => item.name.toLowerCase() !== kept.toLowerCase());
  return { ...store, saved: [{ name: kept, workspace: store.current }, ...others].slice(0, SAVED_LIMIT) };
}

/** Points the active chart at a symbol, as a link to /t/chart?s=… asks. */
export function withSymbol(workspace: Workspace, symbol: string): Workspace {
  const upper = symbol.toUpperCase();
  if (!SYMBOL.test(upper)) return workspace;
  const cells = workspace.cells.map((cell, index) => (index === workspace.active ? { ...cell, symbol: upper } : cell));
  return { ...workspace, cells };
}

/**
 * A chart changed, and the charts linked to it with it: with the symbol
 * linked, a symbol typed in one goes to every chart; with the interval
 * linked, an interval picked in one does too.
 */
export function withCell(workspace: Workspace, index: number, cell: ChartCell): Workspace {
  const before = workspace.cells[index];
  const cells = workspace.cells.map((item, at) => {
    if (at === index) return cell;
    let next = item;
    if (workspace.links.symbol && before && cell.symbol !== before.symbol) next = { ...next, symbol: cell.symbol, compare: next.compare.filter((symbol) => symbol !== cell.symbol) };
    if (workspace.links.interval && before && cell.interval !== before.interval) next = { ...next, interval: cell.interval };
    return next;
  });
  return { ...workspace, cells };
}
