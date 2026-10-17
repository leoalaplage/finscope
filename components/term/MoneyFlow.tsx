"use client";

import { useMemo, useState } from "react";
import { layoutSankey, ribbonPath } from "@/lib/sankey";
import { cashFlowDiagram, incomeStatementDiagram, type StatementDiagram, type StatementReader } from "@/lib/statement-flows";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import type { MetricKey } from "@/lib/types";

/**
 * FLOW: where the money came from and where it went, in the latest 10-Q and
 * the latest 10-K, drawn as widths (lib/statement-flows.ts). Revenue splits
 * into its costs and its profit down to net income; operating cash flow into
 * investment, free cash flow and what was returned to shareholders.
 *
 * Every ribbon is a filed figure or a subtraction from one. Where the filing
 * does not let the diagram close, it says so under it.
 */

const TONE: Record<string, string> = {
  revenue: "var(--c1)", profit: "var(--gain)", cost: "var(--loss)",
  asset: "var(--c1)", liability: "var(--loss)", equity: "var(--gain)", neutral: "var(--ink-3)",
};
/** Money coming in above money going out, in every column. */
const RANK: Record<string, number> = { revenue: 0, profit: 0, equity: 1, asset: 2, neutral: 3, cost: 4, liability: 5 };
const WIDTH = 960;
const HEIGHT = 360;
const LABEL_ROOM = 190;

type Statement = "income" | "cash";
type Filing = "quarter" | "year";

function reader(period: IoPeriod): StatementReader {
  return {
    value: (metric: MetricKey) => period.values[metric] ?? null,
    freeCashFlow: () => period.values.freeCashFlow ?? null,
    currency: period.currency, periodLabel: period.label, periodEnd: period.end,
  };
}

const compact = (value: number, currency: string) => {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${value < 0 ? "−" : ""}${symbol}${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Math.abs(value))}`;
};

/** The latest quarter filed in a 10-Q (a fourth quarter is the 10-K's year less nine months), and the latest year. */
export function flowPeriods(view: Pick<IoCompanyView, "quarterly" | "annual">): { quarter: IoPeriod | null; year: IoPeriod | null } {
  const byEnd = (periods: IoPeriod[]) => [...periods].sort((left, right) => right.end.localeCompare(left.end));
  return {
    quarter: byEnd(view.quarterly).find((period) => period.fiscalQuarter !== "Q4" && (period.values.revenue ?? 0) > 0) ?? null,
    year: byEnd(view.annual).find((period) => (period.values.revenue ?? 0) > 0) ?? null,
  };
}

/**
 * A node that only passes its one source's whole flow on (Uber's "Revenue less cost", where no cost of revenue is
 * filed) is the source itself: its outflows leave from the source.
 */
export function withoutPassThrough(diagram: StatementDiagram): StatementDiagram {
  let flows = diagram.flows;
  for (;;) {
    const through = diagram.nodes.find((node) => {
      const inflows = flows.filter((flow) => flow.target === node.id);
      if (inflows.length !== 1) return false;
      const outflows = flows.filter((flow) => flow.source === inflows[0].source);
      return outflows.length === 1 && flows.some((flow) => flow.source === node.id);
    });
    if (!through) break;
    const source = flows.find((flow) => flow.target === through.id)!.source;
    flows = flows.filter((flow) => flow.target !== through.id).map((flow) => (flow.source === through.id ? { ...flow, source } : flow));
  }
  const used = new Set(flows.flatMap((flow) => [flow.source, flow.target]));
  return flows === diagram.flows ? diagram : { ...diagram, flows, nodes: diagram.nodes.filter((node) => used.has(node.id)) };
}

function Diagram({ diagram, base }: { diagram: StatementDiagram; base: string }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const tone = useMemo(() => Object.fromEntries(diagram.nodes.map((node) => [node.id, node.tone])), [diagram]);
  const label = useMemo(() => Object.fromEntries(diagram.nodes.map((node) => [node.id, node.label])), [diagram]);
  const layout = useMemo(() => layoutSankey(diagram.flows, {
    width: WIDTH, height: HEIGHT, nodeWidth: 10, nodePadding: 16, margin: 8, labelRoom: LABEL_ROOM,
    rank: (id) => RANK[tone[id] ?? "neutral"] ?? 3,
  }), [diagram, tone]);
  const total = diagram.values[base] ?? 0;
  if (!layout.nodes.length) return <p className="t-empty">This filing does not carry enough lines to draw the flow.</p>;
  return (
    <div className="t-flow-scroll">
      <svg className="t-flow-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${diagram.periodLabel}: where the money went`}>
        <g>
          {layout.links.map((link) => {
            const active = hovered === link.source || hovered === link.target;
            return (
              <path key={`${link.source}->${link.target}`} d={ribbonPath(link)} fill={TONE[tone[link.target] ?? "neutral"]}
                opacity={hovered && !active ? 0.08 : 0.32} onMouseEnter={() => setHovered(link.target)} onMouseLeave={() => setHovered(null)}>
                <title>{`${label[link.source]} → ${label[link.target]}: ${compact(link.value, diagram.currency)}`}</title>
              </path>
            );
          })}
        </g>
        <g>
          {layout.nodes.map((node) => {
            const value = diagram.values[node.id] ?? node.value;
            const share = total > 0 && node.id !== base ? ` · ${((value / total) * 100).toFixed(value / total < 0.1 ? 1 : 0)}%` : "";
            return (
              <g key={node.id} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)}>
                <rect x={node.x} y={node.y} width={node.width} height={Math.max(1, node.height)} fill={TONE[tone[node.id] ?? "neutral"]} opacity={hovered && hovered !== node.id ? 0.4 : 1} />
                <text x={node.x + node.width + 6} y={node.y + node.height / 2} dominantBaseline="middle" className="t-flow-label">
                  <tspan className="t-flow-name">{label[node.id]}</tspan>
                  <tspan className="t-flow-value" dx="6">{compact(value, diagram.currency)}{share}</tspan>
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export function MoneyFlow({ view }: { view: IoCompanyView }) {
  const { quarter, year } = useMemo(() => flowPeriods(view), [view]);
  const [filing, setFiling] = useState<Filing>("quarter");
  const [statement, setStatement] = useState<Statement>("income");
  const period = (filing === "quarter" ? quarter : year) ?? quarter ?? year;
  const diagram = useMemo(() => {
    if (!period) return null;
    const drawn = statement === "income" ? incomeStatementDiagram(reader(period)) : cashFlowDiagram(reader(period));
    return drawn ? withoutPassThrough(drawn) : null;
  }, [period, statement]);
  if (!quarter && !year) return <p className="t-empty">No revenue is filed for this company, so there is no flow to draw.</p>;
  const shown = period === quarter ? "quarter" : "year";
  return (
    <div className="t-flow">
      <div className="t-flow-bar">
        <div className="seg" role="group" aria-label="Filing">
          {quarter ? <button type="button" aria-pressed={shown === "quarter"} onClick={() => setFiling("quarter")}>10-Q · {quarter.label}</button> : null}
          {year ? <button type="button" aria-pressed={shown === "year"} onClick={() => setFiling("year")}>10-K · {year.label}</button> : null}
        </div>
        <div className="seg" role="group" aria-label="Statement">
          <button type="button" aria-pressed={statement === "income"} onClick={() => setStatement("income")}>Income statement</button>
          <button type="button" aria-pressed={statement === "cash"} onClick={() => setStatement("cash")}>Cash flow</button>
        </div>
        {period ? <span className="t-dim">{statement === "income" ? "Share of revenue" : "Share of operating cash flow"} · period to {period.end}</span> : null}
      </div>
      {diagram ? <Diagram diagram={diagram} base={statement === "income" ? "revenue" : "operatingCashFlow"} /> : (
        <p className="t-empty">{statement === "income" ? "This filing reports no positive revenue to draw from." : "This filing reports no positive operating cash flow to draw from."}</p>
      )}
      {diagram?.notes.length ? <ul className="t-flow-notes t-dim">{diagram.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
    </div>
  );
}
