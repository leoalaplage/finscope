"use client";

import { useEffect, useState } from "react";
import type { PeerRow, PeersAnswer } from "@/app/api/peers/[ticker]/route";
import { ABSENT, money, percent } from "./format";

/**
 * What the rest of the industry costs, under what this company costs.
 *
 * The panel above says a company trades at twenty-eight times its free cash
 * flow and leaves the only question that matters unanswered: against what.
 * Against its own decade, which the ranges above already draw — and against
 * the businesses that do the same thing, which nothing on this site could show
 * until there was an index to compare with.
 *
 * A valuation panel, and deliberately not a second opinion on the grade. The
 * score on this page is struck against fixed anchors: it says something about
 * the company rather than about whoever it happened to be scored beside, and a
 * cheap sector does not make a weak business strong. The grades are here as
 * context for the prices, in the column furthest from them.
 *
 * The middle of the sector is the figure to read, so it is a sentence rather
 * than a row: a median is what turns a multiple into a reading, and a table
 * alone leaves the reader to compute it.
 *
 * A company the index does not carry gets no panel at all. A cohort assembled
 * on some other basis — the same exchange, a similar size — would be peers that
 * are not peers, which is the one answer worse than no answer.
 */

const WINDOW = 9;

/** A multiple, at the precision a multiple is read at. */
const times = (value: number | null) => value == null ? ABSENT : `${value.toFixed(1)}×`;
const cap = (value: number | null) => value == null ? ABSENT : money(value * 1e9, "USD");

export function Peers({ ticker }: { ticker: string }) {
  /*
   * The answer names the company it is for, the way every other state on this
   * page does. A reader moving from one company to the next has an answer in
   * hand that is not this one's; one that says which company it is simply is
   * not this one, rather than being cleared by an effect a render later.
   */
  const [held, setHeld] = useState<PeersAnswer | null>(null);
  const answer = held?.subject === ticker.toUpperCase() ? held : null;

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/peers/${encodeURIComponent(ticker)}`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as PeersAnswer;
        if (!controller.signal.aborted && payload.peers?.length > 1) setHeld(payload);
      } catch {
        // No panel. This is context, and context that fails is simply absent.
      }
    })();
    return () => controller.abort();
  }, [ticker]);

  if (!answer) return null;
  /*
   * A sector with no priced multiple in it is not a sector this panel can say
   * anything about. Banks, brokers and insurers have no enterprise value —
   * their balance sheet is the business, and every measure struck on one is
   * withheld from them everywhere else on this site. A table of dashes under a
   * heading about price is noise wearing the shape of information.
   */
  const priced = answer.medians.evFcf != null || answer.medians.evEbit != null || answer.medians.fcfYield != null;
  if (!priced) return null;

  /*
   * The companies nearest this one in size, rather than the top of the sector.
   *
   * A sector runs from six hundred billion to four, and the largest nine are
   * not the comparison a reader of the tenth is making. Centred on the subject,
   * which is always shown.
   */
  const at = answer.peers.findIndex((peer) => peer.ticker.toUpperCase() === answer.subject);
  const start = Math.max(0, Math.min(at - Math.floor(WINDOW / 2), answer.peers.length - WINDOW));
  const shown = answer.peers.slice(Math.max(0, start), Math.max(0, start) + WINDOW);

  const middle = answer.medians;
  const sentence = [
    middle.evFcf == null ? null : `${times(middle.evFcf)} its free cash flow`,
    middle.evEbit == null ? null : `${times(middle.evEbit)} its operating profit`,
  ].filter(Boolean).join(" and ");

  return (
    <div className="range-group peers">
      <h3 className="label">What its industry costs</h3>
      <p className="stat-note">
        The middle of {answer.sector.toLowerCase()} is priced at {sentence}.{" "}
        {answer.peers.length} companies in the {answer.index}, membership of {answer.asOf}.
      </p>
      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th className="key" scope="col">Company</th>
              <th scope="col">Market cap</th>
              <th scope="col">EV/EBIT</th>
              <th scope="col">EV/FCF</th>
              <th scope="col">FCF yield</th>
              <th scope="col">Grade</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((peer) => <Row key={peer.ticker} peer={peer} subject={peer.ticker.toUpperCase() === answer.subject} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ peer, subject }: { peer: PeerRow; subject: boolean }) {
  return (
    <tr data-selected={subject}>
      <th className="key" scope="row">
        {/* The company this page is about is not a link to itself. */}
        {subject ? <span className="key-open">{peer.ticker}</span> : <a className="key-open" href={`/s/${encodeURIComponent(peer.ticker)}`}>{peer.ticker}</a>}
      </th>
      <td data-empty={peer.marketCap == null}>{cap(peer.marketCap)}</td>
      <td data-empty={peer.evEbit == null}>{times(peer.evEbit)}</td>
      <td data-empty={peer.evFcf == null}>{times(peer.evFcf)}</td>
      <td data-empty={peer.fcfYield == null}>{peer.fcfYield == null ? ABSENT : percent(peer.fcfYield / 100, 1)}</td>
      <td data-empty={peer.grade === "NR"}>{peer.grade}</td>
    </tr>
  );
}
