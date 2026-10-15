"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { EtfProfile } from "@/lib/adapters/etf";
import { KEY_VERSION, SUMMARY_SHAPE } from "@/lib/data-version";
import { qsTable, qsValuationColumns, type QsPriceInputs, type QsRow } from "@/lib/qs-export";
import { QS_GRADES, QS_PILLARS, screen, type ScoredCompany } from "@/lib/qs/screener";
import {
  effectiveHoldings, fundScore, portfolioQuality, riskReturn,
  type PortfolioQuality, type RiskReturn, type ScoredHolding, type WeeklyBar,
} from "@/lib/io/fund-analytics";
import { useHoverIndex, useWidth } from "@/components/term/use-width";
import { GradeBadge, gradeTone } from "./ScreenerCharts";
import { ABSENT, shortDate } from "./format";

/**
 * The analysis on a fund's page (components/io/Etf.tsx): FinScope's own score
 * for it, the companies it holds read through this site's Quality Score, its
 * risk and return against the S&P 500, and a map of its largest positions.
 */

const pct = (value: number | null | undefined, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${(value * 100).toFixed(places)}%`);
const signed = (value: number | null | undefined, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(places)}%`);
const tone = (value: number | null | undefined) => (value == null ? undefined : value >= 0 ? "up" : "down");
const times = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? ABSENT : `${value.toFixed(1)}×`);

interface UniverseAnswer {
  rows?: Array<{ ticker: string; qs: Record<string, number | string | null>; qsPrice: QsPriceInputs }>;
  prices?: Record<string, { price: number | null; currency: string | null }>;
}

/** Every company this site scores, scored once, with what a price needs. */
function useScoredUniverse() {
  const [answer, setAnswer] = useState<{ scored: Map<string, ScoredCompany>; raw: Map<string, { qs: Record<string, number | string | null>; qsPrice: QsPriceInputs; price: number | null }> } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/universe?v=${KEY_VERSION}.${SUMMARY_SHAPE}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<UniverseAnswer> : null))
      .then((body) => {
        if (!body?.rows?.length || controller.signal.aborted) return;
        const rows: QsRow[] = body.rows.map((item) => {
          const quote = body.prices?.[item.ticker];
          return { ticker: item.ticker, values: { ...item.qs, ...qsValuationColumns(item.qsPrice, quote?.price ?? null, quote?.currency) } };
        });
        const result = screen(qsTable(rows), { modele: "finscope" });
        setAnswer({
          scored: new Map(result.all.map((company) => [company.Ticker.toUpperCase(), company])),
          raw: new Map(body.rows.map((item) => [item.ticker, { qs: item.qs, qsPrice: item.qsPrice, price: body.prices?.[item.ticker]?.price ?? null }])),
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return answer;
}

/** Five years of weekly prices, with and without distributions. */
function useWeekly(symbol: string) {
  const [bars, setBars] = useState<{ symbol: string; bars: WeeklyBar[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const end = new Date(); const start = new Date(end); start.setUTCFullYear(start.getUTCFullYear() - 5);
    fetch(`/api/market/${encodeURIComponent(symbol)}?frequency=weekly&start=${start.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ bars?: Array<{ date: string; close: number | null; adjustedClose: number | null }> }> : null))
      .then((body) => {
        if (controller.signal.aborted) return;
        setBars({ symbol, bars: (body?.bars ?? []).flatMap((bar) => (bar.close != null ? [{ date: bar.date, close: bar.close, adjustedClose: bar.adjustedClose ?? bar.close }] : [])) });
      })
      .catch(() => { if (!controller.signal.aborted) setBars({ symbol, bars: [] }); });
    return () => controller.abort();
  }, [symbol]);
  return bars?.symbol === symbol ? bars.bars : null;
}

function useCash(): number | null {
  const [cash, setCash] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/macro", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ indicators?: Array<{ id: string; value: number | null }> }> : null))
      .then((body) => { const value = body?.indicators?.find((item) => item.id === "treasury-3m")?.value; if (value != null) setCash(value / 100); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return cash;
}

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Everything the fund page computes, once: the score, risk and return, and the holdings read as companies. */
export function useFundAnalytics(fund: EtfProfile) {
  const universe = useScoredUniverse();
  const weekly = useWeekly(fund.ticker);
  const benchmark = useWeekly("SPY");
  const cash = useCash();
  const holdings = useMemo(() => fund.portfolio?.holdings ?? [], [fund]);

  const scoredHoldings = useMemo<ScoredHolding[]>(() => holdings.map((holding) => {
    const key = holding.ticker?.replace(/[/-]/g, ".") ?? "";
    const company = universe?.scored.get(key) ?? null;
    const raw = universe?.raw.get(key) ?? null;
    const cap = raw?.price != null && raw.qsPrice?.shares ? raw.price * raw.qsPrice.shares : null;
    const ev = cap != null && raw?.qsPrice?.netDebt != null ? cap + raw.qsPrice.netDebt : null;
    return {
      weight: holding.weight,
      total: company?.total ?? null,
      grade: company && company.note !== "NR" ? company.note : null,
      pillars: company ? company.piliers : {},
      // The screener's columns write a percentage out of a hundred.
      roic: raw && number(raw.qs.ROIC) != null ? number(raw.qs.ROIC)! / 100 : null,
      operatingMargin: raw && number(raw.qs["Operating Margin"]) != null ? number(raw.qs["Operating Margin"])! / 100 : null,
      revenueGrowth: raw && number(raw.qs["Revenue 5Y CAGR"]) != null ? number(raw.qs["Revenue 5Y CAGR"])! / 100 : null,
      fcfYield: cap && raw?.qsPrice?.freeCashFlow != null ? raw.qsPrice.freeCashFlow / cap : null,
      earningsYield: ev && ev > 0 && raw?.qsPrice?.operatingIncome != null ? raw.qsPrice.operatingIncome / ev : null,
      marketCap: cap,
    };
  }), [holdings, universe]);
  const quality = useMemo(() => (universe ? portfolioQuality(scoredHoldings, QS_PILLARS, QS_GRADES) : null), [universe, scoredHoldings]);
  const risk = useMemo(() => (weekly && benchmark ? riskReturn(weekly, benchmark, cash) : null), [weekly, benchmark, cash]);
  const benchmarkRisk = useMemo(() => (benchmark ? riskReturn(benchmark, benchmark, cash) : null), [benchmark, cash]);
  const tracking = useMemo(() => {
    const average = fund.prospectus?.returns.average.filter((entry) => entry.fund != null && entry.index != null) ?? [];
    const longest = average.at(-1);
    return longest ? longest.fund! - longest.index! : null;
  }, [fund]);
  const score = useMemo(() => fundScore({
    expenseRatio: fund.prospectus?.expenseRatio ?? fund.commodity?.expenseRatio ?? null,
    holdingsQuality: quality?.total ?? null,
    qualityCoverage: quality?.coverage ?? 0,
    effectiveHoldings: holdings.length ? effectiveHoldings(holdings.map((holding) => holding.weight)) : fund.commodity ? 1 : null,
    trackingDifference: tracking,
    netAssets: fund.history.at(-1)?.netAssets ?? fund.portfolio?.netAssets ?? fund.commodity?.netAssets ?? null,
  }), [fund, quality, holdings, tracking]);
  return { score, risk, benchmarkRisk, quality, scored: universe?.scored ?? null, weekly, benchmark };
}

export function FundScoreBody({ score }: { score: ReturnType<typeof fundScore> }) {
  return (
    <>
      <div className="etf-score">
        <div className="etf-score-total">
          <b className="num">{score.score == null ? ABSENT : score.score.toFixed(0)}</b>
          <span className="stars" aria-label={score.stars == null ? "Not rated" : `${score.stars} of 5`}>
            {Array.from({ length: 5 }, (_, index) => <span key={index} data-lit={score.stars != null && index < score.stars}>★</span>)}
          </span>
          <span className="stat-note">out of 100</span>
        </div>
        <div className="etf-score-pillars">
          {score.pillars.map((pillar) => (
            <div key={pillar.name} className="qs-pillar" data-empty={pillar.score == null || undefined}>
              <span className="label">{pillar.name} <small>{pillar.weight}%</small></span>
              <span className="qs-pillar-track">{pillar.score != null ? <span className="qs-pillar-fill" style={{ width: `${pillar.score}%` }} /> : null}</span>
              <span className="num">{pillar.score == null ? ABSENT : pillar.score.toFixed(0)}</span>
              <span className="etf-score-reading">{pillar.reading}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="stat-note">Five readings from the fund&apos;s filings and prices, each on a fixed scale — not Morningstar&apos;s rating, which is licensed and not published freely.</p>
    </>
  );
}

export function RiskBody({ risk, benchmark }: { risk: RiskReturn; benchmark: RiskReturn | null }) {
  const { ref, width } = useWidth();
  const height = 160;
  const points = risk.drawdown;
  const floor = Math.min(-0.05, ...points.map((point) => point.value));
  const px = (index: number) => (index / Math.max(points.length - 1, 1)) * width;
  const py = (value: number) => (value / floor) * (height - 18);
  const path = width > 0 && points.length > 1
    ? points.map((point, index) => `${index ? "L" : "M"}${px(index).toFixed(1)} ${py(point.value).toFixed(1)}`).join("")
    : "";
  const { hover, pick, leave } = useHoverIndex(points.length);
  const shown = points[hover ?? points.length - 1];
  const rows: Array<[string, number | null, number | null, number | null]> = [
    ["Total return", risk.total.y1, risk.total.y3, risk.total.y5],
    ["Price return", risk.price.y1, risk.price.y3, risk.price.y5],
    ...(benchmark ? [["S&P 500 (SPY) total", benchmark.total.y1, benchmark.total.y3, benchmark.total.y5] as [string, number | null, number | null, number | null]] : []),
  ];
  const figures: Array<[string, string, string | undefined, string?]> = [
    ["Volatility", pct(risk.volatility), benchmark ? `S&P 500 ${pct(benchmark.volatility)}` : undefined],
    ["Worst fall", signed(risk.maxDrawdown?.value), risk.maxDrawdown ? `${shortDate(risk.maxDrawdown.peak)} to ${shortDate(risk.maxDrawdown.trough)}` : undefined, tone(risk.maxDrawdown?.value)],
    ["Beta to the S&P 500", risk.beta == null ? ABSENT : risk.beta.toFixed(2), risk.correlation == null ? undefined : `Correlation ${risk.correlation.toFixed(2)}`],
    ["Sharpe ratio", risk.sharpe == null ? ABSENT : risk.sharpe.toFixed(2), "Return over cash per unit of volatility"],
    ["Distributions · 1Y", signed(risk.distributions), "Total return less price return"],
  ];
  return (
    <>
      <div className="grid-ruled stats etf-risk-stats">
        {figures.map(([label, value, note, dir]) => (
          <div className="stat" key={label}>
            <div className="label">{label}</div>
            <div className="stat-value num" data-dir={dir}>{value}</div>
            {note ? <div className="stat-note">{note}</div> : null}
          </div>
        ))}
      </div>
      <div className="etf-risk-body">
        <div className="sheet etf-average">
          <table>
            <thead><tr><th className="key">A year</th><th>1 year</th><th>3 years</th><th>5 years</th></tr></thead>
            <tbody>
              {rows.map(([label, ...values]) => (
                <tr key={label}><th className="key" scope="row">{label}</th>{values.map((value, index) => <td key={index} data-dir={tone(value)}>{signed(value)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <figure className="etf-drawdown" ref={ref}>
          <figcaption className="etf-readout">
            <span className="label">Below its last peak</span>
            {shown ? <><span className="t-dim">{shortDate(shown.date)}</span><b data-dir={shown.value < 0 ? "down" : undefined}>{signed(shown.value)}</b></> : null}
          </figcaption>
          {path ? (
            <svg width={width} height={height} role="img" aria-label={`Drawdown from the last peak; worst ${signed(risk.maxDrawdown?.value)}`}>
              <line x1={0} x2={width} y1={0.5} y2={0.5} className="etf-drawdown-zero" />
              <path d={`${path}L${width} 0L0 0Z`} className="etf-drawdown-area" />
              <path d={path} className="etf-drawdown-line" />
              <text x={width - 4} y={height - 4} textAnchor="end" className="etf-drawdown-tick">{signed(floor, 0)}</text>
              {hover != null && shown ? (
                <g className="etf-cursor">
                  <line x1={px(hover)} x2={px(hover)} y1={0} y2={height} />
                  <circle cx={px(hover)} cy={py(shown.value)} r={3} className="etf-cursor-loss" />
                </g>
              ) : null}
              <rect className="t-gf-catch" x={0} y={0} width={width} height={height} onPointerMove={pick} onPointerDown={pick} onPointerLeave={leave} />
            </svg>
          ) : null}
        </figure>
      </div>
      <p className="stat-note">Weekly, {risk.years.toFixed(1)} years to {shortDate(risk.asOf)}; the S&amp;P 500 is SPY, distributions reinvested.</p>
    </>
  );
}

export function QualityBody({ quality }: { quality: PortfolioQuality }) {
  const top = Math.max(0.0001, ...quality.grades.map((entry) => entry.weight));
  return (
    <>
      <p className="stat-note">The Quality Score and filed figures of the companies held, weighted by position — over {pct(quality.coverage, 0)} of the fund.</p>
      <div className="grid-ruled stats etf-risk-stats">
        <div className="stat"><div className="label">Quality Score</div><div className="stat-value num">{quality.total == null ? ABSENT : quality.total.toFixed(0)}</div><div className="stat-note">Weighted, out of 100</div></div>
        <div className="stat"><div className="label">ROIC</div><div className="stat-value num">{pct(quality.roic)}</div><div className="stat-note">Weighted</div></div>
        <div className="stat"><div className="label">Operating margin</div><div className="stat-value num">{pct(quality.operatingMargin)}</div></div>
        <div className="stat"><div className="label">Revenue growth · 5Y</div><div className="stat-value num">{pct(quality.revenueGrowth)}</div><div className="stat-note">A year</div></div>
        <div className="stat"><div className="label">Price / FCF</div><div className="stat-value num">{times(quality.priceToFcf)}</div><div className="stat-note">The fund&apos;s share of their cash</div></div>
        <div className="stat"><div className="label">EV / EBIT</div><div className="stat-value num">{times(quality.evToEbit)}</div></div>
      </div>
      <div className="etf-exposures">
        <section className="etf-exposure" aria-label="Weight by grade">
          <h3 className="label">Weight by grade</h3>
          {quality.grades.map((entry) => (
            <div key={entry.grade} className="etf-bar" style={{ ...gradeTone(entry.grade), "--bar": "var(--grade)" } as CSSProperties}>
              <span className="etf-bar-name"><GradeBadge grade={entry.grade} /></span>
              <span className="etf-bar-track"><span style={{ width: `${(entry.weight / top) * 100}%` }} /></span>
              <span className="etf-bar-value num">{pct(entry.weight)}</span>
            </div>
          ))}
        </section>
        <section className="etf-exposure" aria-label="Pillars">
          <h3 className="label">Pillars, weighted</h3>
          {QS_PILLARS.map((pillar) => (
            <div key={pillar} className="etf-bar">
              <span className="etf-bar-name">{pillar}</span>
              <span className="etf-bar-track"><span style={{ width: `${Math.max(0, Math.min(100, quality.pillars[pillar] ?? 0))}%` }} /></span>
              <span className="etf-bar-value num">{quality.pillars[pillar] == null ? ABSENT : quality.pillars[pillar]!.toFixed(0)}</span>
            </div>
          ))}
        </section>
        {quality.size.length ? (
          <section className="etf-exposure" aria-label="Company size">
            <h3 className="label">Company size</h3>
            {quality.size.map((band) => (
              <div key={band.label} className="etf-bar">
                <span className="etf-bar-name">{band.label}</span>
                <span className="etf-bar-track"><span style={{ width: `${band.weight * 100}%` }} /></span>
                <span className="etf-bar-value num">{pct(band.weight)}</span>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </>
  );
}
