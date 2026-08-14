"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { CHART_PALETTE } from "@/lib/charting";
import type { CompanyRankingRow } from "@/lib/company-ranking";

type Point = { ticker: string; quality: number; valuation: number; size: number };
const QUALITY: Array<[keyof CompanyRankingRow, string]> = [
  ["roic", "ROIC"], ["fcfMargin", "FCF margin"], ["roiic5", "Incremental ROIC 5Y"],
  ["fcfConsistency10", "FCF consistency 10Y"], ["ruleOfForty", "Rule of 40"],
];
const VALUATION: Array<[keyof CompanyRankingRow, string]> = [["pfcf", "P / FCF"], ["valuationVsAverage", "Valuation vs 5Y average"]];

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const format = (value: number, key: string) => key === "pfcf" ? `${value.toFixed(1)}×` : key === "fcfConsistency10" ? value.toFixed(2) : `${(value * 100).toFixed(key === "ruleOfForty" ? 0 : 1)}${key === "ruleOfForty" ? "" : "%"}`;

/**
 * The one question a ranked table answers badly: what is both good and cheap.
 *
 * A table sorts on one column at a time, so a reader comparing quality against
 * price has to hold two orderings in their head. Two axes and a median cross
 * put the same companies into four readable quadrants instead.
 */
export function QualityValuationScatter({ rows, onOpen }: { rows: CompanyRankingRow[]; onOpen: (ticker: string) => void }) {
  const [quality, setQuality] = useState<keyof CompanyRankingRow>("roic");
  const [valuation, setValuation] = useState<keyof CompanyRankingRow>("pfcf");

  const points = useMemo<Point[]>(() => rows.flatMap((row) => {
    const q = row[quality]; const v = row[valuation]; const size = row.marketCap;
    return typeof q === "number" && Number.isFinite(q) && typeof v === "number" && Number.isFinite(v)
      ? [{ ticker: row.ticker, quality: q, valuation: v, size: typeof size === "number" ? size : 0 }] : [];
  }), [rows, quality, valuation]);

  const qualityLabel = QUALITY.find(([key]) => key === quality)![1];
  const valuationLabel = VALUATION.find(([key]) => key === valuation)![1];
  if (points.length < 3) return <p className="simple-state">Load at least three companies to compare quality against price.</p>;

  const midQuality = median(points.map((point) => point.quality));
  const midValuation = median(points.map((point) => point.valuation));

  return <div className="scatter-block">
    <div className="scatter-controls">
      <label>Quality<select value={quality} onChange={(event) => setQuality(event.target.value as keyof CompanyRankingRow)}>{QUALITY.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Valuation<select value={valuation} onChange={(event) => setValuation(event.target.value as keyof CompanyRankingRow)}>{VALUATION.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <small>Cheap and good sits {valuation === "pfcf" ? "bottom right" : "bottom right"}; the cross is the median of the {points.length} companies loaded.</small>
    </div>
    <div className="scatter-canvas"><ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 16, right: 24, bottom: 28, left: 8 }}>
        <CartesianGrid stroke="#ececec"/>
        <XAxis type="number" dataKey="quality" name={qualityLabel} tickLine={false} axisLine={false}
          tickFormatter={(value) => format(Number(value), quality as string)}
          label={{ value: qualityLabel, position: "insideBottom", offset: -14, fontSize: 11, fill: "#6a6a6a" }}/>
        <YAxis type="number" dataKey="valuation" name={valuationLabel} width={64} tickLine={false} axisLine={false}
          tickFormatter={(value) => format(Number(value), valuation as string)}
          label={{ value: valuationLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "#6a6a6a" }}/>
        <ZAxis type="number" dataKey="size" range={[60, 320]}/>
        <ReferenceLine x={midQuality} stroke="#b4b4b4" strokeDasharray="4 4"/>
        <ReferenceLine y={midValuation} stroke="#b4b4b4" strokeDasharray="4 4"/>
        <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
          const point = active && payload?.length ? payload[0].payload as Point : null;
          return point ? <div className="chart-tooltip"><b>{point.ticker}</b>
            <span><i style={{ background: CHART_PALETTE[0].value }}/><span>{qualityLabel}</span><strong>{format(point.quality, quality as string)}</strong></span>
            <span><i style={{ background: CHART_PALETTE[1].value }}/><span>{valuationLabel}</span><strong>{format(point.valuation, valuation as string)}</strong></span>
          </div> : null;
        }}/>
        <Scatter data={points} isAnimationActive={false} onClick={(point: unknown) => onOpen((point as Point).ticker)}
          label={{ dataKey: "ticker", position: "top", fontSize: 10, fill: "#333" }}>
          {points.map((point) => <Cell key={point.ticker}
            fill={point.quality >= midQuality && point.valuation <= midValuation ? CHART_PALETTE[2].value : CHART_PALETTE[0].value}
            fillOpacity={.75}/>)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer></div>
  </div>;
}
