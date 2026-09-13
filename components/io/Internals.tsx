"use client";

import { useEffect, useState } from "react";
import type { InternalsAnswer, Mover, SectorMove } from "@/app/api/internals/route";
import { ABSENT, delta } from "./format";

/**
 * What the market did, under what the indices did.
 *
 * An index level says the market rose. It does not say whether it rose because
 * four hundred companies rose or because five did, nor which industry carried
 * it — and a page whose only other equity content is the reader's own list
 * cannot say either. This is the thing a market page is for, and until there
 * was a whole index in the store it could not be asked.
 *
 * Three readings, in the order a reader wants them: how many rose against how
 * many fell, which industries moved, and the names at either end. Each is a
 * fact about five hundred companies rather than about an average of them.
 *
 * Nothing is fetched from anyone: the scheduled run already prices the index
 * every half hour and the quote states the day's move, so this is a read of a
 * table that was going to be written anyway.
 */

const mark = (value: number | null) =>
  value == null ? undefined : value > 0 ? "up" : value < 0 ? "down" : "flat";

export function Internals() {
  const [answer, setAnswer] = useState<InternalsAnswer | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/internals", { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as InternalsAnswer;
        if (!controller.signal.aborted && payload.sectors?.length) setAnswer(payload);
      } catch {
        // Context that fails is simply absent, as the wire below is.
      }
    })();
    return () => controller.abort();
  }, []);

  if (!answer) return null;
  const { breadth } = answer;
  const leading = Math.max(breadth.up, breadth.down);
  const share = breadth.up + breadth.down > 0 ? leading / (breadth.up + breadth.down) : 0;

  return (
    <section className="section internals" aria-labelledby="internals-title">
      <div className="section-head">
        <h2 className="label" id="internals-title">What the market did</h2>
        <span className="label">{answer.priced} of the {answer.index}</span>
      </div>

      {/* The one sentence the three charts above cannot say. */}
      <p className="stat-note">
        {breadth.up} rose, {breadth.down} fell{breadth.flat ? `, ${breadth.flat} unchanged` : ""} — the middle company
        {" "}<span className="day-mark" data-dir={mark(breadth.median)}>{delta(breadth.median / 100, 2)}</span>.
        {" "}{share >= .7
          ? `A day that moved together: ${Math.round(share * 100)}% of the index went the same way.`
          : `A divided day: the wider half is only ${Math.round(share * 100)}% of the index.`}
      </p>

      <div className="internals-grid">
        <div>
          <h3 className="label">By industry</h3>
          <div className="sheet internals-sheet">
            <table>
              <thead>
                <tr>
                  <th className="key" scope="col">Industry</th>
                  <th scope="col">Middle</th>
                  <th scope="col">Up</th>
                  <th scope="col">Down</th>
                </tr>
              </thead>
              <tbody>
                {answer.sectors.map((sector) => <SectorRow key={sector.sector} sector={sector}/>)}
              </tbody>
            </table>
          </div>
        </div>

        <div className="internals-ends">
          <div>
            <h3 className="label">Furthest up</h3>
            <ul className="internals-list">{answer.risers.map((company) => <MoverRow key={company.ticker} mover={company}/>)}</ul>
          </div>
          <div>
            <h3 className="label">Furthest down</h3>
            <ul className="internals-list">{answer.fallers.map((company) => <MoverRow key={company.ticker} mover={company}/>)}</ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectorRow({ sector }: { sector: SectorMove }) {
  return (
    <tr>
      <th className="key" scope="row">
        {sector.sector}
        {/* The count, because a sector of three is not a reading and the
            reader should be the one deciding that. */}
        <small> {sector.companies}</small>
      </th>
      <td><span className="day-mark" data-dir={mark(sector.median)}>{delta(sector.median / 100, 2)}</span></td>
      <td>{sector.up}</td>
      <td>{sector.down}</td>
    </tr>
  );
}

function MoverRow({ mover }: { mover: Mover }) {
  return (
    <li>
      <a href={`/s/${encodeURIComponent(mover.ticker)}`}>{mover.ticker}</a>
      <span className="label">{mover.name.length > 22 ? `${mover.name.slice(0, 21)}…` : mover.name}</span>
      <span className="day-mark" data-dir={mark(mover.changePercent)}>
        {mover.changePercent == null ? ABSENT : delta(mover.changePercent / 100, 1)}
      </span>
    </li>
  );
}
