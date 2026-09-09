"use client";

import { useEffect, useMemo, useState } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import { HOLDERS_SHAPE, shareOfCompany, type HoldersRecord } from "@/lib/holders";
import { basisFactor } from "@/lib/thirteen-f.js";
import { ABSENT, count, money, percent } from "./format";

/**
 * Who holds the company, as the holders themselves reported it.
 *
 * Form 13F, filed by every institutional manager with over $100m under
 * discretion within forty-five days of a quarter end. It is not a register of
 * owners and must not be read as one: it excludes insiders, founders, anyone
 * outside the United States and every manager under the threshold, and it is a
 * quarter old before it is filed.
 *
 * The share of the company is the sum of what was filed, and it double-counts.
 * Where discretion over the same shares is shared — a custodian and the adviser
 * behind it — both file, and both are telling the truth. Apple's reported
 * shares come to about eighty-five per cent of a company nobody claims is
 * eighty-five per cent institutionally held. The figure stays because it is
 * what a reader wants; the sentence under it stays because without it the
 * figure is the same arithmetic, wrong, and quiet about that.
 */

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "ready"; record: HoldersRecord };

/** Rows on screen before the reader asks for the rest. */
const VISIBLE = 5;

/** `31-MAR-2026` as the SEC writes it, in the form every date here is kept in. */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function isoQuarter(asOf: string | null): string | null {
  const found = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(asOf ?? "");
  if (!found) return null;
  const month = MONTHS.indexOf(found[2]);
  return month < 0 ? null : `${found[3]}-${String(month + 1).padStart(2, "0")}-${found[1]}`;
}

/**
 * The share count to measure a quarter-old holding against.
 *
 * The company's own count at that quarter, not today's: a filer that has bought
 * back three per cent of itself since March would otherwise have every March
 * holding measured against a smaller company and every share of it overstated.
 * The nearest filed period wins, and where none is filed the current basis
 * stands in — which the caption names.
 */
function sharesAt(view: IoCompanyView, asOf: string | null): { shares: number | null; from: string | null } {
  const periods = [...view.trailing, ...view.annual].filter((period) => period.valuationBasis != null);
  if (!periods.length || !asOf) return { shares: view.basis?.shares ?? null, from: null };
  const target = Date.parse(asOf);
  if (!Number.isFinite(target)) return { shares: view.basis?.shares ?? null, from: null };
  const nearest = periods.reduce((best, period) =>
    Math.abs(Date.parse(period.end) - target) < Math.abs(Date.parse(best.end) - target) ? period : best);
  return { shares: nearest.valuationBasis!.shares, from: nearest.label };
}

interface Slice { id: string; name: string; share: number; shares: number; value: number; rest: boolean }

/**
 * The company as a circle, and the managers on screen as arcs of it.
 *
 * One ink, so the ranking cannot be a set of colours: the arcs step down in
 * weight from the largest holder to the smallest, which is the same order the
 * table beside it reads in. Nothing is encoded here that the table does not
 * also state in figures — the ring is for the proportion, which is the one
 * thing a column of percentages is bad at showing.
 *
 * Pointing at an arc names its row and pointing at a row lights its arc, which
 * is the whole reason to draw the two side by side: on a ring of five similar
 * slices, "which one is BlackRock" is otherwise a question the picture cannot
 * answer and the reader has to count round to solve.
 */
function Ring({ slices, active, onActive }: {
  slices: Slice[];
  active: string | null;
  onActive: (id: string | null) => void;
}) {
  const R = 60, C = 2 * Math.PI * R;
  if (!slices.length) return null;
  // Each arc starts where the one before it ended, worked out in one pass so
  // nothing is mutated while the picture is being drawn.
  const arcs = slices.reduce<Array<{ slice: Slice; length: number; offset: number }>>((laid, slice) => {
    const length = Math.max(0, Math.min(1, slice.share)) * C;
    const offset = laid.length ? laid[laid.length - 1].offset + laid[laid.length - 1].length : 0;
    return [...laid, { slice, length, offset }];
  }, []);
  return (
    <svg className="holders-ring" viewBox="0 0 150 150" role="img" aria-label="Share of the company held by the managers listed">
      {arcs.map(({ slice, length, offset }, index) => {
        // Faintest for the part no listed manager accounts for, and a step
        // down the ramp for each one that does. Whatever is under the pointer
        // goes to full ink and everything else stands back.
        const weight = slice.rest ? 0.08 : Math.max(0.3, 0.95 - index * 0.14);
        return (
          <circle
            key={slice.id}
            cx="75" cy="75" r={R}
            fill="none"
            strokeWidth={active === slice.id ? 30 : 26}
            strokeDasharray={`${length.toFixed(2)} ${(C - length).toFixed(2)}`}
            strokeDashoffset={(-offset).toFixed(2)}
            opacity={active == null ? weight : active === slice.id ? 1 : Math.min(weight, 0.18)}
            transform="rotate(-90 75 75)"
            onMouseEnter={() => onActive(slice.id)}
            onMouseLeave={() => onActive(null)}
          >
            <title>{slice.name}</title>
          </circle>
        );
      })}
    </svg>
  );
}

export function Holders({ ticker, view }: { ticker: string; view: IoCompanyView }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // No reset here: the section is keyed by the company, so a different
    // ticker is a different component and starts in `loading` of its own.
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/io/${encodeURIComponent(ticker)}/holders?v=${HOLDERS_SHAPE}`, { signal: controller.signal });
        if (!response.ok) { setState({ kind: "absent" }); return; }
        setState({ kind: "ready", record: await response.json() as HoldersRecord });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "absent" });
      }
    })();
    return () => controller.abort();
  }, [ticker]);

  const record = state.kind === "ready" ? state.record : null;
  const quarterEnd = isoQuarter(record?.asOf ?? null);
  const [closeAt, setCloseAt] = useState<{ date: string; price: number | null } | null>(null);

  /*
   * One price: the company's own adjusted close on the quarter the filings are
   * for. It is the other half of the basis test, and it comes from the endpoint
   * the valuation history already asks, so it is a request the page has warm.
   */
  useEffect(() => {
    if (!quarterEnd) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/prices/${encodeURIComponent(ticker)}?dates=${quarterEnd}`, { signal: controller.signal });
        if (!response.ok) return;
        const body = await response.json() as { points?: Array<{ point?: { priceClose?: number | null; close?: number | null } | null }> };
        const point = body.points?.[0]?.point;
        setCloseAt({ date: quarterEnd, price: point?.priceClose ?? point?.close ?? null });
      } catch {
        // Without it the basis is assumed unchanged, which is right for every
        // company that has not split.
      }
    })();
    return () => controller.abort();
  }, [ticker, quarterEnd]);
  const basis = useMemo(() => sharesAt(view, record?.asOf ?? null), [view, record]);
  const shown = useMemo(
    () => (expanded ? record?.top ?? [] : (record?.top ?? []).slice(0, VISIBLE)),
    [expanded, record],
  );

  const [active, setActive] = useState<string | null>(null);

  /*
   * One list, read twice: once as arcs and once as rows.
   *
   * The circle is the company, so whatever the listed managers do not account
   * for is a slice of it too — the thousands of smaller filings and everybody
   * who files nothing at all. It is named rather than left as an unlabelled
   * gap, because a table of five managers and a ring with a silent majority
   * invite the same wrong reading: that these five are the company.
   *
   * Ring and table share this array, so an arc and its row cannot disagree
   * about a figure or fall out of step over which one is under the pointer.
   */
  /** What the filings implied a share was worth, from the filings on screen. */
  const impliedPrice = useMemo(() => {
    const prices = (record?.top ?? [])
      .filter((holding) => holding.value > 0 && holding.shares > 0)
      .map((holding) => holding.value / holding.shares)
      .sort((left, right) => left - right);
    return prices.length ? prices[Math.floor(prices.length / 2)] : null;
  }, [record]);

  const factor = basisFactor(impliedPrice, closeAt?.price ?? null);

  const slices = useMemo(() => {
    const drawn = shown.flatMap((holding) => {
      // Restated onto the basis every other share count on this site is kept
      // on, so a holding and the company it is a holding of can be divided.
      const shares = holding.shares * factor;
      const share = shareOfCompany(shares, basis.shares);
      return share == null ? [] : [{
        id: holding.name,
        name: holding.name,
        share,
        shares,
        value: holding.value,
        rest: false,
      }];
    });
    const left = 1 - drawn.reduce((sum, slice) => sum + slice.share, 0);
    const shares = basis.shares == null ? null : basis.shares - drawn.reduce((sum, slice) => sum + slice.shares, 0);
    // Under half a per cent it is a rounding artefact, and over a hundred the
    // filings have double-counted the company away. Neither is a slice.
    return left > 0.005
      ? [...drawn, { id: "rest", name: "Everyone else", share: left, shares: shares ?? 0, value: 0, rest: true }]
      : drawn;
  }, [shown, basis.shares, factor]);

  if (!record || !record.top.length) return null;

  return (
    <section className="section holders" id="holders">
      <div className="section-head">
        <h2 className="label">Institutional holders</h2>
        <span className="label">
          Form 13F · {count(record.managers)} managers{record.asOf ? ` · ${record.asOf}` : ""}
        </span>
      </div>

      {/*
        * A share count restated is a share count that says so.
        *
        * The filings counted shares as they stood at the quarter; this site
        * counts every share on today's basis. Where a split has happened
        * between the two, the holdings are restated onto the current basis so
        * that a holding and the company it is a holding of can be divided at
        * all — and the reader is told, because the figure on screen is then
        * not the figure in the filing.
        */}
      {factor !== 1 ? (
        <p className="stat-note holders-restated">
          Restated for a {factor > 1 ? `${factor.toFixed(0)}-for-1 split` : `1-for-${(1 / factor).toFixed(0)} reverse split`} since
          {" "}{record.asOf}: the filings counted shares as they stood then, and every count on this site is on today&rsquo;s basis.
        </p>
      ) : null}

      <div className="holders-split">
        <Ring slices={slices} active={active} onActive={setActive} />
        <div className="sheet holders-sheet">
          <table>
            <thead>
              <tr>
                <th className="key" scope="col">Manager</th>
                <th scope="col">Shares</th>
                <th scope="col">Value</th>
                <th scope="col">Share of company</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((slice) => (
                <tr
                  key={slice.id}
                  data-selected={active === slice.id}
                  data-rest={slice.rest || undefined}
                  onMouseEnter={() => setActive(slice.id)}
                  onMouseLeave={() => setActive(null)}
                >
                  <th className="key" scope="row">{slice.name}</th>
                  <td data-empty={!slice.shares}>{slice.shares ? count(slice.shares) : ABSENT}</td>
                  {/* Everyone else has no filed value: it is not a filing. */}
                  <td data-empty={!slice.value}>{slice.value ? money(slice.value, "USD") : ABSENT}</td>
                  <td>{percent(slice.share, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {record.top.length > VISIBLE ? (
        <div className="holders-foot">
          <button className="metric-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
            {expanded ? `Show ${VISIBLE}` : `Show all ${record.top.length}`}
          </button>
        </div>
      ) : null}

    </section>
  );
}
