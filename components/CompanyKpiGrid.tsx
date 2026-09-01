"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartValue, unitFamily } from "@/lib/auto-chart";
import { chartPalette, niceTicks, type ThemeName } from "@/lib/charting";
import { chartSurface, exportSvgToPng } from "@/lib/chart-export";
import { Skeleton } from "./Skeleton";
import { getJson } from "@/lib/fetch-json";
import { summariseSeries } from "@/lib/chart-summary";
import { derivedValue } from "@/lib/finance";
import { CHARTABLE_METRICS } from "@/lib/metrics";
import { candlesForPeriods, closeOn, freeCashFlowYieldOn, periodsWithin, type PeriodCandle } from "@/lib/overview-market";
import type { SeriesStyle } from "@/lib/chart-workspace";
import type { CompanyDataset, FinancialPeriod, MarketBar, SeriesFrequency } from "@/lib/types";

/**
 * One card per measure, in the order an analyst reads a company: what it sold,
 * what it kept, what it turned into cash, what that earned on capital, and what
 * any of it came to per share. `pair` puts two series on one card where they
 * only mean something together — cash against debt is a position, not two facts.
 */
const CARDS: Array<{ metric: string; title: string; pair?: string; pairTitle?: string; net?: string; kind?: "candles" | "market"; filed?: true }> = [
  { metric: "stockPrice", title: "Share price", kind: "candles" },
  { metric: "freeCashFlowYield", title: "FCF yield", kind: "market" },
  // `filed` marks a line the company states in its own income statement or
  // balance sheet. The rest are computed here from those lines, and the two
  // stop for entirely different reasons: a filer can stop reporting a subtotal,
  // where a calculation stops because one of its inputs did — which is not
  // something to describe as the company having stopped reporting it.
  { metric: "revenue", title: "Revenue", filed: true },
  { metric: "grossProfit", title: "Gross profit", filed: true },
  { metric: "operatingIncome", title: "Operating income", filed: true },
  { metric: "netIncome", title: "Net income", filed: true },
  { metric: "freeCashFlow", title: "Free cash flow" },
  { metric: "freeCashFlowAfterSbc", title: "Free cash flow after SBC" },
  { metric: "netIncomePerShare", title: "EPS" },
  { metric: "freeCashFlowPerShare", title: "FCF per share" },
  { metric: "cashReturnOnCapital", title: "Cash RoC" },
  { metric: "operatingMargin", title: "Operating margin" },
  { metric: "freeCashFlowMargin", title: "FCF margin" },
  { metric: "dilutedShares", title: "Diluted shares", filed: true },
  { metric: "cashAndEquivalents", title: "Cash & debt", pair: "totalDebt", pairTitle: "Total debt", net: "netDebt", filed: true },
];

/**
 * How far back the cards reach, in years of history rather than in periods.
 *
 * Four years is enough to see a trend and little enough to read sixteen bars;
 * ten is the span a compounder is judged over; Max is whatever the filings go
 * back to, about seventeen years for the companies here. Counting periods
 * instead would put a label on the wrong span: Apple's trailing series is
 * missing seven early quarters, so its fortieth period back is not ten years
 * ago but nearly twelve.
 */
const RANGES = [{ id: "4Y", years: 4 }, { id: "10Y", years: 10 }, { id: "Max", years: Infinity }] as const;
type RangeId = typeof RANGES[number]["id"];
const DEFAULT_RANGE: RangeId = "10Y";

/** "Q3 2022", from the fiscal quarter the period actually closes. */
function quarterLabel(period: FinancialPeriod) {
  return period.fiscalQuarter ? `${period.fiscalQuarter} ${period.fiscalYear}` : String(period.fiscalYear);
}

interface CardRow { label: string; date: string; value: number | null; pair: number | null; net: number | null; candle?: PeriodCandle | null; range?: [number, number] }

/**
 * A session's range as a wick with the open-to-close body inside it.
 *
 * The bar is drawn against low-to-high, so the pixels it occupies already carry
 * the scale: the body is placed by interpolating open and close inside that
 * span rather than by reaching for the axis, which a custom shape cannot see.
 */
function Candle({ x, y, width, height, payload, up, down }: { x?: number; y?: number; width?: number; height?: number; payload?: CardRow; up: string; down: string }) {
  const candle = payload?.candle;
  if (candle == null || x == null || y == null || width == null || height == null) return null;
  const span = candle.high - candle.low;
  const at = (value: number) => span <= 0 ? y : y + ((candle.high - value) / span) * height;
  const top = at(Math.max(candle.open, candle.close));
  const rising = candle.close >= candle.open;
  const colour = rising ? up : down;
  const bodyWidth = Math.max(1, Math.min(width, 14));
  const centre = x + width / 2;
  // Hollow up, solid down — the convention every trading screen uses, and the
  // reason it exists: green against red separates at delta-E 6.5 under
  // protanopia, which is a warning, not a pass. Filled against outlined is
  // legible without seeing either hue.
  return <g>
    <line x1={centre} x2={centre} y1={y} y2={y + height} stroke={colour} strokeWidth={1}/>
    <rect x={centre - bodyWidth / 2} y={top} width={bodyWidth} height={Math.max(1, at(Math.min(candle.open, candle.close)) - top)}
      fill={rising ? "var(--card)" : colour} stroke={colour} strokeWidth={1} rx={1}/>
  </g>;
}

function KpiCard({ card, rows, index, dataset, theme, onOpen }: {
  card: typeof CARDS[number];
  rows: CardRow[];
  index: number;
  dataset: CompanyDataset;
  theme: ThemeName;
  onOpen?: () => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const palette = chartPalette(theme);
  const family = unitFamily(card.metric);
  const candles = card.kind === "candles";

  /*
   * The span this card actually has figures for, rather than the page's.
   *
   * Every card was drawn across the whole window the reader chose, empty
   * columns included. Booking stopped tagging a gross-profit line after 2017 —
   * the SEC simply has nothing after that — so its card drew eight bars' worth
   * of history and then eight years of blank axis running out to 2026, under a
   * headline of "$12.4B" with no date on it. That reads as an application that
   * lost the data, not as a company that stopped reporting the line, and it is
   * the single most alarming thing a research tool can look like.
   *
   * So a card draws the range it has and says where that range ends. The page
   * header still states the window everything was asked for, which is what
   * makes the difference visible rather than hidden.
   */
  const has = (row: CardRow) => row.value != null || row.pair != null || row.candle != null;
  const firstKnown = rows.findIndex(has);
  const lastKnown = firstKnown < 0 ? -1 : rows.length - 1 - [...rows].reverse().findIndex(has);
  const drawn = firstKnown < 0 ? rows : rows.slice(firstKnown, lastKnown + 1);
  /** Whether the filings stop before the window the reader asked for. */
  const endsEarly = lastKnown >= 0 && lastKnown < rows.length - 1;

  const values = drawn.flatMap((row) => (candles ? [row.candle?.low, row.candle?.high] : [row.value, row.pair]).filter((value): value is number => value != null && Number.isFinite(value)));
  // A pair takes the two hues the balance-sheet diagram already uses for what
  // the company owns and what is claimed against it, rather than two palette
  // slots that fall wherever the card happens to sit in the grid.
  const colour = card.pair ? palette[0].value : palette[index % palette.length].value;
  const pairColour = card.pair ? palette[1].value : palette[(index + 4) % palette.length].value;
  // A price never starts at zero: a share that traded between $180 and $220
  // has all of its story in the top eighth of an axis anchored to the origin.
  // Every other measure is a quantity, where the origin is the comparison.
  const ticks = values.length
    ? niceTicks(candles ? Math.min(...values) : Math.min(0, ...values), candles ? Math.max(...values) : Math.max(0, ...values), 4)
    : [];
  const latest = [...drawn].reverse().find((row) => row.value != null);
  const latestPair = [...drawn].reverse().find((row) => row.pair != null);
  const format = (value: number) => formatChartValue(value, family, dataset.company.currency);
  // The badge summarises the drawn points, so it can never quote a window the
  // reader is not looking at.
  //
  // A pair gets no badge and no single headline. Two balances that are read
  // against each other have one number worth stating — the position between
  // them — and compounding either half describes neither: cash that fell while
  // debt fell faster is a company getting stronger, and one CAGR would call it
  // a company shrinking.
  const summary = card.pair ? null : summariseSeries(drawn.map((row) => ({ date: row.date, value: row.value })), card.metric);
  // A position needs both halves reported in the same period. Arista tags no
  // borrowings at all, and a card reading "Net cash $2.3B" beside "Total debt
  // —" states a figure it does not have; it falls back to the balance it does.
  const net = card.net ? [...drawn].reverse().find((row) => row.value != null && row.pair != null)?.net ?? null : null;
  const headline = card.pair
    ? net != null
      ? { label: net > 0 ? "Net debt" : "Net cash", display: format(Math.abs(net)) }
      : { label: "Latest", display: latest?.value == null ? "—" : format(latest.value) }
    : { label: summary?.label || (drawn[0] ? "Trailing" : ""), display: latest?.value == null ? "—" : format(latest.value) };
  // "Cash & debt" names the card, not the blue bars in it.
  const valueTitle = card.pair ? card.title.split(" & ")[0] : card.title;
  const chartable = CHARTABLE_METRICS.has(card.metric);

  function savePng(event: React.MouseEvent) {
    event.stopPropagation();
    const svg = chartSurface(canvas.current);
    if (!svg) return;
    exportSvgToPng(svg, `${dataset.company.ticker}-${card.metric}.png`, {
      title: `${dataset.company.ticker} · ${card.title}`,
      subtitle: net != null ? `${dataset.company.name} · ${headline.label} ${headline.display}`
        : summary?.value == null ? dataset.company.name : `${dataset.company.name} · ${summary.label} ${summary.display}`,
      footer: `FinScope · SEC filings to ${drawn.at(-1)?.label ?? ""}`,
    });
  }

  /*
   * The card states its span on its own axis and in one date beside the CAGR.
   *
   * It used to carry two sentences of explanation as well — "First reported
   * Q2 2010", "The filer stopped tagging this line…" — which is a paragraph of
   * apology under a chart that had already stopped where it stopped. A drawing
   * that ends in 2017 with "to Q4 2017" in its header has said it.
   */

  return <article className="kpi-card">
    <header>
      <div>
        <h3>{card.title}</h3>
        <small>{headline.label}{endsEarly && drawn.at(-1) ? ` · to ${drawn.at(-1)!.label}` : ""}</small>
      </div>
      <div className="kpi-card-actions">
        <strong>{headline.display}</strong>
        {summary?.value != null && <span className={`kpi-badge${summary.value >= 0 ? "" : " down"}`} title={summary.label}>{summary.display}</span>}
      </div>
    </header>
    {/* Two series on one card need a key. Every other card draws one measure
        and its title says which; this one drew two colours and left the reader
        to hover a bar to find out which was which. */}
    {card.pair && <ul className="kpi-legend">
      <li><i style={{ background: colour }}/>{valueTitle}<b>{latest?.value == null ? "—" : format(latest.value)}</b></li>
      <li><i style={{ background: pairColour }}/>{card.pairTitle}<b>{latestPair?.pair == null ? "—" : format(latestPair.pair)}</b></li>
    </ul>}
    <div className="kpi-canvas" ref={canvas}><ResponsiveContainer width="100%" height="100%">
      <BarChart data={drawn} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)"/>
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} angle={-45} textAnchor="end" height={46}/>
        <YAxis width={58} tickLine={false} axisLine={false} domain={ticks.length >= 2 ? [ticks[0], ticks.at(-1)!] : ["auto", "auto"]} ticks={ticks.length >= 2 ? ticks : undefined} tickFormatter={(value) => format(Number(value))}/>
        <Tooltip cursor={{ fill: "var(--grid)" }} content={({ active, payload, label }) => {
          const row = active && payload?.length ? payload[0].payload as CardRow : null;
          if (row && candles) {
            return row.candle ? <div className="chart-tooltip"><b>{label}</b>
              {([["Open", row.candle.open], ["High", row.candle.high], ["Low", row.candle.low], ["Close", row.candle.close]] as const)
                .map(([name, value]) => <span key={name}><span>{name}</span><strong>{format(value)}</strong></span>)}
            </div> : null;
          }
          return row ? <div className="chart-tooltip"><b>{label}</b>
            <span><i style={{ background: colour }}/><span>{valueTitle}</span><strong>{row.value == null ? "—" : format(row.value)}</strong></span>
            {card.pair && <span><i style={{ background: pairColour }}/><span>{card.pairTitle}</span><strong>{row.pair == null ? "—" : format(row.pair)}</strong></span>}
          </div> : null;
        }}/>
        {candles
          ? <Bar dataKey="range" isAnimationActive={false} shape={(props: object) => <Candle {...props as Parameters<typeof Candle>[0]} up={palette[2].value} down={palette[7].value}/>}/>
          : <Bar dataKey="value" fill={colour} radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {/* A negative bar is not the same event as a positive one, so it is not the same colour. */}
              {drawn.map((row) => <Cell key={row.label} fill={row.value != null && row.value < 0 ? "var(--danger)" : colour}/>)}
            </Bar>}
        {card.pair && <Bar dataKey="pair" fill={pairColour} radius={[3, 3, 0, 0]} isAnimationActive={false}/>}
      </BarChart>
    </ResponsiveContainer></div>
    <footer className="kpi-card-footer">
      <button type="button" onClick={savePng} title="Save this chart as a PNG">PNG</button>
      {chartable && onOpen && <button type="button" onClick={onOpen} title="Open in Charts">Open ↗</button>}
    </footer>
  </article>;
}

export function CompanyKpiGrid({ dataset, theme, onOpenMetric }: { dataset: CompanyDataset; theme: ThemeName; onOpenMetric: (metric: string, presentation: { style: SeriesStyle; frequency: SeriesFrequency }) => void }) {
  const [range, setRange] = useState<RangeId>(() => {
    if (typeof window === "undefined") return DEFAULT_RANGE;
    const saved = localStorage.getItem("finscope.overviewRange");
    return RANGES.some((item) => item.id === saved) ? saved as RangeId : DEFAULT_RANGE;
  });
  useEffect(() => { localStorage.setItem("finscope.overviewRange", range); }, [range]);

  /*
   * Match frequency to the question the range asks.
   *
   * Four years is a current operating view, where quarterly TTM adds useful
   * information. Ten years and Max are structural histories. Company Facts is
   * substantially more complete annually: a filer may publish every year but
   * omit one old quarter, and that one quarter deletes four TTM observations.
   * Drawing the long view from TTM therefore turned filing-detail gaps into the
   * large empty bands that looked like missing company data. Long views use
   * exact filed years; quarterly TTM remains available in Charts and the 4Y
   * overview. A filer with no quarterly chain naturally uses annual everywhere.
   */
  const series = useMemo(() => {
    const ttm = dataset.periods.filter((period) => period.periodicity === "ttm").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    const annual = dataset.periods.filter((period) => period.periodicity === "annual").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    return { ttm, annual };
  }, [dataset]);
  const available = useMemo(() => range === "4Y" && series.ttm.length >= 4 ? series.ttm : series.annual.length ? series.annual : series.ttm, [range, series]);
  const periods = useMemo(
    () => periodsWithin(available, RANGES.find((item) => item.id === range)?.years ?? 10),
    [available, range],
  );

  // Weekly sessions cover the widest range the cards offer without asking for
  // four thousand days, and land within a week of any fiscal close — close
  // enough to price a period against the market that saw it end.
  //
  // What came back is stored against the company it came back for, so switching
  // company shows "loading" rather than the previous company's prices — without
  // clearing state synchronously in the effect, which cascades a render.
  const [market, setMarket] = useState<{ ticker: string; bars: MarketBar[] | null } | null>(null);
  const ticker = dataset.company.ticker;
  const earliest = available[0]?.periodEnd;
  const current = market?.ticker === ticker ? market : null;
  const bars = useMemo(() => current ? current.bars ?? [] : null, [current]);
  const marketFailed = current?.bars === null;
  useEffect(() => {
    if (!earliest) return;
    let active = true;
    const start = `${Number(earliest.slice(0, 4)) - 1}${earliest.slice(4)}`;
    getJson<{ bars?: MarketBar[] }>(`/api/market/${encodeURIComponent(ticker)}?start=${start}&end=${new Date().toISOString().slice(0, 10)}&frequency=weekly`, { what: `the price history for ${ticker}` })
      .then((payload) => { if (active) setMarket({ ticker, bars: payload.bars ?? [] }); })
      .catch(() => { if (active) setMarket({ ticker, bars: null }); });
    return () => { active = false; };
  }, [ticker, earliest]);

  const candles = useMemo(() => bars ? candlesForPeriods(periods, bars) : null, [periods, bars]);

  if (!periods.length) return <p className="simple-state">No reported periods to chart yet.</p>;
  const frequency: SeriesFrequency = periods[0]?.periodicity === "ttm" ? "ttm" : "annual";
  // Only offer a window the filings can fill: a company with six years of
  // history has no ten-year view, and a button that changes nothing is a bug
  // the reader has to discover by pressing it.
  const covered = (Date.parse(available.at(-1)!.periodEnd) - Date.parse(available[0].periodEnd)) / (365.2425 * 86_400_000);
  const span = RANGES.filter((item) => item.id === "Max" || covered > item.years);

  return <>
    <div className="kpi-range">
      <div className="segmented" role="group" aria-label="How far back the cards reach">
        {span.map((item) => <button key={item.id} type="button" className={range === item.id ? "active" : ""} aria-pressed={range === item.id} onClick={() => setRange(item.id)}>{item.id}</button>)}
      </div>
      <small>{frequency === "ttm" ? "Quarterly TTM" : "Annual"} · {quarterLabel(periods[0])} → {quarterLabel(periods.at(-1)!)}{marketFailed ? " · market history unavailable" : ""}</small>
    </div>
    <KpiCards cards={CARDS} periods={periods} candles={candles} bars={bars} dataset={dataset} theme={theme} frequency={frequency} onOpenMetric={onOpenMetric}/>
  </>;
}

/**
 * How far behind the company's own reporting a measure may fall before it stops
 * being one of its headline figures.
 *
 * Booking last filed a gross-profit line for the fourth quarter of 2017; it
 * presents operating expenses by function and has no cost-of-sales line at all,
 * so there is nothing to subtract either. A card for it sat in the middle of
 * fourteen current measures showing figures from eight years ago, which is not
 * an overview of the business.
 *
 * Two years rather than one, because a measure can legitimately lag: a filer
 * that omits capital expenditures from one quarter loses free cash flow for it
 * without having stopped reporting anything.
 */
const RETIRED_AFTER_YEARS = 2;

function KpiCards({ cards, periods, candles, bars, dataset, theme, frequency, onOpenMetric }: {
  cards: typeof CARDS; periods: FinancialPeriod[]; candles: Array<PeriodCandle | null> | null; bars: MarketBar[] | null;
  dataset: CompanyDataset; theme: ThemeName; frequency: SeriesFrequency;
  onOpenMetric: (metric: string, presentation: { style: SeriesStyle; frequency: SeriesFrequency }) => void;
}) {
  const latest = periods.at(-1)!.periodEnd;
  const built = cards.map((card) => {
    const rows: CardRow[] = periods.map((period, position) => {
      const candle = card.kind === "candles" ? candles?.[position] ?? null : undefined;
      const value = card.kind === "candles" ? candle?.close ?? null
        : card.kind === "market" ? freeCashFlowYieldOn(period, closeOn(bars ?? [], period.periodEnd), bars?.[0]?.currency ?? null)
        : derivedValue(period, card.metric);
      return {
        label: quarterLabel(period),
        date: period.periodEnd,
        value,
        pair: card.pair ? derivedValue(period, card.pair) : null,
        net: card.net ? derivedValue(period, card.net) : null,
        candle,
        range: candle ? [candle.low, candle.high] : undefined,
      };
    });
    const known = [...rows].reverse().find((row) => row.value != null || row.pair != null || row.candle != null);
    const behindYears = known ? (Date.parse(latest) - Date.parse(known.date)) / (365.2425 * 86_400_000) : Infinity;
    return { card, rows, known, retired: behindYears > RETIRED_AFTER_YEARS };
  });

  /*
   * A measure with nothing recent behind it is simply not shown.
   *
   * Booking last filed a gross-profit line for the fourth quarter of 2017 and
   * files no cost-of-sales line to subtract from either, so there is nothing to
   * draw. It had a card of eight-year-old figures among fourteen current ones,
   * then a paragraph explaining why. Neither belongs on an overview: the card
   * is left out, and the measure is still there in Charts and under Financials
   * for anyone who wants the history.
   */
  const live = built.filter((entry) => entry.known && !entry.retired);

  return <>
    <div className="kpi-grid">{live.map((entry) => {
      const index = built.indexOf(entry);
      // A market card waits for its prices rather than drawing an empty chart
      // and filling in later, which reads as a company with no share price.
      if ((entry.card.kind === "candles" || entry.card.kind === "market") && bars == null) {
        return <article key={entry.card.metric} className="kpi-card"><header><div><h3>{entry.card.title}</h3><small>Loading</small></div></header>
          <div className="kpi-canvas"><Skeleton label={`${entry.card.title.toLowerCase()} history`} chart height={180}/></div></article>;
      }
      return <KpiCard key={entry.card.metric} card={entry.card} rows={entry.rows} index={index} dataset={dataset} theme={theme}
        // A card opens in Charts as the thing it is on screen. The price card
        // draws weekly candles; handing over this page's trailing-twelve-month
        // frequency asked Charts for quarterly filings of a share price.
        onOpen={() => onOpenMetric(entry.card.metric, entry.card.kind === "candles"
          ? { style: "candle", frequency: "weekly" }
          : { style: "bar", frequency })}/>;
    })}</div>
  </>;
}
