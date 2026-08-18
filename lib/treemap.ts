/**
 * A squarified treemap.
 *
 * The algorithm is Bruls, Huizing and van Wijk's: lay items into the shorter
 * side of the remaining space, adding to a row for as long as doing so improves
 * the worst aspect ratio in it, then close the row and recurse on what is left.
 * The naive alternative — slice-and-dice, which just divides the axis — makes
 * the small items into hairlines, and a tile too thin to hold its own ticker is
 * not a tile.
 *
 * Nothing here knows about markets. It takes weights and a rectangle.
 */

export interface Rect { x: number; y: number; width: number; height: number }
export interface Weighted<T> { weight: number; data: T }
export interface Placed<T> extends Rect { data: T }

/**
 * The worst aspect ratio in a row, given the side it is laid along.
 *
 * This is the quantity being minimised: a row is worth extending for exactly
 * as long as adding the next item does not make its least square-like member
 * worse than it already is.
 */
function worstRatio(areas: number[], side: number): number {
  if (!areas.length || side <= 0) return Infinity;
  const sum = areas.reduce((total, area) => total + area, 0);
  if (sum <= 0) return Infinity;
  const max = Math.max(...areas), min = Math.min(...areas);
  const sum2 = sum * sum, side2 = side * side;
  return Math.max((side2 * max) / sum2, sum2 / (side2 * min));
}

/** Places one finished row along the short edge and returns what is left. */
function placeRow<T>(
  row: Array<Weighted<T> & { area: number }>,
  rect: Rect,
  output: Array<Placed<T>>,
): Rect {
  const total = row.reduce((sum, item) => sum + item.area, 0);
  if (total <= 0) return rect;
  const horizontal = rect.width < rect.height;

  if (horizontal) {
    // The row runs left to right across the top, and is `depth` tall.
    const depth = total / rect.width;
    let x = rect.x;
    for (const item of row) {
      const width = item.area / depth;
      output.push({ x, y: rect.y, width, height: depth, data: item.data });
      x += width;
    }
    return { x: rect.x, y: rect.y + depth, width: rect.width, height: rect.height - depth };
  }

  // The row runs top to bottom down the left, and is `depth` wide.
  const depth = total / rect.height;
  let y = rect.y;
  for (const item of row) {
    const height = item.area / depth;
    output.push({ x: rect.x, y, width: depth, height, data: item.data });
    y += height;
  }
  return { x: rect.x + depth, y: rect.y, width: rect.width - depth, height: rect.height };
}

/**
 * Lays weighted items into a rectangle, largest first.
 *
 * Items with no weight are dropped rather than drawn at zero size: a rectangle
 * of no area is not a smaller tile, it is an invisible one, and leaving it in
 * only makes the layout arithmetic divide by nothing.
 */
export function squarify<T>(items: Array<Weighted<T>>, rect: Rect): Array<Placed<T>> {
  const usable = items.filter((item) => Number.isFinite(item.weight) && item.weight > 0)
    .sort((left, right) => right.weight - left.weight);
  if (!usable.length || rect.width <= 0 || rect.height <= 0) return [];

  const total = usable.reduce((sum, item) => sum + item.weight, 0);
  const scale = (rect.width * rect.height) / total;
  const queue = usable.map((item) => ({ ...item, area: item.weight * scale }));

  const output: Array<Placed<T>> = [];
  let remaining = { ...rect };
  let row: typeof queue = [];

  for (const item of queue) {
    const side = Math.min(remaining.width, remaining.height);
    const areas = row.map((entry) => entry.area);
    // An empty row always takes the next item; otherwise it takes it only
    // while the row's worst tile does not get worse for it.
    if (!row.length || worstRatio([...areas, item.area], side) <= worstRatio(areas, side)) {
      row.push(item);
      continue;
    }
    remaining = placeRow(row, remaining, output);
    row = [item];
  }
  if (row.length) placeRow(row, remaining, output);
  return output;
}

/**
 * A treemap of groups, each holding its own treemap.
 *
 * Two levels rather than one, because a flat map of seventy tickers sorted by
 * size says which companies are large and nothing about where the market moved:
 * the reader's question is which *part* of the market is red, and that only
 * shows when the parts are contiguous blocks.
 *
 * Every group is laid out in the same pass as its siblings, so a sector's block
 * is proportional to the sum of its members — the two levels cannot disagree
 * about how big anything is.
 */
export interface Grouped<T> { key: string; items: Array<Weighted<T>> }
export interface PlacedGroup<T> { key: string; rect: Rect; weight: number; items: Array<Placed<T>> }

export function groupedTreemap<T>(groups: Array<Grouped<T>>, rect: Rect): Array<PlacedGroup<T>> {
  const weighed = groups.map((group) => ({
    weight: group.items.reduce((sum, item) => sum + (Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 0), 0),
    data: group,
  }));
  return squarify(weighed, rect).map((placed) => ({
    key: placed.data.key,
    rect: { x: placed.x, y: placed.y, width: placed.width, height: placed.height },
    weight: weighed.find((item) => item.data.key === placed.data.key)?.weight ?? 0,
    items: squarify(placed.data.items, { x: placed.x, y: placed.y, width: placed.width, height: placed.height }),
  }));
}
