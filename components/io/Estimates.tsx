"use client";

import { useEffect, useState } from "react";
import { forwardReading, type EstimateSnapshot, type Estimates as EstimatesData } from "@/lib/estimates";
import { useWidth } from "@/components/term/use-width";
import { ABSENT, price as writePrice, shortDate } from "./format";

/**
 * What analysts expect, labelled as theirs (lib/estimates.ts).
 *
 * The forward multiples first — the P/E on the next twelve months' expected
 * earnings, the PEG, the price target against the price — then the consensus
 * quarter by quarter and year by year with its spread and revisions, how it
 * has moved, and the recommendations behind the target. Every figure here is
 * a forecast and the section says so; none of it is mixed with a filed figure.
 */

interface Answer { estimates: EstimatesData; history: EstimateSnapshot[] }

const signed = (value: number | null, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(places)}%`);
const multiple = (value: number | null) => (value == null || !Number.isFinite(value) ? ABSENT : `${value.toFixed(1)}×`);
const eps = (value: number | null, currency: string) => (value == null ? ABSENT : writePrice(value, currency));
const dir = (value: number | null | undefined) => (value == null || value === 0 ? undefined : value > 0 ? "up" : "down");

export function Estimates({ ticker, price, currency }: { ticker: string; price: number | null; currency: string }) {
  const [answer, setAnswer] = useState<{ ticker: string; data: Answer | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/estimates/${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<Answer> : null))
      .then((data) => { if (!controller.signal.aborted) setAnswer({ ticker, data }); })
      .catch(() => { if (!controller.signal.aborted) setAnswer({ ticker, data: null }); });
    return () => controller.abort();
  }, [ticker]);

  const data = answer?.ticker === ticker ? answer.data : undefined;
  if (data === undefined) return <section className="section estimates"><p className="stat-note">Reading the analysts&apos; consensus…</p></section>;
  const estimates = data?.estimates;
  if (!estimates || (!estimates.quarterly.length && !estimates.yearly.length && !estimates.target)) {
    return <section className="section estimates"><p className="stat-note">No analyst covers this company in the consensus Nasdaq publishes.</p></section>;
  }
  const reading = forwardReading(estimates, price);
  const ratings = estimates.ratings;
  const total = ratings ? ratings.buy + ratings.hold + ratings.sell : 0;
  const fy1 = estimates.yearly[0]; const fy2 = estimates.yearly[1];

  return (
    <section className="section estimates" aria-label="Analysts' estimates">
      <div className="grid-ruled stats estimates-strip">
        <Figure label="Forward P/E" value={multiple(reading.forwardPe)} note={reading.ntmEps == null ? "No consensus for the next twelve months" : `On ${eps(reading.ntmEps, currency)} of EPS expected over the next 12 months`} />
        <Figure label={`EPS · FY ${fy1?.fiscalEnd ?? ""}`} value={eps(fy1?.consensus ?? null, currency)} note={fy1 ? `${fy1.analysts ?? "?"} analysts · ${eps(fy1.low, currency)} to ${eps(fy1.high, currency)}` : undefined} />
        <Figure label={`Expected growth · FY ${fy2?.fiscalEnd ?? ""}`} value={signed(reading.growth)} tone={dir(reading.growth)} note={fy2 ? `To ${eps(fy2.consensus, currency)} a share` : undefined} />
        <Figure label="PEG" value={reading.peg == null ? ABSENT : reading.peg.toFixed(2)} note="Forward P/E over expected growth" />
        <Figure label="Price target" value={estimates.target?.mean == null ? ABSENT : writePrice(estimates.target.mean, currency)} note={estimates.target ? `${writePrice(estimates.target.low, currency)} to ${writePrice(estimates.target.high, currency)}` : undefined} />
        <Figure label="Upside to target" value={signed(reading.upside)} tone={dir(reading.upside)} note={price != null ? `From ${writePrice(price, currency)}` : "No price"} />
        <Figure label="Recommendations" value={ratings?.label ?? ABSENT} note={total ? `${ratings!.buy} buy · ${ratings!.hold} hold · ${ratings!.sell} sell` : undefined} />
      </div>

      <div className="estimates-grid">
        <div>
          {estimates.target?.low != null && estimates.target.high != null ? (
            <TargetRange low={estimates.target.low} mean={estimates.target.mean} high={estimates.target.high} price={price} currency={currency} />
          ) : null}
          {total ? (
            <div className="estimates-ratings" role="img" aria-label={`${ratings!.buy} buy, ${ratings!.hold} hold, ${ratings!.sell} sell`}>
              <span data-kind="buy" style={{ flexGrow: ratings!.buy }}>{ratings!.buy ? `Buy ${ratings!.buy}` : ""}</span>
              <span data-kind="hold" style={{ flexGrow: ratings!.hold }}>{ratings!.hold ? `Hold ${ratings!.hold}` : ""}</span>
              <span data-kind="sell" style={{ flexGrow: ratings!.sell }}>{ratings!.sell ? `Sell ${ratings!.sell}` : ""}</span>
            </div>
          ) : null}
          <Revisions estimates={estimates} history={data!.history} currency={currency} />
        </div>
        <div>
          <ConsensusTable title="By fiscal quarter" rows={estimates.quarterly} currency={currency} />
          <ConsensusTable title="By fiscal year" rows={estimates.yearly} currency={currency} />
        </div>
      </div>
      <p className="stat-note">
        Analysts&apos; forecasts, not filed figures — {estimates.source}, read {shortDate(estimates.asOf)}. Forward P/E is the price over the sum of the next four
        quarters&apos; consensus EPS; PEG divides it by the growth expected from this fiscal year to the next. Revisions count the estimates raised and cut over the last
        four weeks.
      </p>
    </section>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="stat-value" data-dir={tone} data-empty={value === ABSENT}>{value}</div>
      {note ? <p className="stat-note">{note}</p> : null}
    </div>
  );
}

function ConsensusTable({ title, rows, currency }: { title: string; rows: EstimatesData["quarterly"]; currency: string }) {
  if (!rows.length) return null;
  return (
    <div className="sheet estimates-table">
      <table>
        <caption className="label">{title}</caption>
        <thead><tr><th className="key" scope="col">Ending</th><th scope="col">Consensus EPS</th><th scope="col">Low</th><th scope="col">High</th><th scope="col">Analysts</th><th scope="col" title="Estimates raised and cut over the last four weeks">Revisions 4w</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.fiscalEnd}>
              <th className="key" scope="row">{row.fiscalEnd}</th>
              <td>{eps(row.consensus, currency)}</td>
              <td>{eps(row.low, currency)}</td>
              <td>{eps(row.high, currency)}</td>
              <td>{row.analysts ?? ABSENT}</td>
              <td>
                {row.up ? <span data-dir="up">▲{row.up}</span> : null}{row.up && row.down ? " " : null}
                {row.down ? <span data-dir="down">▼{row.down}</span> : null}
                {!row.up && !row.down ? ABSENT : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The price target's range, its mean, and today's price, on one line. */
function TargetRange({ low, mean, high, price, currency }: { low: number; mean: number | null; high: number; price: number | null; currency: string }) {
  const values = [low, high, ...(price != null ? [price] : []), ...(mean != null ? [mean] : [])];
  const min = Math.min(...values) * 0.97; const max = Math.max(...values) * 1.03;
  const at = (value: number) => `${((value - min) / (max - min || 1)) * 100}%`;
  return (
    <div className="estimates-range" aria-label={`Price targets from ${low} to ${high}, mean ${mean}, price ${price}`}>
      <div className="label">Price target range</div>
      <div className="estimates-range-track">
        <span className="estimates-range-band" style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }} />
        {mean != null ? <span className="estimates-range-mean" style={{ left: at(mean) }} title={`Mean ${writePrice(mean, currency)}`} /> : null}
        {price != null ? <span className="estimates-range-price" style={{ left: at(price) }} title={`Price ${writePrice(price, currency)}`} /> : null}
      </div>
      <div className="estimates-range-labels">
        <span>Low {writePrice(low, currency)}</span>
        {mean != null ? <span>Mean {writePrice(mean, currency)}</span> : null}
        {price != null ? <span className="estimates-range-now">Price {writePrice(price, currency)}</span> : null}
        <span>High {writePrice(high, currency)}</span>
      </div>
    </div>
  );
}

/**
 * How the consensus has moved: the site's own daily snapshots where it has a
 * few, and Nasdaq's a-week-ago and a-month-ago readings in any case.
 */
function Revisions({ estimates, history, currency }: { estimates: EstimatesData; history: EstimateSnapshot[]; currency: string }) {
  const { ref, width } = useWidth();
  const momentum = estimates.momentum;
  // The history follows one fiscal year at a time: a new year resets the line.
  const year = estimates.yearly[0]?.fiscalEnd;
  const points = history.filter((entry) => entry.fy1 != null && entry.fy1End === year);
  const height = 120; const left = 6; const right = 56; const top = 8; const bottom = 18;
  const values = points.map((entry) => entry.fy1!);
  const low = Math.min(...values); const high = Math.max(...values);
  const span = high - low || Math.abs(high) * 0.02 || 1;
  const x = (index: number) => left + (index / Math.max(points.length - 1, 1)) * (width - left - right);
  const y = (value: number) => top + (1 - (value - (low - span * 0.1)) / (span * 1.2)) * (height - top - bottom);
  const change = (now: number | null, before: number | null) => (now == null || before == null || before === 0 ? null : now / before - 1);
  return (
    <div className="estimates-revisions" ref={ref}>
      <div className="label">Consensus over time</div>
      {momentum ? (
        <table className="estimates-momentum">
          <thead><tr><th /><th scope="col">Now</th><th scope="col">1 week ago</th><th scope="col">1 month ago</th><th scope="col">Change, 1 month</th></tr></thead>
          <tbody>
            {[{ name: `Quarter ${momentum.quarter.label ?? ""}`, row: momentum.quarter }, { name: `Year ${momentum.year.label ?? ""}`, row: momentum.year }].map(({ name, row }) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{eps(row.now, currency)}</td><td>{eps(row.weekAgo, currency)}</td><td>{eps(row.monthAgo, currency)}</td>
                <td data-dir={dir(change(row.now, row.monthAgo))}>{signed(change(row.now, row.monthAgo), 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {points.length >= 3 && width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={`Consensus EPS for fiscal year ${year}, day by day`}>
          <path className="estimates-line" d={points.map((entry, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(entry.fy1!).toFixed(1)}`).join("")} />
          <text className="estimates-tick" x={width - right + 6} y={y(high) + 4}>{eps(high, currency)}</text>
          <text className="estimates-tick" x={width - right + 6} y={y(low) + 4}>{eps(low, currency)}</text>
          <text className="estimates-tick" x={left} y={height - 4}>{shortDate(points[0].date)}</text>
          <text className="estimates-tick" x={width - right} y={height - 4} textAnchor="end">{shortDate(points.at(-1)!.date)}</text>
        </svg>
      ) : (
        <p className="stat-note">Tenqay records the consensus every day; the line for fiscal year {year} draws once a few days are kept{points.length ? ` (${points.length} so far, since ${shortDate(points[0].date)})` : ""}.</p>
      )}
    </div>
  );
}
