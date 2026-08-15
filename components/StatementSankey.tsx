"use client";

import { useMemo, useState } from "react";
import { layoutSankey, ribbonPath } from "@/lib/sankey";
import type { StatementDiagram } from "@/lib/statement-flows";

const TONE: Record<string, string> = {
  revenue: "var(--sankey-revenue)",
  profit: "var(--sankey-profit)",
  cost: "var(--sankey-cost)",
  asset: "var(--sankey-asset)",
  liability: "var(--sankey-liability)",
  equity: "var(--sankey-equity)",
  neutral: "var(--sankey-neutral)",
};

/**
 * Vertical order inside a column, top first.
 *
 * Money coming in sits above money going out, everywhere: the profit line runs
 * across the top of the diagram and each cost peels off underneath it, so the
 * shape of the year is legible before a single label is read. On the balance
 * sheet the same rule reads as what the owners keep above what is owed.
 */
const RANK: Record<string, number> = { revenue: 0, profit: 0, equity: 1, asset: 2, neutral: 3, cost: 4, liability: 5 };

const compact = (value: number, currency: string) => {
  const sign = value < 0 ? "-" : "";
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${sign}${symbol}${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(Math.abs(value))}`;
};

const WIDTH = 980;
const HEIGHT = 420;
/** Enough for the longest label the statements produce. */
const LABEL_ROOM = 170;

/**
 * A statement drawn as the flow it describes.
 *
 * A table of line items makes the reader do the arithmetic that turns revenue
 * into profit, or assets into claims. Drawn as widths, the same numbers answer
 * "where does it go" at a glance — which is the question a statement is for.
 *
 * Every ribbon is a reported figure or a subtraction from one. Nothing is
 * modelled, and where a filing does not reconcile the diagram says so under it
 * rather than quietly closing the gap.
 */
export function StatementSankey({ diagram, title }: { diagram: StatementDiagram; title: string }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const tone = useMemo(() => Object.fromEntries(diagram.nodes.map((node) => [node.id, node.tone])), [diagram]);
  const layout = useMemo(() => layoutSankey(diagram.flows, {
    width: WIDTH, height: HEIGHT, nodeWidth: 13, nodePadding: 14, margin: 10, labelRoom: LABEL_ROOM,
    rank: (id) => RANK[tone[id] ?? "neutral"] ?? 3,
  }), [diagram, tone]);
  const label = useMemo(() => Object.fromEntries(diagram.nodes.map((node) => [node.id, node.label])), [diagram]);

  if (!layout.nodes.length) return <p className="simple-state">This period does not carry enough reported lines to draw {title.toLowerCase()}.</p>;

  return <figure className="sankey">
    <figcaption>
      <h3>{title}</h3>
      <span>{diagram.periodLabel} · {diagram.periodEnd} · {diagram.currency}</span>
    </figcaption>
    <div className="sankey-scroll">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title} for ${diagram.periodLabel}`} preserveAspectRatio="xMidYMid meet">
        <g>
          {layout.links.map((link) => {
            const active = hovered === link.source || hovered === link.target;
            return <path key={`${link.source}->${link.target}`} d={ribbonPath(link)}
              fill={TONE[tone[link.target] ?? "neutral"]}
              opacity={hovered && !active ? .12 : .38}
              onMouseEnter={() => setHovered(link.target)} onMouseLeave={() => setHovered(null)}>
              <title>{`${label[link.source]} → ${label[link.target]}: ${compact(link.value, diagram.currency)}`}</title>
            </path>;
          })}
        </g>
        <g>
          {layout.nodes.map((node) => {
            // Every label sits to the right of its own node. Flipping the last
            // column to the left instead would put its labels in the same strip
            // as the labels of the column before it, which collide as soon as
            // two of them land at a similar height.
            const textX = node.x + node.width + 6;
            const reported = diagram.values[node.id];
            return <g key={node.id} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)}>
              <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={2}
                fill={TONE[tone[node.id] ?? "neutral"]} opacity={hovered && hovered !== node.id ? .45 : 1}>
                <title>{`${label[node.id]}: ${compact(reported ?? node.value, diagram.currency)}`}</title>
              </rect>
              <text x={textX} y={node.y + node.height / 2} textAnchor="start" dominantBaseline="middle" className="sankey-label">
                <tspan className="sankey-name">{label[node.id]}</tspan>
                <tspan className="sankey-value" dx="6">{compact(reported ?? node.value, diagram.currency)}</tspan>
              </text>
            </g>;
          })}
        </g>
      </svg>
    </div>
    {diagram.notes.length > 0 && <ul className="sankey-notes">{diagram.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
  </figure>;
}
