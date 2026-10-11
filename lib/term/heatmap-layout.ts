import { squarify, type Rect } from "@/lib/treemap";

/**
 * A market map's geometry: sectors, then industries inside them, then
 * companies inside those, each by market value.
 *
 * A sector large enough carries a header strip with its name across the top,
 * and an industry large enough a thinner one, the way the maps traders read
 * are drawn; the companies fill what is left. Pure, so the layout is tested
 * apart from the drawing.
 */

export interface MapItem { ticker: string; sector: string; industry: string; cap: number }

export interface PlacedTile<T> extends Rect { item: T }
export interface PlacedIndustry<T> extends Rect { name: string; header: boolean; tiles: PlacedTile<T>[] }
export interface PlacedSector<T> extends Rect { name: string; header: boolean; industries: PlacedIndustry<T>[] }

export const SECTOR_HEADER = 16;
export const INDUSTRY_HEADER = 12;

const inset = (rect: Rect, top: number): Rect => ({ x: rect.x, y: rect.y + top, width: rect.width, height: Math.max(0, rect.height - top) });

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

const total = <T extends MapItem>(items: T[]) => items.reduce((sum, item) => sum + item.cap, 0);

export function layoutMap<T extends MapItem>(items: T[], area: Rect, options: { industries?: boolean } = {}): PlacedSector<T>[] {
  const sized = items.filter((item) => Number.isFinite(item.cap) && item.cap > 0);
  const sectors = [...groupBy(sized, (item) => item.sector)].map(([name, members]) => ({ weight: total(members), data: { name, members } }));
  return squarify(sectors, area).map((sector) => {
    const header = sector.width > 48 && sector.height > 40;
    const inner = inset(sector, header ? SECTOR_HEADER : 0);
    const industries = options.industries === false
      ? [{ weight: total(sector.data.members), data: { name: sector.data.name, members: sector.data.members } }]
      : [...groupBy(sector.data.members, (item) => item.industry)].map(([name, members]) => ({ weight: total(members), data: { name, members } }));
    return {
      x: sector.x, y: sector.y, width: sector.width, height: sector.height, name: sector.data.name, header,
      industries: squarify(industries, inner).map((industry) => {
        const labelled = options.industries !== false && industry.width > 80 && industry.height > 44;
        const room = inset(industry, labelled ? INDUSTRY_HEADER : 0);
        return {
          x: industry.x, y: industry.y, width: industry.width, height: industry.height, name: industry.data.name, header: labelled,
          tiles: squarify(industry.data.members.map((item) => ({ weight: item.cap, data: item })), room)
            .map((tile) => ({ x: tile.x, y: tile.y, width: tile.width, height: tile.height, item: tile.data })),
        };
      }),
    };
  });
}

/**
 * The colour of a move: red through a slate grey to green, saturating at
 * `full` percent either way, on the stops market maps use.
 */
const STOPS: Array<[number, [number, number, number]]> = [
  [-1, [246, 53, 56]], [-2 / 3, [191, 64, 69]], [-1 / 3, [139, 68, 78]], [0, [65, 69, 84]],
  [1 / 3, [53, 118, 78]], [2 / 3, [47, 158, 79]], [1, [48, 204, 90]],
];

export function moveColor(change: number | null, full: number): string {
  if (change == null || !Number.isFinite(change)) return "rgb(42, 46, 57)";
  const at = Math.max(-1, Math.min(1, change / full));
  for (let index = 1; index < STOPS.length; index++) {
    const [to, high] = STOPS[index];
    const [from, low] = STOPS[index - 1];
    if (at <= to) {
      const share = (at - from) / (to - from);
      const mix = low.map((channel, k) => Math.round(channel + (high[k] - channel) * share));
      return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
    }
  }
  return "rgb(48, 204, 90)";
}
