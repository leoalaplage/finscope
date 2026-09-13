"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketGroup, MarketRow, MarketsAnswer } from "@/app/api/markets/route";
import { QuoteCharts, toggleOpen } from "./QuoteCharts";
import { ABSENT, delta, price as writePrice } from "./format";

/**
 * Every market this page watches, as one table.
 *
 * It was four grids of six cells, one under another, identical in typography
 * and shape — twenty-four boxes with nothing to say which mattered, and the
 * oil price six hundred pixels from the dollar it is quoted in. Every terminal
 * converged on the same answer instead, and it is not the card: one dense
 * table, a row an instrument, columns aligned so the eye reads down a single
 * kind of number, and colour in the change column alone.
 *
 * Grouped by header rows inside the one table rather than by four sections,
 * which is the whole point: a reader compares Brent with the dollar by moving
 * their eye, not by scrolling.
 *
 * The line at the end of each row is a month of closes. It carries the shape
 * that four panels of charts used to, at the cost of a hundred pixels and no
 * extra request — the batch reader takes twenty symbols at a time.
 *
 * Clicking a row still opens the full panel, three at a time, as the cells did.
 */

const GROUPS: Array<{ id: MarketGroup; label: string }> = [
  { id: "world", label: "World indices" },
  { id: "commodities", label: "Commodities" },
  { id: "rates", label: "Government bonds" },
  { id: "currencies", label: "Currencies" },
];

type State = { kind: "loading" } | { kind: "absent" } | { kind: "ready"; answer: MarketsAnswer };

/** The level, priced or not: an index is not money, a barrel of oil is. */
function figure(row: MarketRow): string {
  if (row.last == null) return ABSENT;
  if (row.measure === "yield") return `${row.last.toFixed(row.places)}%`;
  if (row.measure === "price") return writePrice(row.last, row.currency, row.places);
  return row.last.toLocaleString("en-US", { minimumFractionDigits: row.places, maximumFractionDigits: row.places });
}

/** The day: per cent for anything priced, basis points for a yield. */
function move(row: MarketRow): { text: string; direction: string | undefined } {
  const value = row.measure === "yield" ? row.changeBasisPoints : row.changePercent;
  const direction = value == null ? undefined : value > 0 ? "up" : value < 0 ? "down" : "flat";
  if (value == null) return { text: ABSENT, direction };
  return {
    text: row.measure === "yield" ? `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(1)} bp` : delta(value / 100, 1),
    direction,
  };
}

/**
 * A month, as a line and nothing else.
 *
 * No axis, no baseline, no label: at this size every one of them is a smudge,
 * and the numbers to its left are the reading. It is here to say whether the
 * figure arrived in a straight line or a round trip.
 */
function Spark({ points, rising }: { points: number[]; rising: boolean }) {
  const path = useMemo(() => {
    if (points.length < 2) return "";
    const low = Math.min(...points), high = Math.max(...points);
    const span = high - low || 1;
    const step = 78 / (points.length - 1);
    return points.map((point, index) => `${(index * step).toFixed(1)},${(18 - ((point - low) / span) * 16).toFixed(1)}`).join("L");
  }, [points]);
  if (!path) return <span className="market-spark"/>;
  return (
    <svg className={rising ? "market-spark up" : "market-spark down"} width="78" height="16" viewBox="0 0 78 20" preserveAspectRatio="none" role="img" aria-hidden="true">
      <path d={`M${path}`}/>
    </svg>
  );
}

export function Markets() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/markets", { signal: controller.signal });
        if (!response.ok) { setState({ kind: "absent" }); return; }
        const answer = await response.json() as MarketsAnswer;
        if (!controller.signal.aborted) setState(answer.rows?.length ? { kind: "ready", answer } : { kind: "absent" });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "absent" });
      }
    })();
    return () => controller.abort();
  }, []);

  if (state.kind === "absent") return null;

  return (
    <section className="section markets" aria-labelledby="markets-title">
      <div className="section-head">
        <h2 className="label" id="markets-title">Markets</h2>
        <span className="label">Last · day · month</span>
      </div>

      {state.kind === "loading" ? (
        <div className="sheet"><div className="skeleton" style={{ height: 620 }}/></div>
      ) : (
        <div className="sheet markets-sheet">
          <table>
            <thead>
              <tr>
                <th className="key" scope="col">Market</th>
                <th scope="col">Last</th>
                <th scope="col">Day</th>
                <th scope="col">Month</th>
                <th scope="col">&nbsp;</th>
              </tr>
            </thead>
            {GROUPS.map((group) => {
              const rows = state.answer.rows.filter((row) => row.group === group.id && row.last != null);
              if (!rows.length) return null;
              return (
                <tbody key={group.id}>
                  {/* The group is a row of the same table, not a section of
                      its own: that is what lets the eye compare across them. */}
                  <tr className="markets-group">
                    <th className="key" scope="rowgroup" colSpan={5}>{group.label}</th>
                  </tr>
                  {rows.map((row) => <Row key={row.id} row={row} open={open.includes(row.id)} onOpen={() => setOpen((current) => toggleOpen(current, row.id))}/>)}
                </tbody>
              );
            })}
          </table>
        </div>
      )}

      <QuoteCharts open={open} label="market"/>
    </section>
  );
}

function Row({ row, open, onOpen }: { row: MarketRow; open: boolean; onOpen: () => void }) {
  const day = move(row);
  const first = row.spark[0], last = row.spark.at(-1);
  return (
    <tr data-selected={open}>
      <th className="key" scope="row">
        <button type="button" className="key-open" aria-pressed={open} onClick={onOpen}>{row.label}</button>
      </th>
      <td>{figure(row)}</td>
      <td><span className="day-mark" data-dir={day.direction}>{day.text}</span></td>
      <td className="markets-spark-cell">
        <Spark points={row.spark} rising={first != null && last != null ? last >= first : true}/>
      </td>
      {/* Said once, in the quietest ink: what the figure is of. */}
      <td className="markets-note label">{row.note}</td>
    </tr>
  );
}
