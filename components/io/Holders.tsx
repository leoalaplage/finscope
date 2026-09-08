"use client";

import { useEffect, useMemo, useState } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import { HOLDERS_SHAPE, shareOfCompany, type HoldersRecord } from "@/lib/holders";
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
  const basis = useMemo(() => sharesAt(view, record?.asOf ?? null), [view, record]);
  const shown = expanded ? record?.top ?? [] : (record?.top ?? []).slice(0, VISIBLE);

  if (!record || !record.top.length) return null;

  const reportedShare = shareOfCompany(record.reported, basis.shares);

  return (
    <section className="section holders" id="holders">
      <div className="section-head">
        <h2 className="label">Institutional holders</h2>
        <span className="label">
          Form 13F · {count(record.managers)} managers{record.asOf ? ` · ${record.asOf}` : ""}
        </span>
      </div>

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
            {shown.map((holding) => {
              const share = shareOfCompany(holding.shares, basis.shares);
              return (
                <tr key={holding.name}>
                  <th className="key" scope="row">{holding.name}</th>
                  <td>{count(holding.shares)}</td>
                  <td data-empty={!holding.value}>{holding.value ? money(holding.value, "USD") : ABSENT}</td>
                  <td data-empty={share == null}>{share == null ? ABSENT : percent(share, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {record.top.length > VISIBLE ? (
        <div className="holders-foot">
          <button className="metric-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
            {expanded ? `Show ${VISIBLE}` : `Show all ${record.top.length}`}
          </button>
        </div>
      ) : null}

      <p className="stat-note holders-note">
        Every share of the company here is <strong>the sum of what was filed, and may double-count</strong>: where
        discretion over the same shares is shared — a custodian and the adviser behind it — both managers file, and both
        are right. All {count(record.managers)} filings together report{" "}
        {reportedShare == null ? "a share that cannot be struck" : percent(reportedShare, 0)} of the company on that
        basis{basis.from ? `, measured against the share count filed for ${basis.from}` : ""}.
      </p>
      <p className="stat-note">
        13F covers managers with over $100m under discretion and their US-listed equity only, filed within 45 days of
        the quarter end. It is not a register of owners: insiders, founders, holders outside the United States and
        every smaller manager are absent from it. Options are excluded — a right to buy a million shares is not a
        million shares.
      </p>
    </section>
  );
}
