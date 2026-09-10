"use client";

import { useEffect, useMemo, useState } from "react";
import { INSIDER_SHAPE, type InsiderRecord, type InsiderTransaction } from "@/lib/adapters/insiders";
import { ABSENT, count, money, shortDate } from "./format";

/**
 * What the people who run the company did with their own shares.
 *
 * The whole section turns on one distinction. Most Form 4 rows are not
 * decisions: a grant vests, an option is exercised, shares are withheld to pay
 * the tax on that exercise. Add those up and every company on earth shows
 * "insider selling" every quarter, because compensation is paid in stock and
 * stock has to be sold to pay the tax on it — Apple's largest recent disposal
 * is $4.8m of shares withheld on a vesting, which nobody chose to sell.
 *
 * So the two are separated and never summed. What is totalled at the top is
 * open-market buying and selling only: somebody deciding, with their own money,
 * to own more or less of the thing they run. Everything else is listed, named
 * for what it is, and left out of the total.
 */

/** Rows on screen before the reader asks for the rest. */
const VISIBLE = 5;

export type InsiderState =
  | { kind: "loading"; ticker: string }
  | { kind: "absent"; ticker: string; reason: string }
  | { kind: "ready"; ticker: string; record: InsiderRecord };

/** The window a total is struck over, and what a reader calls it. */
const WINDOWS: Array<{ months: number; label: string }> = [
  { months: 3, label: "3 months" },
  { months: 12, label: "12 months" },
];

const since = (months: number) => {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
};

interface Tally { bought: number; sold: number; buyers: Set<string>; sellers: Set<string> }

const tally = (rows: InsiderTransaction[], from: string): Tally => {
  const result: Tally = { bought: 0, sold: 0, buyers: new Set(), sellers: new Set() };
  for (const row of rows) {
    if (row.kind !== "open-market" || row.date < from || row.value == null) continue;
    if (row.direction === "acquired") { result.bought += row.value; result.buyers.add(row.owner); }
    else { result.sold += row.value; result.sellers.add(row.owner); }
  }
  return result;
};

export function useInsiders(ticker: string): InsiderState {
  const [state, setState] = useState<InsiderState>({ kind: "loading", ticker });
  useEffect(() => {
    // No reset here: the section is keyed by the company, so a different
    // ticker is a different component and starts in `loading` of its own.
    const controller = new AbortController();
    (async () => {
      try {
        // The shape travels in the URL: a day-long edge copy of a corrected
        // answer is a correction nobody sees. See `INSIDER_SHAPE`.
        const response = await fetch(`/api/io/${encodeURIComponent(ticker)}/insiders?v=${INSIDER_SHAPE}`, { signal: controller.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          setState({ kind: "absent", ticker, reason: body.error ?? "Form 4 filings could not be read." });
          return;
        }
        setState({ kind: "ready", ticker, record: await response.json() as InsiderRecord });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "absent", ticker, reason: "Form 4 filings could not be read." });
      }
    })();
    return () => controller.abort();
  }, [ticker]);

  return state.ticker === ticker ? state : { kind: "loading", ticker };
}

export function Insiders({ state }: { state: InsiderState }) {
  /*
   * Two switches, and they are about different things. `everything` decides
   * whether the compensation rows are on the table at all; `expanded` decides
   * how much of it is on screen. A section is a glance, not a register.
   */
  const [everything, setEverything] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const record = state.kind === "ready" ? state.record : null;
  const decisions = useMemo(
    () => (record?.transactions ?? []).filter((row) => row.kind === "open-market"),
    [record],
  );
  const listed = useMemo(
    () => (everything ? record?.transactions ?? [] : decisions),
    [everything, record, decisions],
  );
  const shown = expanded ? listed.slice(0, 40) : listed.slice(0, VISIBLE);

  if (state.kind === "loading") return null;
  if (state.kind === "absent") return null;
  if (!record || !record.transactions.length) return null;

  const covered = record.transactions.at(-1)?.date ?? null;

  return (
    <section className="section insiders" id="insiders">
      <div className="section-head">
        <h2 className="label">Insider dealing</h2>
        <span className="label">
          Form 4 · last {record.filingsRead} of {count(record.filingsAvailable)} filings
        </span>
      </div>


      <div className="grid-ruled insiders-grid">
        {WINDOWS.map((window) => {
          const from = since(window.months);
          const sums = tally(record.transactions, from);
          const net = sums.bought - sums.sold;
          const nothing = sums.bought === 0 && sums.sold === 0;
          return (
            <div className="stat" key={window.months}>
              <div className="label">Net, {window.label}</div>
              <div className="stat-value" data-empty={nothing}>
                {nothing ? ABSENT : `${net >= 0 ? "+" : "−"}${money(Math.abs(net), "USD")}`}
              </div>
              <p className="stat-note">
                {nothing
                  ? "No open-market purchase or sale was filed in this window."
                  : `${money(sums.bought, "USD")} bought by ${sums.buyers.size}, ${money(sums.sold, "USD")} sold by ${sums.sellers.size}`}
              </p>
            </div>
          );
        })}
      </div>

      <div className="section-head insiders-switch">
        <span className="label">
          {everything ? "Every reported transaction" : "Open-market decisions"} · {shown.length} of {listed.length}
        </span>
        <div className="insiders-controls">
          {listed.length > VISIBLE ? (
            <button className="metric-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
              {expanded ? `Show ${VISIBLE}` : `Show all ${listed.length}`}
            </button>
          ) : null}
          <button className="metric-toggle" type="button" aria-pressed={everything} onClick={() => { setEverything((current) => !current); setExpanded(false); }}>
            {everything ? "Decisions only" : "Show grants and exercises"}
          </button>
        </div>
      </div>

      {shown.length ? (
        <div className="sheet insiders-sheet">
          <table>
            <thead>
              <tr>
                <th className="key" scope="col">Insider</th>
                <th scope="col">Date</th>
                <th scope="col">Transaction</th>
                <th scope="col">Shares</th>
                <th scope="col">Price</th>
                <th scope="col">Value</th>
                <th scope="col">Held after</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row, index) => (
                <tr key={`${row.accession}-${index}`}>
                  <th className="key" scope="row">
                    <a className="key-open" href={row.sourceUrl} target="_blank" rel="noreferrer">
                      <span className="insiders-name">{row.owner}</span>
                      <small>{row.role}</small>
                    </a>
                  </th>
                  <td>{shortDate(row.date)}</td>
                  <td data-decision={row.kind === "open-market"}>{row.codeLabel}</td>
                  <td>{row.shares == null ? ABSENT : `${row.direction === "acquired" ? "+" : "−"}${count(row.shares)}`}</td>
                  {/* A grant has no price. Nought is not a price, so it is blank. */}
                  <td data-empty={row.price == null}>{row.price == null ? ABSENT : money(row.price, "USD")}</td>
                  <td data-empty={row.value == null}>{row.value == null ? ABSENT : money(row.value, "USD")}</td>
                  <td data-empty={row.sharesAfter == null}>{row.sharesAfter == null ? ABSENT : count(row.sharesAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="stat-note">
          No open-market purchase or sale appears in the last {record.filingsRead} filings. Everything reported was a
          grant, an exercise or tax withheld — open the other view to read it.
        </p>
      )}

      <p className="stat-note" style={{ marginTop: 12 }}>
        Read from Form 4 on EDGAR{covered ? `, back to ${shortDate(covered)}` : ""}. Only the non-derivative table is
        counted: an option&rsquo;s price is a strike rather than anything paid, so adding it to a share price would total
        two unlike things. Each row links to the filing it came from.
      </p>
    </section>
  );
}
