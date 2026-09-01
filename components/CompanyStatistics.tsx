"use client";

import { useMemo } from "react";
import { ExplainedHeading, Explainer } from "./Explainer";
import { bestIn, companyStatistics, formatStat, type Stat, type StatGroup, type StatisticsPeriodicity } from "@/lib/company-statistics";
import type { CompanyDataset, PricePoint } from "@/lib/types";

/**
 * Why the forward-looking half of a conventional statistics panel is absent.
 *
 * Next-twelve-month multiples, price targets, PEG and forward growth are all
 * consensus analyst estimates. FinScope reads filings and prices; it has no
 * estimates provider, and a number with no source does not belong next to ones
 * that carry an accession number.
 */
const FORWARD_NOTE = "Forward multiples, price targets and estimated growth are analyst consensus figures. FinScope reports only filed facts and matched market prices, so they are absent rather than guessed.";

function StatValue({ stat, currency, highlight }: { stat: Stat; currency: string; highlight?: boolean }) {
  const text = formatStat(stat.value, stat.format, currency);
  return <span className={`stat-value${highlight ? " best" : ""}`} title={stat.value == null ? stat.reason : stat.formula}>{text}</span>;
}

/** One company: the groups flow down three columns, each group kept whole. */
function SingleCompany({ groups, currency }: { groups: StatGroup[]; currency: string }) {
  return <div className="stat-columns">
    {groups.map((group) => <section className="stat-group" key={group.title}>
      <ExplainedHeading title={group.title} note={group.note}/>
      <dl>{group.stats.map((stat) => <div className="stat-row" key={`${group.title}-${stat.label}`}>
        {/*
          * A missing value says why, in the open.
          *
          * The reason has always been computed — "Visa publishes no combined
          * share count", "cash flow at a broker moves with customer balances" —
          * and has always been hidden in a `title`, which a touch screen never
          * shows and a mouse shows after a second of hovering something that
          * looks like nothing. So a reader met a row of dashes and concluded
          * the application was broken. An explained gap is the product working.
          */}
        <dt title={stat.formula}>{stat.label}{stat.value == null && stat.reason && <small className="stat-reason">{stat.reason}</small>}</dt>
        <dd><StatValue stat={stat} currency={currency}/></dd>
      </div>)}</dl>
    </section>)}
  </div>;
}

/**
 * Several companies: the same rows, one column each.
 *
 * The row is the unit of comparison, so the layout transposes rather than
 * repeating a panel per company — reading five values of ROIC across a row is
 * the whole point, and five separate panels would make it a memory exercise.
 */
function Comparison({ columns }: { columns: Array<{ ticker: string; currency: string; groups: StatGroup[] }> }) {
  const template = columns[0].groups;
  return <div className="stat-compare-scroll"><table className="stat-compare">
    <thead><tr><th scope="col">Metric</th>{columns.map((column) => <th scope="col" key={column.ticker}>{column.ticker}</th>)}</tr></thead>
    {template.map((group, groupIndex) => <tbody key={group.title}>
      <tr className="stat-compare-group"><th scope="colgroup" colSpan={columns.length + 1}>{group.title}</th></tr>
      {group.stats.map((stat, statIndex) => {
        const cells = columns.map((column) => ({ ticker: column.ticker, currency: column.currency, stat: column.groups[groupIndex].stats[statIndex] }));
        const winners = bestIn(cells.map((cell) => ({ ticker: cell.ticker, value: cell.stat.value })), stat.polarity);
        return <tr key={stat.label}>
          <th scope="row" title={stat.formula}>{stat.label}</th>
          {cells.map((cell) => <td key={cell.ticker}><StatValue stat={cell.stat} currency={cell.currency} highlight={winners.has(cell.ticker)}/></td>)}
        </tr>;
      })}
    </tbody>)}
  </table></div>;
}

/**
 * The headline statistics panel, for one company or for several side by side.
 *
 * The same computation feeds both shapes, so a figure can never disagree with
 * itself between the company page and the comparison.
 */
export function CompanyStatistics({ datasets, prices, periodicity = "ttm" }: { datasets: CompanyDataset[]; prices: Record<string, PricePoint | null>; periodicity?: StatisticsPeriodicity }) {
  const columns = useMemo(() => datasets.map((dataset) => ({
    ticker: dataset.company.ticker,
    currency: dataset.company.currency,
    groups: companyStatistics(dataset, prices[dataset.company.ticker] ?? null, periodicity),
  })), [datasets, periodicity, prices]);

  if (!columns.length) return <p className="simple-state">Pick at least one company to see its statistics.</p>;

  return <div className="stat-panel">
    {columns.length === 1
      ? <SingleCompany groups={columns[0].groups} currency={columns[0].currency}/>
      : <Comparison columns={columns}/>}
    {/* Why the forward half of a conventional panel is absent: worth saying,
        not worth a paragraph under every reader's first look. */}
    <p className="stat-footnote">No forward estimates <Explainer label="why">{FORWARD_NOTE}</Explainer></p>
  </div>;
}
