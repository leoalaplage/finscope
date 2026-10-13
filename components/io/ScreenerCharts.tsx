"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { QS_METRIC_NAMES, QS_METRICS, QS_PILLARS, QS_STARS, valuationStars, type PillarName, type ScoredCompany } from "@/lib/qs/screener";
import {
  businessScore, gradeCounts, gradeRank, measureValue, median, pillarMedians, sectorOf, sectorScores,
} from "@/lib/qs/screener-views";
import { useWidth } from "@/components/term/use-width";
import { ABSENT, money } from "./format";

/**
 * The screener drawn, not only tabulated (components/io/Screener.tsx).
 *
 * Four readings over the same scored rows: the list at a glance, where each
 * company sits between what it is and what it costs, how its sectors compare,
 * and — for the company a reader picks — every measure behind its letter.
 * Nothing here scores; the engine already has.
 */

/** A letter's colour: green at the top of the scale to red at the bottom, the site's two tones. */
export function gradeTone(grade: string): CSSProperties {
  const rank = gradeRank(grade);
  if (rank == null) return { "--grade": "var(--ink-3)" } as CSSProperties;
  return { "--grade": `color-mix(in srgb, var(--gain) ${Math.round((1 - rank) * 100)}%, var(--loss))` } as CSSProperties;
}

export function GradeBadge({ grade }: { grade: string }) {
  return <span className="qs-grade" data-unrated={grade === "NR" || undefined} style={gradeTone(grade)}>{grade}</span>;
}

/* --- The list at a glance ------------------------------------------------ */

export function ScreenerOverview({ rows, onGrade, grades }: { rows: ScoredCompany[]; onGrade: (grade: string) => void; grades: string[] }) {
  const counts = gradeCounts(rows);
  const rated = rows.filter((row) => row.note !== "NR");
  const centre = median(rows.map((row) => row.total));
  const sweet = rows.filter((row) => row.sweet_spot).length;
  const flagged = rows.filter((row) => row.alertes > 0).length;
  const tallest = Math.max(1, ...counts.map((entry) => entry.count));
  return (
    <div className="qs-overview">
      <div className="qs-tiles">
        <div className="qs-tile">
          <span className="label">Median score</span>
          <b className="num">{centre == null ? ABSENT : centre.toFixed(1)}</b>
          <span className="stat-note">{rated.length} of {rows.length} graded</span>
        </div>
        <div className="qs-tile">
          <span className="label">Quality at a fair price</span>
          <b className="num">{sweet}</b>
          <span className="stat-note">Strong business, price not stretched</span>
        </div>
        <div className="qs-tile">
          <span className="label">With an alert</span>
          <b className="num">{flagged}</b>
          <span className="stat-note">A reading an analyst would question</span>
        </div>
      </div>
      <div className="qs-grades" role="group" aria-label="Companies by grade — press a grade to filter the table">
        {counts.map(({ grade, count }) => (
          <button key={grade} type="button" className="qs-grade-bar" aria-pressed={grades.includes(grade)} disabled={!count}
            onClick={() => onGrade(grade)} title={`${count} graded ${grade}`} style={gradeTone(grade)}>
            <span className="qs-grade-count num">{count || ""}</span>
            <span className="qs-grade-fill" style={{ height: `${(count / tallest) * 100}%` }} />
            <span className="qs-grade-name">{grade}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* --- What it is against what it costs ----------------------------------- */

const MAP_HEIGHT = 420;
const PAD = { top: 18, right: 18, bottom: 38, left: 44 };

/**
 * Each company placed by its business (Quality, Health, Growth) up the page
 * and by its price (the Value pillar) across it, its area its market
 * capitalisation and its colour its letter. The two medians of the list cut
 * the plane in four, so a corner reads as a sentence: top right is a strong
 * business the market is not asking much for.
 */
export function QualityValueMap({ rows, weights, selected, onSelect }: {
  rows: ScoredCompany[]; weights: Record<PillarName, number>; selected: string | null; onSelect: (ticker: string) => void;
}) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<string | null>(null);
  // A phone: a shorter plane, and corners named in two words so they do not run into each other.
  const narrow = width > 0 && width < 560;
  const height = narrow ? 340 : MAP_HEIGHT;
  const points = useMemo(() => rows.flatMap((row) => {
    const business = businessScore(row, weights);
    const value = row.piliers.Value;
    return business == null || value == null ? [] : [{ row, x: value, y: business }];
  }), [rows, weights]);

  if (!points.length) return <p className="stat-note">No company carries both a business score and a value score yet.</p>;

  const span = (values: number[]) => {
    const low = Math.max(0, Math.floor(Math.min(...values) / 10) * 10 - 5);
    const high = Math.min(100, Math.ceil(Math.max(...values) / 10) * 10 + 5);
    return high - low < 30 ? { low: Math.max(0, low - 10), high: Math.min(100, high + 10) } : { low, high };
  };
  const xs = span(points.map((point) => point.x));
  const ys = span(points.map((point) => point.y));
  const midX = median(points.map((point) => point.x))!;
  const midY = median(points.map((point) => point.y))!;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const px = (value: number) => PAD.left + ((value - xs.low) / (xs.high - xs.low)) * plotW;
  const py = (value: number) => PAD.top + (1 - (value - ys.low) / (ys.high - ys.low)) * plotH;
  const largest = Math.max(1, ...points.map((point) => point.row.Cap ?? 0));
  const radius = (cap: number | null) => (cap != null && cap > 0 ? 4 + 20 * Math.sqrt(cap / largest) : 4);
  // Names only where they help: the picked company, the best of the list, the sweet spots.
  const named = new Set([
    ...(selected ? [selected] : []), ...(hover ? [hover] : []),
    ...[...points].sort((left, right) => (right.row.total ?? 0) - (left.row.total ?? 0)).slice(0, narrow ? 4 : 8).map((point) => point.row.Ticker),
    ...points.filter((point) => point.row.sweet_spot).slice(0, 6).map((point) => point.row.Ticker),
  ]);
  const ticks = (range: { low: number; high: number }) => Array.from({ length: 11 }, (_, index) => index * 10).filter((tick) => tick >= range.low && tick <= range.high);
  const shown = points.find((point) => point.row.Ticker === (hover ?? selected));

  return (
    <div className="qs-map" ref={ref} style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} role="group" aria-label="Companies by business score and value score">
          {ticks(xs).map((tick) => <line key={`x${tick}`} className="qs-map-rule" x1={px(tick)} x2={px(tick)} y1={PAD.top} y2={PAD.top + plotH} />)}
          {ticks(ys).map((tick) => <line key={`y${tick}`} className="qs-map-rule" x1={PAD.left} x2={PAD.left + plotW} y1={py(tick)} y2={py(tick)} />)}
          {ticks(xs).map((tick) => <text key={`xt${tick}`} className="qs-map-tick" x={px(tick)} y={height - 22} textAnchor="middle">{tick}</text>)}
          {ticks(ys).map((tick) => <text key={`yt${tick}`} className="qs-map-tick" x={PAD.left - 8} y={py(tick) + 3.5} textAnchor="end">{tick}</text>)}
          <line className="qs-map-median" x1={px(midX)} x2={px(midX)} y1={PAD.top} y2={PAD.top + plotH} />
          <line className="qs-map-median" x1={PAD.left} x2={PAD.left + plotW} y1={py(midY)} y2={py(midY)} />
          <text className="qs-map-corner" x={PAD.left + plotW - 6} y={PAD.top + 14} textAnchor="end">{narrow ? "Strong · cheap" : "Strong business · undemanding price"}</text>
          <text className="qs-map-corner" x={PAD.left + 6} y={PAD.top + 14}>{narrow ? "Strong · dear" : "Strong business · priced for it"}</text>
          <text className="qs-map-corner" x={PAD.left + plotW - 6} y={PAD.top + plotH - 8} textAnchor="end">{narrow ? "Weaker · cheap" : "Cheap, perhaps for a reason"}</text>
          <text className="qs-map-corner" x={PAD.left + 6} y={PAD.top + plotH - 8}>{narrow ? "Weaker · dear" : "Weaker and dear"}</text>
          <text className="qs-map-axis" x={PAD.left + plotW / 2} y={height - 4} textAnchor="middle">Value score — cheaper to the right →</text>
          <text className="qs-map-axis" transform={`translate(12 ${PAD.top + plotH / 2}) rotate(-90)`} textAnchor="middle">Business score ↑</text>
          {[...points].sort((left, right) => (right.row.Cap ?? 0) - (left.row.Cap ?? 0)).map(({ row, x, y }) => (
            <g key={row.Ticker} className="qs-map-point" data-selected={row.Ticker === selected || undefined} style={gradeTone(row.note)}
              tabIndex={0} role="button" aria-label={`${row.Ticker}, grade ${row.note}, business ${y.toFixed(0)}, value ${x.toFixed(0)}`}
              onMouseEnter={() => setHover(row.Ticker)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(row.Ticker)} onBlur={() => setHover(null)}
              onClick={() => onSelect(row.Ticker)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.Ticker); } }}>
              <circle cx={px(x)} cy={py(y)} r={radius(row.Cap)} />
              {named.has(row.Ticker) ? <text x={px(x)} y={py(y) - radius(row.Cap) - 4} textAnchor="middle">{row.Ticker}</text> : null}
            </g>
          ))}
        </svg>
      ) : null}
      {shown ? (
        <div className="qs-map-tip" style={{ left: Math.min(Math.max(px(shown.x) + 12, 8), Math.max(8, width - 220)), top: Math.max(8, py(shown.y) - 40) }}>
          <b>{shown.row.Ticker}</b> <GradeBadge grade={shown.row.note} />
          <span>{sectorOf(shown.row)}</span>
          <span>Score {shown.row.total == null ? ABSENT : shown.row.total.toFixed(1)} · business {shown.y.toFixed(0)} · value {shown.x.toFixed(0)}</span>
          {shown.row.Cap != null ? <span>Market cap {money(shown.row.Cap * 1e9, "USD")}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/* --- Sectors ------------------------------------------------------------- */

export function SectorScores({ rows, sector, onSector }: { rows: ScoredCompany[]; sector: string | null; onSector: (sector: string | null) => void }) {
  const sectors = sectorScores(rows);
  if (!sectors.length) return null;
  return (
    <div className="qs-sectors" role="group" aria-label="Median score by sector — press a sector to filter the table">
      {sectors.map((entry) => (
        <button key={entry.sector} type="button" className="qs-sector" aria-pressed={sector === entry.sector}
          onClick={() => onSector(sector === entry.sector ? null : entry.sector)}>
          <span className="qs-sector-name">{entry.sector}</span>
          <span className="qs-sector-track"><span style={{ width: `${Math.max(2, Math.min(100, entry.median))}%` }} /></span>
          <span className="qs-sector-value num">{entry.median.toFixed(0)}</span>
          <span className="qs-sector-count">{entry.count} · best {entry.best}</span>
        </button>
      ))}
    </div>
  );
}

/* --- One company, every measure ----------------------------------------- */

export function CompanyCard({ row, rows, onClose }: { row: ScoredCompany; rows: ScoredCompany[]; onClose: () => void }) {
  const medians = pillarMedians(rows);
  const stars = valuationStars(row.piliers.Value);
  const name = (key: string) => QS_METRIC_NAMES[key] ?? key;
  return (
    <aside className="qs-card" aria-label={`${row.Ticker}: how its grade is made`}>
      <header className="qs-card-head">
        <div>
          <h3><a href={`/s/${encodeURIComponent(row.Ticker)}`}>{row.Ticker}</a></h3>
          <span className="stat-note">{sectorOf(row)}{row.Cap != null ? ` · ${money(row.Cap * 1e9, "USD")}` : ""}{row.rang_secteur && row.taille_secteur ? ` · ${row.rang_secteur} of ${row.taille_secteur} in its sector` : ""}</span>
        </div>
        <div className="qs-card-grade">
          <GradeBadge grade={row.note} />
          <b className="num">{row.total == null ? ABSENT : row.total.toFixed(1)}</b>
        </div>
        <button type="button" className="metric-toggle" onClick={onClose} aria-label="Close the company card">Close</button>
      </header>

      <div className="qs-card-pillars">
        {QS_PILLARS.map((pillar) => {
          const value = row.piliers[pillar];
          const centre = medians[pillar];
          return (
            <div key={pillar} className="qs-pillar">
              <span className="label">{pillar}</span>
              <span className="qs-pillar-track" title={centre == null ? undefined : `List median ${centre.toFixed(0)}`}>
                {value != null ? <span className="qs-pillar-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /> : null}
                {centre != null ? <i style={{ left: `${Math.max(0, Math.min(100, centre))}%` }} /> : null}
              </span>
              <span className="num">{value == null ? ABSENT : value.toFixed(0)}</span>
            </div>
          );
        })}
        <p className="stat-note">The tick on each bar is this list&apos;s median.{stars != null ? ` Valuation: ${"★".repeat(stars)}${"☆".repeat(QS_STARS - stars)} — ${row.valuation}.` : ""}</p>
      </div>

      {row.forces.length || row.faiblesses.length || row.alertes_detail.length ? (
        <div className="qs-card-notes">
          {row.forces.length ? <div><span className="label">Strengths</span><ul>{row.forces.map(([key, score]) => <li key={key} data-tone="good">{name(key)} <span className="num">{score.toFixed(0)}</span></li>)}</ul></div> : null}
          {row.faiblesses.length ? <div><span className="label">Weaknesses</span><ul>{row.faiblesses.map(([key, score]) => <li key={key} data-tone="bad">{name(key)} <span className="num">{score.toFixed(0)}</span></li>)}</ul></div> : null}
          {row.alertes_detail.length ? <div><span className="label">Alerts</span><ul>{row.alertes_detail.map((alert) => <li key={alert} data-tone="bad">{alert}</li>)}</ul></div> : null}
        </div>
      ) : null}

      <div className="qs-card-measures">
        {QS_PILLARS.map((pillar) => (
          <section key={pillar}>
            <h4 className="label">{pillar}</h4>
            {QS_METRICS.filter((metric) => metric.pilier === pillar).map((metric) => {
              const score = row.score_metrique[metric.cle];
              return (
                <div key={metric.cle} className="qs-measure" data-empty={score == null || undefined}>
                  <span className="qs-measure-name">{name(metric.cle)}</span>
                  <span className="qs-measure-raw num">{measureValue(metric.cle, row.brut[metric.cle], ABSENT)}</span>
                  <span className="qs-measure-track"><span style={{ width: `${score == null ? 0 : Math.max(0, Math.min(100, score))}%` }} /></span>
                  <span className="qs-measure-score num">{score == null ? ABSENT : score.toFixed(0)}</span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <a className="label head-compare" href={`/s/${encodeURIComponent(row.Ticker)}`}>Open {row.Ticker} →</a>
    </aside>
  );
}
