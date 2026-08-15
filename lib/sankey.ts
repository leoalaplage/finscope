export interface SankeyFlow { source: string; target: string; value: number }

export interface SankeyNodeLayout {
  id: string;
  depth: number;
  value: number;
  x: number; y: number; width: number; height: number;
}

export interface SankeyLinkLayout {
  source: string; target: string; value: number;
  /** Vertical band at each end, already stacked against its neighbours. */
  sourceY: number; targetY: number; thickness: number;
  sourceX: number; targetX: number;
}

export interface SankeyLayout {
  nodes: SankeyNodeLayout[];
  links: SankeyLinkLayout[];
  width: number; height: number;
}

export interface SankeyOptions {
  width: number; height: number;
  /** Column width of a node rectangle. */
  nodeWidth?: number;
  /** Minimum vertical gap between two nodes in the same column. */
  nodePadding?: number;
  /** Room reserved at top and bottom. */
  margin?: number;
  /**
   * Horizontal room kept clear to the right of the last column for its labels.
   *
   * Every label is drawn to the right of its own node, so the only one that can
   * run out of the drawing is the last column's. Reserving the space here means
   * a label never has to be flipped to the other side, where it would collide
   * with the labels of the column before it.
   */
  labelRoom?: number;
}

/**
 * Lays out a directed acyclic flow diagram.
 *
 * Written rather than imported: the two statements drawn here are three or four
 * columns wide and the whole algorithm is a hundred lines, which is a smaller
 * commitment than a dependency and keeps the geometry inspectable when a filing
 * turns out not to balance.
 *
 * A node's value is the larger of what flows in and what flows out. They differ
 * only when a statement does not reconcile, and taking the larger keeps the
 * ribbons inside the box that anchors them rather than spilling past it.
 */
export function layoutSankey(flows: SankeyFlow[], options: SankeyOptions): SankeyLayout {
  const { width, height, nodeWidth = 14, nodePadding = 10, margin = 4, labelRoom = 0 } = options;
  const usable = flows.filter((flow) => Number.isFinite(flow.value) && flow.value > 0);
  if (!usable.length) return { nodes: [], links: [], width, height };

  const ids = [...new Set(usable.flatMap((flow) => [flow.source, flow.target]))];
  const outgoing = new Map<string, SankeyFlow[]>();
  const incoming = new Map<string, SankeyFlow[]>();
  for (const flow of usable) {
    outgoing.set(flow.source, [...(outgoing.get(flow.source) ?? []), flow]);
    incoming.set(flow.target, [...(incoming.get(flow.target) ?? []), flow]);
  }

  // Depth is the longest path from any source, so a node always sits to the
  // right of everything feeding it. The graph is acyclic by construction; the
  // visit cap is a guard against a malformed one rather than an expectation.
  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const flow of usable) {
      const next = depth.get(flow.source)! + 1;
      if (next > depth.get(flow.target)!) { depth.set(flow.target, next); moved = true; }
    }
    if (!moved) break;
  }

  const value = new Map<string, number>(ids.map((id) => {
    const into = (incoming.get(id) ?? []).reduce((sum, flow) => sum + flow.value, 0);
    const outOf = (outgoing.get(id) ?? []).reduce((sum, flow) => sum + flow.value, 0);
    return [id, Math.max(into, outOf)];
  }));

  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const level = depth.get(id)!;
    columns.set(level, [...(columns.get(level) ?? []), id]);
  }
  const maxDepth = Math.max(...depth.values());

  // One vertical scale for the whole diagram, set by the busiest column, so a
  // ribbon of the same width means the same money wherever it appears.
  let scale = Infinity;
  for (const [, members] of columns) {
    const total = members.reduce((sum, id) => sum + value.get(id)!, 0);
    const available = height - 2 * margin - nodePadding * Math.max(0, members.length - 1);
    if (total > 0 && available > 0) scale = Math.min(scale, available / total);
  }
  if (!Number.isFinite(scale) || scale <= 0) return { nodes: [], links: [], width, height };

  const span = Math.max(0, width - 2 * margin - nodeWidth - labelRoom);
  const columnX = (level: number) => maxDepth === 0 ? margin : margin + (level / maxDepth) * span;

  const nodes: SankeyNodeLayout[] = [];
  for (const [level, members] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    const heights = members.map((id) => Math.max(1, value.get(id)! * scale));
    const used = heights.reduce((sum, item) => sum + item, 0) + nodePadding * (members.length - 1);
    let y = margin + (height - 2 * margin - used) / 2;
    members.forEach((id, index) => {
      nodes.push({ id, depth: level, value: value.get(id)!, x: columnX(level), y, width: nodeWidth, height: heights[index] });
      y += heights[index] + nodePadding;
    });
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Stack each node's links in the order they were declared, so the caller
  // controls the reading order and the ribbons never cross inside a node.
  const sourceCursor = new Map<string, number>();
  const targetCursor = new Map<string, number>();
  const links: SankeyLinkLayout[] = usable.map((flow) => {
    const source = byId.get(flow.source)!; const target = byId.get(flow.target)!;
    const thickness = Math.max(1, flow.value * scale);
    const sourceY = source.y + (sourceCursor.get(flow.source) ?? 0);
    const targetY = target.y + (targetCursor.get(flow.target) ?? 0);
    sourceCursor.set(flow.source, (sourceCursor.get(flow.source) ?? 0) + thickness);
    targetCursor.set(flow.target, (targetCursor.get(flow.target) ?? 0) + thickness);
    return {
      source: flow.source, target: flow.target, value: flow.value, thickness,
      sourceY, targetY, sourceX: source.x + source.width, targetX: target.x,
    };
  });

  return { nodes, links, width, height };
}

/** A filled ribbon between two stacked bands, as an SVG path. */
export function ribbonPath(link: SankeyLinkLayout): string {
  const { sourceX, targetX, sourceY, targetY, thickness } = link;
  const curve = sourceX + (targetX - sourceX) / 2;
  const topStart = sourceY; const topEnd = targetY;
  const bottomStart = sourceY + thickness; const bottomEnd = targetY + thickness;
  return [
    `M${sourceX},${topStart}`,
    `C${curve},${topStart} ${curve},${topEnd} ${targetX},${topEnd}`,
    `L${targetX},${bottomEnd}`,
    `C${curve},${bottomEnd} ${curve},${bottomStart} ${sourceX},${bottomStart}`,
    "Z",
  ].join(" ");
}
