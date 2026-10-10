import { CANDLE_INTERVALS, type CandleInterval } from "@/lib/adapters/candles";
import { DEFAULT_STUDIES, STUDIES, type Study } from "@/lib/io/technicals";

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

export interface ChartCell { symbol: string; interval: CandleInterval; studies: Study[] }
export interface Workspace { layout: Layout; cells: ChartCell[]; active: number }
export interface SavedLayout { name: string; workspace: Workspace }
export interface WorkspaceStore { current: Workspace; saved: SavedLayout[] }

/** Four cells always exist; a layout of one or two shows the first of them. */
const CELL_COUNT = 4;
const SYMBOL = /^\^?[A-Z0-9][A-Z0-9.-]{0,11}$/;
export const SAVED_LIMIT = 20;

const DEFAULT_SYMBOLS = ["AAPL", "NVDA", "MSFT", "^GSPC"];

export function defaultCell(symbol: string): ChartCell {
  return { symbol, interval: "1d", studies: [...DEFAULT_STUDIES, "volume"] };
}

export function defaultWorkspace(first?: string | null): Workspace {
  const symbols = first ? [first, ...DEFAULT_SYMBOLS.filter((symbol) => symbol !== first)] : DEFAULT_SYMBOLS;
  return { layout: 1, cells: symbols.slice(0, CELL_COUNT).map(defaultCell), active: 0 };
}

function cleanCell(value: unknown, fallback: ChartCell): ChartCell {
  if (typeof value !== "object" || value == null) return fallback;
  const cell = value as Partial<ChartCell>;
  const symbol = typeof cell.symbol === "string" && SYMBOL.test(cell.symbol.toUpperCase()) ? cell.symbol.toUpperCase() : fallback.symbol;
  const interval = CANDLE_INTERVALS.includes(cell.interval as CandleInterval) ? cell.interval as CandleInterval : fallback.interval;
  const studies = Array.isArray(cell.studies) ? STUDIES.filter((study) => (cell.studies as unknown[]).includes(study)) : fallback.studies;
  return { symbol, interval, studies };
}

export function cleanWorkspace(value: unknown): Workspace {
  const fallback = defaultWorkspace();
  if (typeof value !== "object" || value == null) return fallback;
  const raw = value as Partial<Workspace>;
  const layout = LAYOUTS.includes(raw.layout as Layout) ? raw.layout as Layout : fallback.layout;
  const cells = fallback.cells.map((cell, index) => cleanCell(Array.isArray(raw.cells) ? raw.cells[index] : null, cell));
  const active = Number.isInteger(raw.active) && raw.active! >= 0 && raw.active! < layout ? raw.active! : 0;
  return { layout, cells, active };
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
