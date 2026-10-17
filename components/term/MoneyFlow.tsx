"use client";

import { useEffect, useMemo, useState } from "react";
import { layoutSankey, ribbonPath } from "@/lib/sankey";
import { cashFlowDiagram, incomeStatementDiagram, type StatementDiagram, type StatementReader } from "@/lib/statement-flows";
import { revenueCuts, type RevenueCut } from "@/lib/segments/view";
import type { SegmentData } from "@/lib/segments/build";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import type { MetricKey } from "@/lib/types";
import { useWidth } from "./use-width";

/**
 * FLOW: where the money came from and where it went, in the latest 10-Q and
 * the latest 10-K, drawn as widths (lib/statement-flows.ts). The revenue
 * arrives from its segments, products or regions where the filing's cut adds
 * up to it (lib/segments/view.ts), then splits into its costs and its profit
 * down to net income; operating cash flow into investment, free cash flow and
 * what was returned to shareholders.
 *
 * Every ribbon is a filed figure or a subtraction from one. Where the filing
 * does not let the diagram close, it says so under it. Drawn at the panel's
 * real width, so its text is the size of the rest of the page.
 */

const TONE: Record<string, string> = {
  revenue: "var(--c1)", profit: "var(--gain)", cost: "var(--loss)",
  asset: "var(--c1)", liability: "var(--loss)", equity: "var(--gain)", neutral: "var(--ink-3)",
};
/** Money coming in above money going out, in every column. */
const RANK: Record<string, number> = { revenue: 0, profit: 0, equity: 1, asset: 2, neutral: 3, cost: 4, liability: 5 };
/** One hue a line of revenue, as the segment charts give them. */
const SOURCE_COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c6)", "var(--c7)", "var(--c8)", "var(--c5)"];
/** The lines a cut shows before the rest are summed: a regional cut of twenty countries would be a comb. */
const MAX_SOURCES = 7;
const SOURCE = "source:";
const LABEL_ROOM = 150;
const SOURCE_ROOM = 170;

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

/**
 * The revenue's lines flowing into it, largest first, the smallest summed as "Other". Only where the cut adds up to
 * the revenue the statement reports (within a percent): two figures that disagree would draw a revenue box wider
 * than what leaves it.
 */
export function withSources(diagram: StatementDiagram, cut: RevenueCut | null): StatementDiagram {
  const revenue = diagram.values.revenue;
  if (!cut || !revenue || Math.abs(cut.total - revenue) > revenue * 0.01) return diagram;
  const kept = cut.lines.slice(0, cut.lines.length > MAX_SOURCES ? MAX_SOURCES - 1 : MAX_SOURCES);
  const rest = cut.lines.slice(kept.length).reduce((sum, line) => sum + line.value, 0);
  const lines = rest > 0 ? [...kept, { id: "other", label: "Other", value: rest }] : kept;
  const scale = revenue / cut.total;
  return {
    ...diagram,
    nodes: [...lines.map((line) => ({ id: `${SOURCE}${line.id}`, label: line.label, tone: "revenue" as const })), ...diagram.nodes],
    flows: [...lines.map((line) => ({ source: `${SOURCE}${line.id}`, target: "revenue", value: line.value * scale })), ...diagram.flows],
    values: { ...diagram.values, ...Object.fromEntries(lines.map((line) => [`${SOURCE}${line.id}`, line.value])) },
  };
}

function Diagram({ diagram, base, width }: { diagram: StatementDiagram; base: string; width: number }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const tone = useMemo(() => Object.fromEntries(diagram.nodes.map((node) => [node.id, node.tone])), [diagram]);
  const label = useMemo(() => Object.fromEntries(diagram.nodes.map((node) => [node.id, node.label])), [diagram]);
  const sources = useMemo(() => diagram.nodes.filter((node) => node.id.startsWith(SOURCE)).map((node) => node.id), [diagram]);
  const color = (id: string) => (sources.includes(id) ? SOURCE_COLORS[sources.indexOf(id) % SOURCE_COLORS.length] : TONE[tone[id] ?? "neutral"]);
  const height = Math.round(Math.min(520, Math.max(300, width * 0.42, sources.length * 46)));
  const layout = useMemo(() => layoutSankey(diagram.flows, {
    width, height, nodeWidth: 8, nodePadding: 18, margin: 12, labelRoom: LABEL_ROOM, leftRoom: sources.length ? SOURCE_ROOM : 0,
    // A revenue's lines in the order of their size; the statement's own nodes by what they are.
    rank: (id) => (sources.includes(id) ? sources.indexOf(id) : RANK[tone[id] ?? "neutral"] ?? 3),
  }), [diagram, tone, sources, width, height]);
  const total = diagram.values[base] ?? 0;
  if (!layout.nodes.length) return <p className="t-empty">This filing does not carry enough lines to draw the flow.</p>;
  return (
    <svg className="t-flow-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${diagram.periodLabel}: where the money came from and went`}>
      <g>
        {layout.links.map((link) => {
          const active = hovered === link.source || hovered === link.target;
          // A line of revenue keeps its own colour into the revenue; every other ribbon takes its destination's.
          return (
            <path key={`${link.source}->${link.target}`} d={ribbonPath(link)} fill={color(sources.includes(link.source) ? link.source : link.target)}
              opacity={hovered && !active ? 0.08 : 0.3} onMouseEnter={() => setHovered(link.target)} onMouseLeave={() => setHovered(null)}>
              <title>{`${label[link.source]} → ${label[link.target]}: ${compact(link.value, diagram.currency)}`}</title>
            </path>
          );
        })}
      </g>
      <g>
        {layout.nodes.map((node) => {
          const value = diagram.values[node.id] ?? node.value;
          const share = total > 0 && node.id !== base ? ` · ${((value / total) * 100).toFixed(value / total < 0.1 ? 1 : 0)}%` : "";
          // A revenue's lines are named on their left, every other node on its right.
          const left = sources.includes(node.id);
          const x = left ? node.x - 6 : node.x + node.width + 6;
          const middle = node.y + node.height / 2;
          return (
            <g key={node.id} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)}>
              <rect x={node.x} y={node.y} width={node.width} height={Math.max(1, node.height)} fill={color(node.id)} opacity={hovered && hovered !== node.id ? 0.4 : 1} />
              <text x={x} y={middle - 6} textAnchor={left ? "end" : "start"} className="t-flow-label">
                <tspan className="t-flow-name">{label[node.id]}</tspan>
                <tspan className="t-flow-value" x={x} dy="13">{compact(value, diagram.currency)}{share}</tspan>
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export function MoneyFlow({ view }: { view: IoCompanyView }) {
  const { quarter, year } = useMemo(() => flowPeriods(view), [view]);
  const [filing, setFiling] = useState<Filing>("quarter");
  const [statement, setStatement] = useState<Statement>("income");
  const [cutId, setCutId] = useState<string | null>(null);
  const [segments, setSegments] = useState<SegmentData | null>(null);
  const { ref, width } = useWidth();
  const ticker = view.company.ticker;
  useEffect(() => {
    const controller = new AbortController();
    // The SEG panel's reading of the same filings; without it the flow starts at the revenue.
    fetch(`/api/segments/${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then(async (response) => (response.ok ? await response.json() as SegmentData : null))
      .then((data) => { if (!controller.signal.aborted) setSegments(data?.stacks ? data : null); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [ticker]);

  const period = (filing === "quarter" ? quarter : year) ?? quarter ?? year;
  const shown = period === quarter ? "quarter" : "year";
  const cuts = useMemo(() => (segments && period ? revenueCuts(segments, period.end, shown === "quarter" ? "quarterly" : "annual") : []), [segments, period, shown]);
  const cut = statement === "income" ? cuts.find((candidate) => candidate.id === cutId) ?? cuts[0] ?? null : null;
  const diagram = useMemo(() => {
    if (!period) return null;
    const drawn = statement === "income" ? incomeStatementDiagram(reader(period)) : cashFlowDiagram(reader(period));
    return drawn ? withSources(withoutPassThrough(drawn), cut) : null;
  }, [period, statement, cut]);
  if (!quarter && !year) return <p className="t-empty">No revenue is filed for this company, so there is no flow to draw.</p>;
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
        {statement === "income" && cuts.length > 1 ? (
          <div className="seg" role="group" aria-label="Revenue by">
            {cuts.map((candidate) => <button key={candidate.id} type="button" aria-pressed={candidate === cut} onClick={() => setCutId(candidate.id)}>{candidate.title}</button>)}
          </div>
        ) : null}
        {period ? <span className="t-dim">{statement === "income" ? "Share of revenue" : "Share of operating cash flow"} · period to {period.end}</span> : null}
      </div>
      <div className="t-flow-scroll" ref={ref}>
        {diagram && width > 0 ? <Diagram diagram={diagram} base={statement === "income" ? "revenue" : "operatingCashFlow"} width={Math.max(width, 720)} /> : null}
        {!diagram ? <p className="t-empty">{statement === "income" ? "This filing reports no positive revenue to draw from." : "This filing reports no positive operating cash flow to draw from."}</p> : null}
      </div>
      {diagram?.notes.length ? <ul className="t-flow-notes t-dim">{diagram.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
    </div>
  );
}
