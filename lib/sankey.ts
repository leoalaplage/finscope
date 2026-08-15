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
  /**
   * Vertical ordering inside a column, drawn top to bottom by ascending rank.
   * Equal ranks keep the order the caller declared them in.
   *
   * A statement has a natural reading order that flow order alone does not
   * produce: what the company earned belongs above what it spent, in every
   * column, so the profit line runs across the top of the diagram and the costs
   * peel off underneath it.
   */
  rank?: (id: string) => number;
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
  const { width, height, nodeWidth = 14, nodePadding = 10, margin = 4, labelRoom = 0, rank } = options;
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

  // A node nothing flows into is drawn immediately before whatever it feeds,
  // not in the first column. Longest-path depth alone puts every such node at
  // zero, which stranded "Other income" beside Revenue with a ribbon sweeping
  // four columns to reach pre-tax income, and would have put the non-cash
  // add-backs in the same column as the profit they are added to.
  //
  // Reading the original depths while writing the new ones is safe: only nodes
  // with no incoming flow move, and nothing reads their old position.
  for (const id of ids) {
    if ((incoming.get(id) ?? []).length) continue;
    const targets = outgoing.get(id) ?? [];
    if (!targets.length) continue;
    depth.set(id, Math.max(0, Math.min(...targets.map((flow) => depth.get(flow.target)!)) - 1));
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
  for (const [level, declared] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    const members = rank
      ? declared.map((id, index) => ({ id, index })).sort((a, b) => (rank(a.id) - rank(b.id)) || (a.index - b.index)).map((item) => item.id)
      : declared;
    const heights = members.map((id) => Math.max(1, value.get(id)! * scale));
    const used = heights.reduce((sum, item) => sum + item, 0) + nodePadding * (members.length - 1);
    let y = margin + (height - 2 * margin - used) / 2;
    members.forEach((id, index) => {
      nodes.push({ id, depth: level, value: value.get(id)!, x: columnX(level), y, width: nodeWidth, height: heights[index] });
      y += heights[index] + nodePadding;
    });
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const thickness = usable.map((flow) => Math.max(1, flow.value * scale));

  // Ribbons leave a node in the order their destinations are stacked, and
  // arrive in the order their origins are stacked. Stacking them in declaration
  // order instead made them cross whenever a column was reordered, which turns
  // a diagram meant to be read at a glance into a knot.
  const bySource = new Map<string, number[]>();
  const byTarget = new Map<string, number[]>();
  usable.forEach((flow, index) => {
    bySource.set(flow.source, [...(bySource.get(flow.source) ?? []), index]);
    byTarget.set(flow.target, [...(byTarget.get(flow.target) ?? []), index]);
  });

  const sourceY = new Array<number>(usable.length);
  const targetY = new Array<number>(usable.length);
  const stack = (groups: Map<string, number[]>, counterpart: (index: number) => string, out: number[]) => {
    for (const [id, indices] of groups) {
      let offset = byId.get(id)!.y;
      const ordered = [...indices].sort((a, b) => (byId.get(counterpart(a))!.y - byId.get(counterpart(b))!.y) || (a - b));
      for (const index of ordered) { out[index] = offset; offset += thickness[index]; }
    }
  };
  stack(bySource, (index) => usable[index].target, sourceY);
  stack(byTarget, (index) => usable[index].source, targetY);

  const links: SankeyLinkLayout[] = usable.map((flow, index) => {
    const source = byId.get(flow.source)!; const target = byId.get(flow.target)!;
    return {
      source: flow.source, target: flow.target, value: flow.value, thickness: thickness[index],
      sourceY: sourceY[index], targetY: targetY[index], sourceX: source.x + source.width, targetX: target.x,
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
