"use client";

import { useMemo, useState } from "react";
import type { IoCompanyView, IoPeriod } from "@/lib/io/view";
import { IO_SECTIONS } from "@/lib/io/sections";
import { ABSENT, formatUnit, shortDate, type Unit } from "./format";

/**
 * The statements, as filed, with nothing folded away.
 *
 * One table rather than four, because four tables mean four horizontal
 * scrollbars that disagree with each other and a reader who has scrolled the
 * income statement to 2019 looking at a balance sheet still showing 2026. The
 * statement each row belongs to is a rule and a caption, which is how a filing
 * does it too.
 *
 * The most recent period is the leftmost column: a reader arrives wanting the
 * last one and reads backwards into the history from there.
 *
 * Above the table, the one line that stops a reader wondering whether the site
 * is broken: which period is the last one on file, when the filer published
 * it, and when these filings were read. A company whose newest column is five
 * months old is either a company that has filed nothing since, or a site that
 * has stopped looking — Copart's results were reported on the wire two days
 * before its figures here were questioned, and nothing on this page said that
 * the statements themselves were exactly as current as the SEC's own copy.
 * The reader should not have to take that on trust, and should not have to ask.
 */

const ANNUAL_COLUMNS = 15;
const QUARTERLY_COLUMNS = 16;

/**
 * The last period the filer has actually filed, whichever table is on show.
 *
 * Not the selected frequency's last column: the question this answers is "how
 * current is this company's reporting", and that is the same question whether
 * the reader is looking at years or at quarters. Not the trailing twelve
 * months either — that is a window this application computes, and a reader
 * asking what has been filed is asking what the filer filed.
 *
 * The periods arrive oldest first, so the last of them is the newest.
 */
export function lastFiled(view: Pick<IoCompanyView, "quarterly" | "annual">): IoPeriod | null {
  return view.quarterly.at(-1) ?? view.annual.at(-1) ?? null;
}

export function Statements({
  view,
  selected,
  onSelect,
}: {
  view: IoCompanyView;
  selected: string[];
  onSelect: (metric: string) => void;
}) {
  const [frequency, setFrequency] = useState<"annual" | "quarterly">("annual");

  const metrics = useMemo(() => new Map(view.metrics.map((metric) => [metric.key, metric])), [view.metrics]);

  const columns = useMemo<IoPeriod[]>(() => {
    const source = frequency === "annual" ? view.annual : view.quarterly;
    const recent = [...source].reverse().slice(0, frequency === "annual" ? ANNUAL_COLUMNS : QUARTERLY_COLUMNS);
    // The trailing twelve months leads, because it is the most current
    // statement of the business there is — and it is labelled as what it is
    // rather than allowed to look like a filed period.
    return view.ttm ? [view.ttm, ...recent] : recent;
  }, [frequency, view]);

  const filed = lastFiled(view);

  if (!columns.length) return null;

  return (
    <section className="section" id="statements">
      <div className="section-head">
        <h2 className="label">Statements</h2>
        <div className="seg">
          <button type="button" aria-pressed={frequency === "annual"} onClick={() => setFrequency("annual")}>Annual</button>
          <button type="button" aria-pressed={frequency === "quarterly"} onClick={() => setFrequency("quarterly")}>Quarterly</button>
        </div>
      </div>

      {filed && (
        <p className="filings-note">
          Last period on file: {filed.label}, ended {shortDate(filed.end)}
          {filed.publishedAt ? `, published ${shortDate(filed.publishedAt)}` : ""}.
          {" "}Filings read {shortDate(view.retrievedAt)}.
        </p>
      )}

      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th className="key" scope="col">{view.company.currency}</th>
              {columns.map((period) => (
                <th key={`${period.label}-${period.end}`} scope="col">{period.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {IO_SECTIONS.map((section) => (
              <SectionRows
                key={section.id}
                label={section.label}
                keys={section.metrics}
                columns={columns}
                metrics={metrics}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SectionRows({
  label,
  keys,
  columns,
  metrics,
  selected,
  onSelect,
}: {
  label: string;
  keys: string[];
  columns: IoPeriod[];
  metrics: Map<string, IoCompanyView["metrics"][number]>;
  selected: string[];
  onSelect: (metric: string) => void;
}) {
  // A metric no period in view carries is left out rather than drawn as a row
  // of em dashes: a bank has no free cash flow here, and eleven empty lines
  // saying so is not information.
  const present = keys.filter((key) => columns.some((period) => period.values[key] != null));
  if (!present.length) return null;

  return (
    <>
      <tr className="group rule">
        <th className="key" scope="colgroup" colSpan={columns.length + 1}>
          <span className="label">{label}</span>
        </th>
      </tr>
      {present.map((key) => {
        const metric = metrics.get(key);
        if (!metric) return null;
        return (
          <tr key={key} data-selected={selected.includes(key)}>
            <th className="key" scope="row">
              {/*
                * The label is the control. A reader who has found the line they
                * care about in a table of sixty-five is a reader who wants to
                * see its shape, and making them scroll back up to hunt for the
                * same measure among the panels is asking them to find it twice.
                */}
              <button type="button" className="key-open" onClick={() => onSelect(key)} aria-pressed={selected.includes(key)}>
                {metric.label}
              </button>
            </th>
            {columns.map((period) => {
              const value = period.values[key];
              const text = value == null ? ABSENT : formatUnit(value, metric.unit as Unit, period.currency);
              return (
                <td key={`${key}-${period.end}-${period.label}`} data-empty={value == null}>{text}</td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
