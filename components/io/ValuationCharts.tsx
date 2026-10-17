"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import type { IoQuote } from "./quote";
import type { ChartData, Preset } from "@/lib/term/fundamental-charts";
import { MULTIPLES, monthEnds, multipleSeries, multipleStats, type MultipleKey, type MultiplePoint, type PricedDate } from "@/lib/io/valuation-multiples";
import { ComboChart } from "@/components/term/FundamentalCharts";
import { ABSENT } from "./format";

/**
 * The company's multiples through time (lib/io/valuation-multiples.ts): P/E,
 * P/FCF, EV/FCF, EV/EBITDA and the rest, one chart each, month by month over
 * the decade and today at the live quote, against their own median and one
 * standard deviation either side — where the stock has usually traded, and
 * where it trades now.
 */

const WINDOWS = [{ id: "5Y", years: 5 }, { id: "10Y", years: 10 }] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(2, 4)}`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

interface PriceAnswer { key: string; prices: PricedDate[] | null }

export function ValuationCharts({ view, quote }: { view: IoCompanyView; quote: IoQuote | null }) {
  const ticker = view.company.ticker;
  const today = new Date().toISOString().slice(0, 10);
  const dates = useMemo(() => monthEnds(today), [today]);
  const key = `${ticker}|${dates[0]}`;
  const [answer, setAnswer] = useState<PriceAnswer | null>(null);
  const [span, setSpan] = useState<(typeof WINDOWS)[number]["id"]>("5Y");
  const [wide, setWide] = useState<MultipleKey | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/prices/${encodeURIComponent(ticker)}?dates=${encodeURIComponent(dates.join(","))}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ points?: Array<{ requestedDate: string; point?: { priceClose?: number; close?: number; date: string; currency?: string } | null }> }> : null))
      .then((body) => {
        if (controller.signal.aborted) return;
        const prices = (body?.points ?? []).flatMap((item) => {
          const price = item.point?.priceClose ?? item.point?.close;
          return price != null && item.point ? [{ date: item.point.date, price, currency: item.point.currency ?? null }] : [];
        });
        setAnswer({ key, prices: body ? prices : null });
      })
      .catch(() => { if (!controller.signal.aborted) setAnswer({ key, prices: null }); });
    return () => controller.abort();
  }, [key, ticker, dates]);

  const current = answer?.key === key ? answer : null;
  const points = useMemo<MultiplePoint[]>(() => {
    if (!current?.prices) return [];
    const live = quote?.price != null ? [{ date: today, price: quote.price, currency: quote.currency ?? null }] : [];
    return multipleSeries(view.trailing, [...current.prices, ...live]);
  }, [current, quote, view.trailing, today]);
  const from = useMemo(() => {
    const cutoff = new Date(`${today}T00:00:00Z`);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - (WINDOWS.find((entry) => entry.id === span)?.years ?? 10));
    return cutoff.toISOString().slice(0, 10);
  }, [today, span]);
  const shown = points.filter((point) => point.date >= from);

  if (!current) return <section className="section valuation-charts"><p className="stat-note">Pricing ten years of month-ends against the figures public on each…</p></section>;
  if (!current.prices) return <section className="section valuation-charts"><p className="stat-note">The price history is temporarily unavailable.</p></section>;

  const charts = MULTIPLES.flatMap((spec) => {
    const values = shown.map((point) => point.values[spec.key] ?? null);
    if (values.filter((value) => value != null).length < 6) return [];
    const stats = multipleStats(shown, spec.key);
    const flat = (value: number | null) => values.map(() => value);
    const data: ChartData = {
      labels: shown.map((point) => short(point.date)),
      names: shown.map((point) => (point.date === today ? `Today · ${point.periodLabel}` : `${point.date} · ${point.periodLabel}`)),
      series: [
        { spec: { id: spec.key, label: spec.short, kind: "line", axis: "left", color: "var(--c1)", value: () => null }, values },
        { spec: { id: "median", label: `${span} median`, kind: "line", axis: "left", color: "var(--c5)", value: () => null }, values: flat(stats.median) },
        ...(stats.mean != null && stats.deviation != null ? [
          { spec: { id: "plus", label: "+1σ", kind: "line" as const, axis: "left" as const, color: "var(--ink-3)", value: () => null }, values: flat(stats.mean + stats.deviation) },
          { spec: { id: "minus", label: "−1σ", kind: "line" as const, axis: "left" as const, color: "var(--ink-3)", value: () => null }, values: flat(Math.max(spec.percent ? -Infinity : 0, stats.mean - stats.deviation)) },
        ] : []),
      ],
    };
    const preset: Preset = { id: `val-${spec.key}`, title: spec.label, left: spec.percent ? "percent" : "ratio", series: data.series.map((entry) => entry.spec), note: spec.formula };
    return [{ spec, stats, data, preset }];
  });

  const write = (value: number | null, percent: boolean) => (value == null ? ABSENT : percent ? `${(value * 100).toFixed(2)}%` : `${value.toFixed(1)}×`);

  return (
    <section className="section valuation-charts" aria-label="Valuation multiples through time">
      <div className="t-gf-bar">
        <div className="seg" role="group" aria-label="Window">
          {WINDOWS.map((entry) => <button key={entry.id} type="button" aria-pressed={span === entry.id} onClick={() => setSpan(entry.id)}>{entry.id}</button>)}
        </div>
        <span className="t-dim">{charts.length} multiples · month-ends and today, on the trailing figures public each day · hover for the period priced</span>
      </div>
      {charts.length ? (
        <div className="t-gf-grid">
          {charts.map(({ spec, stats, data, preset }) => (
            <figure key={spec.key} className="t-gf-card" data-wide={wide === spec.key || undefined}>
              <figcaption>
                <h3>{spec.label}</h3>
                <span className="valuation-now">
                  <b>{write(stats.current, spec.percent)}</b>
                  <span className="t-dim"> · median {write(stats.median, spec.percent)}</span>
                  {stats.percentile != null ? <span className="valuation-pct" data-high={stats.percentile >= 0.8 || undefined} data-low={stats.percentile <= 0.2 || undefined}> · {ordinal(Math.round(stats.percentile * 100))} pct</span> : null}
                </span>
                <button type="button" className="t-chip" aria-pressed={wide === spec.key} aria-label={wide === spec.key ? `Shrink ${spec.label}` : `Enlarge ${spec.label}`}
                  onClick={() => setWide(wide === spec.key ? null : spec.key)}>{wide === spec.key ? "−" : "+"}</button>
              </figcaption>
              <ComboChart preset={preset} data={data} currency={view.company.currency} height={wide === spec.key ? 360 : 200} />
              <ul className="t-gf-legend">
                {data.series.map((entry) => (
                  <li key={entry.spec.id} data-kind="line" style={{ "--key": entry.spec.color } as CSSProperties}><i aria-hidden="true" />{entry.spec.label}</li>
                ))}
              </ul>
              <p className="t-gf-note">{spec.formula}. Percentile: where today sits among the {span} of month-ends.</p>
            </figure>
          ))}
        </div>
      ) : <p className="t-empty">Too few priced periods to chart this company&apos;s multiples.</p>}
    </section>
  );
}
