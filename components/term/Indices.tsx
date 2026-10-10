"use client";

import { useEffect, useState } from "react";
import { delta, price } from "@/components/io/format";

/**
 * The averages, today: last, move, and the session as a line.
 *
 * /api/indices answers all three at once, in five-minute bars, cached thirty
 * seconds at the edge; this asks once a minute.
 */

interface Index {
  id: string;
  name: string;
  last?: number | null;
  change?: number | null;
  changePercent?: number | null;
  baseline?: number | null;
  points?: Array<{ close: number }>;
  error?: string;
}

function Spark({ points, baseline, up }: { points: Array<{ close: number }>; baseline: number | null; up: boolean }) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.close);
  const low = Math.min(...values, baseline ?? Infinity);
  const high = Math.max(...values, baseline ?? -Infinity);
  const y = (value: number) => 28 - ((value - low) / (high - low || 1)) * 26;
  const x = (index: number) => (index / (values.length - 1)) * 120;
  const path = values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join("");
  return (
    <svg className="t-spark" viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true">
      {baseline != null ? <line x1={0} x2={120} y1={y(baseline)} y2={y(baseline)} className="t-spark-base" vectorEffect="non-scaling-stroke" /> : null}
      <path d={path} className={up ? "t-spark-up" : "t-spark-down"} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Indices() {
  const [indices, setIndices] = useState<Index[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const read = () => fetch("/api/indices", { signal: controller.signal })
      .then((response) => response.json() as Promise<{ indices?: Index[] }>)
      .then((body) => setIndices(body.indices ?? []))
      .catch(() => { if (!controller.signal.aborted) setIndices([]); });
    read();
    const timer = setInterval(read, 60_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  if (!indices) return <p className="t-empty">Loading…</p>;
  return (
    <div className="t-indices">
      {indices.map((index) => {
        const up = (index.changePercent ?? 0) >= 0;
        return (
          <a key={index.id} className="t-index" href="/market">
            <span className="t-index-name">{index.name}</span>
            <span className="t-index-last">{index.last == null ? "—" : price(index.last, null)}</span>
            <span className={index.changePercent == null ? "t-dim" : up ? "t-up" : "t-down"}>{delta(index.changePercent ?? null)}</span>
            {index.points ? <Spark points={index.points} baseline={index.baseline ?? null} up={up} /> : null}
          </a>
        );
      })}
    </div>
  );
}
