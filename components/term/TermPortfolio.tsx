"use client";

import { useMemo, useState } from "react";
import {
  concentration, holdingsSeries, portfolioQuality, portfolioSeries, rebasePair, timeWeightedSeries, sectorWeights, valuePortfolio,
  type SeriesPoint, type ValuedPosition,
} from "@/lib/portfolio";
import {
  buildLots, firstTradeDate, flowsByDate, investedTimeline, ledger, positionsFromTransactions, shareTimeline, tradedContribution, xirr,
} from "@/lib/transactions";
import { qsTable, qsValuationColumns, type QsRow } from "@/lib/qs-export";
import { gradeForScore, QS_COVERAGE_FLOOR, screen, type ScoredCompany } from "@/lib/qs/screener";
import { stated } from "@/lib/sector";
import { summarySector } from "@/lib/watchlist-summary";
import {
  DAILY, RISK_FREE, SCENARIOS, aligned, beta, commonReturns, contributions, correlation, maxDrawdown, monthlyReturns,
  rebalance, returnsOf, riskContributions, sharpe, sortino, underwater, valueAtRisk, volatility, WEEKLY,
} from "@/lib/term/portfolio-risk";
import { Empty } from "@/components/io/Portfolio";
import { saveTrades, useStoredHoldings, useStoredTrades } from "@/components/io/holdings";
import { parseTrades } from "@/lib/transactions";
import { BookEditor } from "./BookEditor";
import { useAccount } from "@/components/io/account";
import { ABSENT, money, price as writePrice, shortDate } from "@/components/io/format";
import { Panel } from "./Panel";
import { Bars, paletteColor, CapitalChart, CorrelationMatrix, HoldingsMap, MonthlyReturns, PerfChart, Spark, type TradeMark } from "./PortfolioCharts";
import { BENCHMARK, usePortfolioFeed } from "./use-portfolio";
import { benchmarkName, performanceChartPoints, performanceHistories } from "@/lib/term/portfolio-performance";

/**
 * PORT: the book, as a risk desk reads it.
 *
 * What it is worth and what it did today; how it has done against the S&P 500
 * and how far it fell on the way; how much risk it carries, where that risk
 * sits and how the holdings move together; what it earns in dividends and
 * which of its companies report next; what a market fall would cost it; and
 * the trades that would bring it to the weights the reader wants.
 *
 * The book is the one the classic page keeps (components/io/holdings.ts) and
 * never leaves the browser. Every figure is struck on the shares held today,
 * priced back through the window — not on a record of trades — and the screen
 * says so.
 */

const BASE = "USD";
const SPANS = ["1M", "3M", "YTD", "1Y", "3Y", "5Y", "10Y", "Max"] as const;
type Span = (typeof SPANS)[number];
const DAILY_SPANS = new Set<Span>(["1M", "3M", "YTD", "1Y"]);

const pct = (value: number | null | undefined, places = 1) =>
  value == null || !Number.isFinite(value) ? ABSENT : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(places)}%`;
const plain = (value: number | null | undefined, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${(value * 100).toFixed(places)}%`);
const signedMoney = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? ABSENT : `${value < 0 ? "−" : "+"}${money(Math.abs(value), BASE)}`);
const dir = (value: number | null | undefined) => (value == null || value === 0 ? undefined : value > 0 ? "up" : "down");

/** The first date of a window, counted back from a series' last date. */
function windowStart(end: string, span: Span): string {
  if (span === "Max") return "0000-00-00";
  if (span === "YTD") return `${end.slice(0, 4)}-01-01`;
  const from = new Date(`${end}T00:00:00Z`);
  if (span === "1M") from.setUTCMonth(from.getUTCMonth() - 1);
  else if (span === "3M") from.setUTCMonth(from.getUTCMonth() - 3);
  else from.setUTCFullYear(from.getUTCFullYear() - Number(span.slice(0, -1)));
  return from.toISOString().slice(0, 10);
}
const since = (series: SeriesPoint[], from: string) => series.filter((point) => point.date >= from);

type SortKey = "value" | "ticker" | "day" | "gain" | "year" | "risk";

/** A dated example, so every time-aware figure has something to show: real companies and prices, invented trades. */
const EXAMPLE_TRADES = [
  "2022-01-10 BUY AAPL 40 @ 172", "2022-03-15 BUY MSFT 20 @ 288", "2022-06-16 BUY JPM 25 @ 112", "2022-10-13 BUY NVDA 60 @ 11.9",
  "2023-02-02 BUY COST 6 @ 505", "2023-05-11 BUY KO 60 @ 63", "2023-09-20 BUY XOM 30 @ 115", "2024-02-08 BUY LLY 8 @ 740",
  "2024-06-18 SELL NVDA 20 @ 135", "2024-11-05 BUY AAPL 10 @ 222", "2025-04-08 BUY MSFT 5 @ 355", "2025-08-01 SELL XOM 10 @ 108",
].join("\n");
const DEMO_TRADES = parseTrades(EXAMPLE_TRADES);

export function TermPortfolio() {
  const held = useStoredHoldings();
  const ownTrades = useStoredTrades();
  const { loaded, account } = useAccount();
  /*
   * Signed out with nothing kept on this device, PORT shows the example book
   * rather than an empty page — said so in its header, never saved, and gone
   * the moment the reader adds a holding of their own or signs in.
   */
  const demo = loaded && !account && !held.length && !ownTrades.length;
  const trades = demo ? DEMO_TRADES : ownTrades;
  /*
   * Dated trades, where the reader has given them, are the book: what is held
   * is what they leave, and every figure that depends on time — the return,
   * the drawdown, the risk, what each holding added — is struck on the book
   * as it actually stood on each date, with deposits taken out of the return.
   * Undated holdings are priced back as though always held, and say so.
   */
  const dated = trades.length > 0;
  const positions = useMemo(() => (dated ? positionsFromTransactions(trades) : held), [dated, trades, held]);
  const lots = useMemo(() => (dated ? buildLots(trades) : {}), [dated, trades]);
  const everTraded = useMemo(() => Object.keys(lots), [lots]);
  const feed = usePortfolioFeed(positions, everTraded);
  const [editing, setEditing] = useState(false);
  const [span, setSpan] = useState<Span>("1Y");
  const [total, setTotal] = useState(true);
  const shownFeed = DAILY_SPANS.has(span) ? feed.daily : feed.weekly;
  const benchmarkLabel = benchmarkName(total, total && shownFeed != null && shownFeed.totalIndex.length === 0);
  const [sort, setSort] = useState<SortKey>("value");
  const [targets, setTargets] = useState<Record<string, string>>({});

  /* The book, valued at today's quotes in dollars. */
  const valued = useMemo(() => {
    const prices: Record<string, number | null> = {};
    const names: Record<string, { name: string; sector: string }> = {};
    for (const position of positions) {
      const quote = feed.quotes[position.ticker];
      const summary = feed.summaries[position.ticker];
      prices[position.ticker] = quote?.price != null && quote.price > 0 && quote.currency === BASE ? quote.price : null;
      const fund = feed.funds[position.ticker];
      names[position.ticker] = {
        name: summary?.name ?? (fund && fund.name !== fund.ticker ? fund.name : null) ?? quote?.name ?? position.ticker,
        sector: (summary ? summarySector(summary) : null) ?? (fund ? "ETF" : "Not classified"),
      };
    }
    return valuePortfolio(positions, feed.summaries, prices, names);
  }, [positions, feed.quotes, feed.summaries, feed.funds]);
  /* One colour per holding, by its rank in the book, the same in every chart that names it. */
  const holdingColor = useMemo(() => new Map(valued.positions.map((position, index) => [position.ticker, paletteColor(index)])), [valued]);

  const day = useMemo(() => {
    let moved = 0; let opened = 0;
    const byTicker: Record<string, number> = {};
    for (const position of valued.positions) {
      const quote = feed.quotes[position.ticker];
      if (position.value == null || quote?.previousClose == null) continue;
      const change = position.value - quote.previousClose * position.shares;
      moved += change; opened += quote.previousClose * position.shares;
      byTicker[position.ticker] = change;
    }
    return opened > 0 ? { moved, percent: moved / opened, byTicker } : null;
  }, [valued, feed.quotes]);

  /* The book through time: shares held today at every close. */
  const series = useMemo(() => {
    const timeline = dated ? shareTimeline(trades) : null;
    const flows = dated ? flowsByDate(trades) : null;
    const start = dated ? firstTradeDate(trades) : null;
    const read = (source: typeof feed.daily, adjusted: boolean) => {
      if (!source) return null;
      const { histories, index } = performanceHistories(source, adjusted);
      if (timeline && flows) {
        // The book as it stood each day, and its return with the trades' cash taken out.
        const values = holdingsSeries(timeline, histories, start);
        return { book: timeWeightedSeries(values, flows), values, index, histories };
      }
      const values = portfolioSeries(positions, histories);
      return { book: values, values, index, histories };
    };
    return {
      daily: read(feed.daily, total), weekly: read(feed.weekly, total),
      dailyAdjusted: read(feed.daily, true), weeklyAdjusted: read(feed.weekly, true),
    };
  }, [feed, positions, total, dated, trades]);

  const perf = useMemo(() => {
    const source = DAILY_SPANS.has(span) ? series.daily : series.weekly;
    if (!source?.book.length) return null;
    const from = windowStart(source.book.at(-1)!.date, span);
    const book = since(source.book, from);
    const paired = rebasePair(book, source.index);
    if (paired.length < 2) return null;
    const water = new Map(underwater(book).map((point) => [point.date, point.value]));
    const drawn = performanceChartPoints(paired, source.values, water, total);
    const last = paired.at(-1)!;
    const years = (Date.parse(last.date) - Date.parse(drawn[0].date)) / (365.25 * 86_400_000);
    const startValue = since(source.values, drawn[0].date)[0]?.value ?? 0;
    const contrib = (dated
      ? everTraded.flatMap((ticker) => {
        const money = tradedContribution(trades, ticker, source.histories[ticker] ?? [], drawn[0].date);
        return money == null || Math.abs(money) < 0.005 ? [] : [{ ticker, money, share: startValue > 0 ? money / startValue : 0, ret: null as number | null }];
      })
      : contributions(positions, source.histories, drawn[0].date))
      .sort((left, right) => right.money - left.money);
    const marks: TradeMark[] = dated ? trades.filter((entry) => entry.date >= drawn[0].date).map((entry) => ({
      date: entry.date, kind: entry.kind, label: `${entry.date} · ${entry.kind === "buy" ? "Bought" : "Sold"} ${entry.shares} ${entry.ticker} @ ${entry.price.toFixed(2)}`,
    })) : [];
    return {
      drawn, from: drawn[0].date, years,
      book: last.portfolio / 100 - 1, index: last.benchmark / 100 - 1,
      cagr: years >= 1 ? (last.portfolio / 100) ** (1 / years) - 1 : null,
      drawdown: maxDrawdown(book), contrib, marks,
      // A book younger than the window starts where its youngest holding does.
      short: paired[0].date > (since(source.index, from)[0]?.date ?? paired[0].date),
    };
  }, [series, span, total, positions, dated, trades, everTraded]);

  /* Risk over the last year of sessions, on total-return closes. */
  const risk = useMemo(() => {
    const source = series.dailyAdjusted;
    if (!source?.book.length) return null;
    const from = windowStart(source.book.at(-1)!.date, "1Y");
    const book = returnsOf(since(source.book, from));
    const market = returnsOf(since(source.index, from));
    const [a, m] = aligned(book, market);
    if (a.length < 20) return null;
    const perHolding: Record<string, { ret: number | null; vol: number | null; beta: number | null; dividendYield: number | null; spark: number[] }> = {};
    for (const position of positions) {
      const bars = (feed.daily?.holdings[position.ticker] ?? []);
      const year = bars.filter((bar) => bar.date >= from);
      const own = returnsOf(year.map((bar) => ({ date: bar.date, value: bar.adjusted })));
      const [h, mk] = aligned(own, market);
      const first = year[0]; const last = year.at(-1);
      perHolding[position.ticker] = {
        ret: first && last ? last.adjusted / first.adjusted - 1 : null,
        vol: volatility(h, DAILY),
        beta: beta(h, mk),
        // Dividends over the year, from how far the adjusted close drifted from the close.
        dividendYield: first && last && first.close > 0 && last.close > 0 ? Math.max(0, (last.adjusted / last.close) / (first.adjusted / first.close) - 1) : null,
        spark: bars.filter((bar) => bar.date >= windowStart(bars.at(-1)?.date ?? from, "3M")).map((bar) => bar.close),
      };
    }
    // Where the variance sits, and how the holdings move together.
    const pricedHoldings = valued.positions.filter((position) => position.value != null && (source.histories[position.ticker]?.length ?? 0) > 20)
      .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));
    const common = commonReturns(pricedHoldings.map((position) => since(source.histories[position.ticker], from)));
    const weightsTotal = pricedHoldings.reduce((sum, position) => sum + (position.value ?? 0), 0);
    const shares = riskContributions(pricedHoldings.map((position) => (position.value ?? 0) / weightsTotal), common.returns);
    const top = pricedHoldings.slice(0, 12);
    const topReturns = common.returns.slice(0, 12);
    const matrix = topReturns.map((left) => topReturns.map((right) => correlation(left, right)));
    const volBook = volatility(a, DAILY);
    return {
      vol: volBook, volIndex: volatility(m, DAILY), beta: beta(a, m), correlation: correlation(a, m),
      sharpe: sharpe(a, DAILY), sortino: sortino(a, DAILY), var95: valueAtRisk(a, 0.05),
      perHolding,
      riskShare: shares ? Object.fromEntries(pricedHoldings.map((position, index) => [position.ticker, shares[index]])) : {},
      correlationTickers: top.map((position) => position.ticker), matrix,
    };
  }, [series, positions, feed.daily, valued]);

  const months = useMemo(() => (series.weeklyAdjusted?.book.length ? monthlyReturns(series.weeklyAdjusted.book) : []), [series]);

  /* Look-through: your fraction of what each company filed. */
  const lookThrough = useMemo(() => {
    let revenue = 0; let freeCashFlow = 0; let covered = 0;
    for (const position of valued.positions) {
      const summary = position.summary;
      if (!summary?.shares || position.value == null || summary.revenue == null || summary.freeCashFlow == null) continue;
      const ownership = position.shares / summary.shares;
      revenue += ownership * summary.revenue; freeCashFlow += ownership * summary.freeCashFlow; covered += position.value;
    }
    return { revenue, freeCashFlow, coverage: valued.value > 0 ? covered / valued.value : 0, yield: covered > 0 ? freeCashFlow / covered : null };
  }, [valued]);

  /* Each holding's grade, from the engine that grades everything else. */
  const graded = useMemo(() => {
    const rows: QsRow[] = valued.positions.flatMap((position) => {
      const summary = position.summary; const quote = feed.quotes[position.ticker];
      return summary?.qs ? [{ ticker: summary.ticker, values: { ...summary.qs, ...qsValuationColumns(summary.qsPrice, quote?.price ?? null, quote?.currency) } }] : [];
    });
    const scored: Record<string, ScoredCompany | undefined> = {};
    if (!rows.length) return scored;
    try { for (const row of screen(qsTable(rows), { modele: "finscope" }).all) scored[row.Ticker.toUpperCase()] = row; } catch { /* Ungraded. */ }
    return scored;
  }, [valued, feed.quotes]);
  const quality = useMemo(() => {
    const reading = portfolioQuality(valued.positions, (position) => { const row = graded[position.ticker]; return row?.note === "NR" ? null : row?.total; });
    return reading.value == null ? null : { value: reading.value, grade: reading.coverage >= QS_COVERAGE_FLOOR ? gradeForScore(reading.value) : "NR", coverage: reading.coverage };
  }, [valued, graded]);

  const sectors = useMemo(() => sectorWeights(valued.positions, (position) => stated(position.sector) ?? "Not classified",
    (ticker) => (feed.funds[ticker]?.sectors.length ? feed.funds[ticker].sectors : null)), [valued, feed.funds]);
  const spread = useMemo(() => concentration(valued.positions), [valued]);

  const income = useMemo(() => {
    const rows = valued.positions.flatMap((position) => {
      const yieldNow = risk?.perHolding[position.ticker]?.dividendYield;
      return position.value != null && yieldNow != null && yieldNow > 0 ? [{ ticker: position.ticker, income: position.value * yieldNow, yield: yieldNow }] : [];
    }).sort((left, right) => right.income - left.income);
    const annual = rows.reduce((sum, row) => sum + row.income, 0);
    return { rows, annual, yield: valued.value > 0 ? annual / valued.value : null, onCost: valued.cost > 0 ? annual / valued.cost : null };
  }, [valued, risk]);

  const stress = useMemo(() => SCENARIOS.map((scenario) => {
    let loss = 0; let assumed = 0;
    for (const position of valued.positions) {
      if (position.value == null) continue;
      const exposure = risk?.perHolding[position.ticker]?.beta;
      if (exposure == null) assumed += position.value;
      loss += position.value * (exposure ?? 1) * scenario.move;
    }
    return { ...scenario, money: loss, share: valued.value > 0 ? loss / valued.value : null, assumed };
  }), [valued, risk]);

  const orders = useMemo(() => {
    const priced = valued.positions.filter((position) => position.price != null);
    const equal = priced.length ? 100 / priced.length : 0;
    return rebalance(priced.map((position) => {
      const typed = Number(targets[position.ticker]);
      return { ticker: position.ticker, shares: position.shares, price: position.price, target: targets[position.ticker] != null && targets[position.ticker] !== "" && Number.isFinite(typed) ? typed : equal };
    }));
  }, [valued, targets]);

  const rows = useMemo(() => {
    const value = (position: ValuedPosition): number => {
      switch (sort) {
        case "ticker": return 0;
        case "day": return day?.byTicker[position.ticker] ?? -Infinity;
        case "gain": return position.profitPercent ?? -Infinity;
        case "year": return risk?.perHolding[position.ticker]?.ret ?? -Infinity;
        case "risk": return risk?.riskShare[position.ticker] ?? -Infinity;
        default: return position.value ?? -Infinity;
      }
    };
    return [...valued.positions].sort((left, right) => (sort === "ticker" ? left.ticker.localeCompare(right.ticker) : value(right) - value(left)));
  }, [valued, sort, day, risk]);

  const openEditor = () => setEditing(true);
  const example = () => saveTrades(parseTrades(EXAMPLE_TRADES));

  const editor = editing ? <BookEditor trades={ownTrades} positions={held} onClose={() => setEditing(false)} /> : null;

  /* With dated trades: what was banked, what went in, and the investor's own rate. */
  const realised = Object.values(lots).reduce((sum, lot) => sum + lot.realised, 0);
  const invested = dated ? investedTimeline(trades).at(-1)?.value ?? 0 : null;
  const today = new Date().toISOString().slice(0, 10);
  const moneyWeighted = dated && valued.value > 0 ? xirr(trades, valued.value, today) : null;
  const sinceStart = dated ? firstTradeDate(trades) : null;
  const book = dated ? ledger(trades).reverse() : [];

  if (!positions.length) {
    return (
      <>
        <header className="t-head"><h1 className="t-head-ticker">PORT</h1><p className="t-head-name">Portfolio · nothing held yet</p></header>
        <div className="t-panel t-panel-pad"><Empty onOpen={openEditor} onExample={example} /></div>
        {editor}
      </>
    );
  }

  const header = (
    <header className="t-head">
      <h1 className="t-head-ticker">PORT</h1>
      <div>
        <p className="t-head-name">Portfolio · {positions.length} {positions.length === 1 ? "holding" : "holdings"}</p>
        <div className="t-head-meta">
          {demo
            ? <span className="t-amber">Example portfolio: invented trades in real companies, at real prices. <a href="/t/account">Sign in</a> or add your own holdings to replace it.</span>
            : <span>{dated ? `${trades.length} dated trades since ${shortDate(sinceStart)}` : "Undated holdings"} · kept on this device</span>}
          <button type="button" className="t-chip" onClick={openEditor}>{demo ? "Add your holdings" : "Edit · import CSV"}</button>
        </div>
      </div>
      <div className="t-head-price">
        <span className="t-head-last">{valued.value > 0 ? money(valued.value, BASE) : ABSENT}</span>
        <span className="t-head-move" data-dir={dir(day?.moved)}>{day ? `${signedMoney(day.moved)}  ${pct(day.percent, 2)}` : ABSENT}</span>
      </div>
    </header>
  );

  const kpis: Array<{ label: string; value: string; tone?: string; note?: string }> = [
    { label: "Value", value: valued.value > 0 ? money(valued.value, BASE) : ABSENT },
    { label: "Cost", value: valued.cost > 0 ? money(valued.cost, BASE) : ABSENT },
    { label: "Unrealised gain", value: valued.profit == null ? ABSENT : `${signedMoney(valued.profit)} · ${pct(valued.profitPercent)}`, tone: dir(valued.profit) },
    ...(dated ? [
      { label: "Realised gain", value: signedMoney(realised), tone: dir(realised), note: "Banked by sales, at average cost" },
      { label: "Total gain", value: signedMoney((valued.profit ?? 0) + realised), tone: dir((valued.profit ?? 0) + realised), note: `Net invested ${invested == null ? ABSENT : money(invested, BASE)}` },
      { label: "Money-weighted · XIRR", value: moneyWeighted == null ? ABSENT : `${pct(moneyWeighted)}/yr`, tone: dir(moneyWeighted), note: `Your return, timing included · since ${shortDate(sinceStart)}` },
    ] : []),
    { label: "Today", value: day ? `${signedMoney(day.moved)} · ${pct(day.percent, 2)}` : ABSENT, tone: dir(day?.moved) },
    { label: `${dated ? "Time-weighted" : "Return"} · ${span}`, value: perf ? pct(perf.book) : ABSENT, tone: dir(perf?.book), note: dated ? "Deposits and sales taken out" : undefined },
    { label: `${benchmarkLabel} · ${span}`, value: perf ? pct(perf.index) : ABSENT, tone: dir(perf?.index) },
    { label: "Excess return", value: perf ? pct(perf.book - perf.index) : ABSENT, tone: dir(perf ? perf.book - perf.index : null) },
    { label: "Annualised", value: perf?.cagr != null ? pct(perf.cagr) : ABSENT, note: "Over windows of a year or more" },
    { label: "Volatility · 1Y", value: plain(risk?.vol), note: `${BENCHMARK.label} ${plain(risk?.volIndex)}` },
    { label: "Beta · 1Y", value: risk?.beta == null ? ABSENT : risk.beta.toFixed(2), note: `Correlation ${risk?.correlation == null ? ABSENT : risk.correlation.toFixed(2)}` },
    { label: "Sharpe · 1Y", value: risk?.sharpe == null ? ABSENT : risk.sharpe.toFixed(2), note: `Risk-free ${(RISK_FREE * 100).toFixed(0)}% · Sortino ${risk?.sortino == null ? ABSENT : risk.sortino.toFixed(2)}` },
    { label: "Max drawdown", value: perf ? pct(perf.drawdown.depth) : ABSENT, tone: "down", note: perf?.drawdown.trough ? `To ${shortDate(perf.drawdown.trough)}${perf.drawdown.recovered ? `, recovered ${shortDate(perf.drawdown.recovered)}` : ", not yet recovered"}` : undefined },
    { label: "1-day VaR 95%", value: risk?.var95 == null ? ABSENT : `${signedMoney(risk.var95 * valued.value)}`, tone: "down", note: `${pct(risk?.var95, 2)} · historical, last year` },
    { label: "Dividend income", value: income.annual > 0 ? `${money(income.annual, BASE)}/yr` : ABSENT, note: `Yield ${plain(income.yield, 2)}${income.onCost != null ? ` · on cost ${plain(income.onCost, 2)}` : ""}` },
    { label: "Look-through FCF yield", value: plain(lookThrough.yield, 2), note: lookThrough.coverage < 0.995 ? `Over ${plain(lookThrough.coverage, 0)} of the book` : "Your share of filed free cash flow" },
    { label: "Weighted quality", value: quality ? `${quality.grade} · ${quality.value.toFixed(0)}` : ABSENT, note: `Effective holdings ${spread.effectiveHoldings == null ? ABSENT : spread.effectiveHoldings.toFixed(1)}` },
  ];

  const sortButton = (key: SortKey, label: string) => (
    <button type="button" aria-pressed={sort === key} onClick={() => setSort(key)}>{label}</button>
  );

  return (
    <>
      {header}
      <div className="t-grid t-port" data-dated={dated || undefined}>
        <Panel code="PERF" title={total ? `Performance against the ${benchmarkLabel}` : `Portfolio value · ${BASE}`} area="perf" actions={
          <>
            <div className="seg" role="group" aria-label="Returns">
              <button type="button" aria-pressed={total} onClick={() => setTotal(true)} title="Performance in %, dividends reinvested">Total return</button>
              <button type="button" aria-pressed={!total} onClick={() => setTotal(false)} title={`Portfolio value in ${BASE}`}>Price</button>
            </div>
            <div className="seg" role="group" aria-label="Window">
              {SPANS.map((entry) => <button key={entry} type="button" aria-pressed={span === entry} onClick={() => setSpan(entry)}>{entry}</button>)}
            </div>
          </>
        }>
          {/* Taller beside the longer column of figures a dated book has. */}
          <PerfChart key={`${span}:${total ? "return" : "value"}`} points={perf?.drawn ?? []} label={total ? benchmarkLabel : `${BENCHMARK.label} equivalent`} unit={total ? "percent" : "currency"} currency={BASE} marks={perf?.marks ?? []} height={dated ? 430 : 300} />
          <p className="t-study-note">
            {!total ? <>Portfolio value in {BASE}, {dated ? "from the shares held on each date; deposits and sales change the value" : "from the shares held today, priced back through the window"}. The S&amp;P 500 price comparison starts with the same amount. ▲ buys, ▼ sales. </> : dated
              ? <>The book as it stood on each {DAILY_SPANS.has(span) ? "session" : "week"}, from your dated trades, as a time-weighted return: a deposit is not a gain, so each trade&apos;s cash is taken out before the day&apos;s return is chained. ▲ buys, ▼ sales. </>
              : <>The shares held today, priced back through every {DAILY_SPANS.has(span) ? "session" : "week"} of the window — not a record of trades; add dated trades or import a broker CSV for the book as it really was. </>}
            {total ? "Dividends reinvested on both lines." : ""}
            {perf?.short ? ` The line starts on ${shortDate(perf.from)}, where ${dated ? "the first trade" : "the youngest holding's prices"} begin${dated ? "s" : ""}.` : ""}
          </p>
        </Panel>

        <Panel code="KPI" title="Key metrics" area="kpi" className="t-fill">
          <div className="t-pf-kpis">
            {kpis.map((kpi) => (
              <div className="t-pf-kpi" key={kpi.label}>
                <span className="t-pf-kpi-label">{kpi.label}</span>
                <span className="t-pf-kpi-value" data-dir={kpi.tone}>{kpi.value}</span>
                {kpi.note ? <span className="t-pf-kpi-note">{kpi.note}</span> : null}
              </div>
            ))}
          </div>
        </Panel>

        <Panel code="HOLD" title="Holdings" area="hold" actions={
          <div className="seg" role="group" aria-label="Sort">
            {sortButton("value", "Value")}{sortButton("day", "Day")}{sortButton("gain", "Gain")}{sortButton("year", "1Y")}{sortButton("risk", "Risk")}{sortButton("ticker", "A–Z")}
          </div>
        }>
          <div className="sheet t-pf-holdings">
            <table>
              <thead>
                <tr>
                  <th className="key">Holding</th><th>Shares</th><th>Price</th><th>Day</th><th>Value</th><th>Weight</th>
                  <th>Cost / sh</th><th>Gain</th><th>Gain %</th>{dated ? <><th>Realised</th><th>Since</th></> : null}<th>1Y</th><th>3M</th><th>Vol</th><th>Beta</th><th>Div yld</th><th title="Share of the book's variance">Risk</th><th>Grade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const quote = feed.quotes[row.ticker];
                  const metrics = risk?.perHolding[row.ticker];
                  const riskShare = risk?.riskShare[row.ticker];
                  const grade = graded[row.ticker];
                  return (
                    <tr key={row.ticker}>
                      <td className="key">
                        <a href={`/t/s/${encodeURIComponent(row.ticker)}`}><b>{row.ticker}</b></a>
                        <span className="t-pf-name">{row.name}</span>
                      </td>
                      <td>{row.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                      <td>{row.price == null ? ABSENT : writePrice(row.price, quote?.currency ?? BASE)}</td>
                      <td data-dir={dir(quote?.changePercent)}>{pct(quote?.changePercent, 2)}</td>
                      <td>{row.value == null ? ABSENT : money(row.value, BASE)}</td>
                      <td className="t-pf-weight"><span style={{ width: `${Math.min(100, (row.weight ?? 0) * 100 / Math.max(spread.largest ?? 1, 0.0001))}%` }} /><em>{plain(row.weight)}</em></td>
                      <td>{row.costBasis == null ? ABSENT : writePrice(row.costBasis / row.shares, BASE)}</td>
                      <td data-dir={dir(row.profit)}>{signedMoney(row.profit)}</td>
                      <td data-dir={dir(row.profitPercent)}>{pct(row.profitPercent)}</td>
                      {dated ? <>
                        <td data-dir={dir(lots[row.ticker]?.realised)}>{lots[row.ticker]?.realised ? signedMoney(lots[row.ticker].realised) : ABSENT}</td>
                        <td>{lots[row.ticker] ? shortDate(lots[row.ticker].firstDate) : ABSENT}</td>
                      </> : null}
                      <td data-dir={dir(metrics?.ret)}>{pct(metrics?.ret)}</td>
                      <td className="t-spark-cell"><Spark values={metrics?.spark ?? []} /></td>
                      <td>{plain(metrics?.vol, 0)}</td>
                      <td>{metrics?.beta == null ? ABSENT : metrics.beta.toFixed(2)}</td>
                      <td>{metrics?.dividendYield ? plain(metrics.dividendYield, 2) : ABSENT}</td>
                      <td>{plain(riskShare)}</td>
                      <td>{grade?.note ?? ABSENT}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {Object.keys(feed.funds).length ? <p className="t-study-note">{Object.keys(feed.funds).join(", ")}: {Object.keys(feed.funds).length === 1 ? "a fund" : "funds"} — priced and weighted, spread over the sectors held, outside the grade and the look-through figures.</p> : null}
          {feed.pending.length ? <p className="t-study-note">{feed.pending.join(", ")} still being read from the filings: priced, but without grade or look-through figures yet.</p> : null}
        </Panel>

        <Panel code="IMAP" id="pf-map" title="Holdings map · sized by value, coloured by daily change" area="map">
          <HoldingsMap items={valued.positions.filter((position) => position.value != null).map((position) => ({
            ticker: position.ticker, sector: stated(position.sector) ?? "Not classified", value: position.value!, weight: position.weight ?? 0,
            change: feed.quotes[position.ticker]?.changePercent ?? null,
          }))} />
        </Panel>

        <Panel code="SECT" title="Sectors" area="sect">
          <Bars rows={sectors.map((entry) => ({ label: entry.label, value: entry.weight }))} format={(value) => plain(value)} tone="palette" />
          <p className="t-study-note">
            {valued.positions.length} holdings, concentrated like {spread.effectiveHoldings == null ? ABSENT : spread.effectiveHoldings.toFixed(1)} equally sized ones; the largest is {plain(spread.largest)} of the book.
          </p>
        </Panel>

        <Panel code="ATTR" title={`Return attribution · ${span}`} area="contrib">
          {perf?.contrib.length ? (
            <Bars rows={perf.contrib.map((row) => ({ label: row.ticker, value: row.money, note: `${pct(row.ret)} on the holding · ${pct(row.share, 2)} of the book`, href: `/t/s/${encodeURIComponent(row.ticker)}` }))} format={signedMoney} />
          ) : <p className="t-empty">Reading prices…</p>}
          <p className="t-study-note">Shares held × the change in each price since {perf ? shortDate(perf.from) : "the start of the window"}; the parts add up to the book&apos;s own change.</p>
        </Panel>

        <Panel code="RISK" title="Risk contribution · share of portfolio variance, 1Y" area="risk">
          {risk && Object.keys(risk.riskShare).length ? (
            <Bars rows={Object.entries(risk.riskShare).sort((left, right) => right[1] - left[1]).map(([ticker, share]) => ({
              label: ticker, value: share, color: holdingColor.get(ticker), note: `${plain(share)} of the risk for ${plain(valued.positions.find((position) => position.ticker === ticker)?.weight)} of the money`,
            }))} format={(value) => plain(value)} tone="palette" />
          ) : <p className="t-empty">Reading prices…</p>}
          <p className="t-study-note">Weight × covariance with the book, over the book&apos;s variance. A holding whose share of the risk is well above its share of the money is where the book is exposed.</p>
        </Panel>

        <Panel code="CORR" title="Correlation matrix · daily returns, 1Y" area="corr">
          {risk?.correlationTickers.length ? <CorrelationMatrix tickers={risk.correlationTickers} matrix={risk.matrix} /> : <p className="t-empty">Reading prices…</p>}
          <p className="t-study-note">Correlation of daily returns: red moves together, blue moves apart. The twelve largest holdings.</p>
        </Panel>

        <Panel code="MRET" title="Monthly returns · total return" area="mret">
          {months.length ? <MonthlyReturns months={months} /> : <p className="t-empty">Reading prices…</p>}
        </Panel>

        <Panel code="DVD" title="Dividend income · trailing year" area="inc">
          {income.rows.length ? (
            <Bars rows={income.rows.map((row) => ({ label: row.ticker, value: row.income, color: holdingColor.get(row.ticker), note: `Yield ${plain(row.yield, 2)}` }))} format={(value) => `${money(value, BASE)}/yr`} tone="palette" />
          ) : <p className="t-empty">{risk ? "No holding paid a dividend over the last year." : "Reading prices…"}</p>}
          <p className="t-study-note">The trailing year&apos;s dividends at today&apos;s holdings, read from how far each adjusted close drifted from the close. {income.annual > 0 ? `${money(income.annual, BASE)} a year, ${money(income.annual / 12, BASE)} a month.` : ""}</p>
        </Panel>

        <Panel code="EVTS" title="Upcoming earnings · next three weeks" area="evts">
          {feed.earnings == null ? <p className="t-empty">Reading the calendar…</p> : feed.earnings.length ? (
            <div className="sheet">
              <table>
                <thead><tr><th className="key">Date</th><th className="key">Holding</th><th>Time</th><th>Consensus EPS</th><th>Weight</th></tr></thead>
                <tbody>
                  {feed.earnings.map((event) => (
                    <tr key={`${event.ticker}-${event.date}`}>
                      <td className="key">{shortDate(event.date)}</td>
                      <td className="key"><a href={`/t/s/${encodeURIComponent(event.ticker)}#ee`}>{event.ticker}</a></td>
                      <td>{event.time === "before" ? "☀ Open" : event.time === "after" ? "☾ Close" : "—"}</td>
                      <td>{event.consensusEps == null ? ABSENT : `$${event.consensusEps.toFixed(2)}`}</td>
                      <td>{plain(valued.positions.find((position) => position.ticker === event.ticker)?.weight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="t-empty">None of the holdings reports in the next three weeks.</p>}
          <p className="t-study-note">Dates as the companies announced them, via Nasdaq; the consensus is the analysts&apos;, not a filed figure.</p>
        </Panel>

        <Panel code="STRS" title="Stress test · beta-adjusted scenarios" area="stress">
          <div className="sheet">
            <table>
              <thead><tr><th className="key">Scenario</th><th>Book</th><th>Money</th></tr></thead>
              <tbody>
                {stress.map((scenario) => (
                  <tr key={scenario.id}>
                    <td className="key">{scenario.label}</td>
                    <td data-dir={dir(scenario.share)}>{pct(scenario.share)}</td>
                    <td data-dir={dir(scenario.money)}>{signedMoney(scenario.money)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="t-study-note">Each holding moves by its one-year beta times the market&apos;s move{stress[0]?.assumed ? `; ${money(stress[0].assumed, BASE)} without a beta is taken at 1` : ""}. A sketch of sensitivity, not a forecast: in a real crash correlations rise.</p>
        </Panel>

        {dated ? (
          <Panel code="CAP" title="Portfolio value vs. net contributions" area="cap">
            <CapitalChart
              values={(series.weekly?.values ?? []).filter((point) => !sinceStart || point.date >= sinceStart)}
              invested={investedTimeline(trades)}
              marks={trades.map((entry) => ({ date: entry.date, kind: entry.kind, label: `${entry.date} · ${entry.kind === "buy" ? "Bought" : "Sold"} ${entry.shares} ${entry.ticker} @ ${entry.price.toFixed(2)}` }))}
            />
            <p className="t-study-note">The book&apos;s weekly value against what was paid in net of sales. The gap is the gain, realised and not; each step is a trade.</p>
          </Panel>
        ) : null}
        {dated ? (
          <Panel code="TRDS" title={`Trades · ${trades.length}`} area="trds">
            <div className="sheet t-pf-trades">
              <table>
                <thead><tr><th className="key">Date</th><th className="key">Side</th><th className="key">Holding</th><th>Shares</th><th>Price</th><th>Amount</th><th>Held after</th><th>Realised</th></tr></thead>
                <tbody>
                  {book.map((entry) => (
                    <tr key={entry.id}>
                      <td className="key">{shortDate(entry.date)}</td>
                      <td className="key" data-dir={entry.kind === "buy" ? "up" : "down"}>{entry.kind === "buy" ? "▲ Buy" : "▼ Sell"}</td>
                      <td className="key"><a href={`/t/s/${encodeURIComponent(entry.ticker)}`}>{entry.ticker}</a></td>
                      <td>{entry.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                      <td>{writePrice(entry.price, BASE)}</td>
                      <td>{money(entry.amount, BASE)}</td>
                      <td>{entry.after.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                      <td data-dir={dir(entry.realised)}>{entry.realised == null ? ABSENT : signedMoney(entry.realised)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}

        <Panel code="RBAL" title="Rebalance · trades to target weights" area="rbal" actions={
          <button type="button" className="t-chip" onClick={() => setTargets({})}>Equal weight</button>
        }>
          <div className="sheet">
            <table>
              <thead><tr><th className="key">Holding</th><th>Now</th><th>Target %</th><th>Target value</th><th>Trade</th><th>Shares</th></tr></thead>
              <tbody>
                {orders.map((trade) => {
                  const now = valued.value > 0 ? trade.value / valued.value : null;
                  const equal = orders.length ? (100 / orders.length).toFixed(1) : "";
                  return (
                    <tr key={trade.ticker}>
                      <td className="key"><a href={`/t/s/${encodeURIComponent(trade.ticker)}`}>{trade.ticker}</a></td>
                      <td>{plain(now)}</td>
                      <td className="t-pf-target">
                        <input inputMode="decimal" aria-label={`Target weight for ${trade.ticker}`} value={targets[trade.ticker] ?? ""} placeholder={equal}
                          onChange={(event) => setTargets({ ...targets, [trade.ticker]: event.target.value })} />
                      </td>
                      <td>{money(trade.targetValue, BASE)}</td>
                      <td data-dir={dir(trade.trade)}>{Math.abs(trade.trade) < 0.5 ? ABSENT : signedMoney(trade.trade)}</td>
                      <td data-dir={dir(trade.trade)}>{trade.tradeShares == null || Math.abs(trade.trade) < 0.5 ? ABSENT : `${trade.tradeShares > 0 ? "Buy" : "Sell"} ${Math.abs(trade.tradeShares).toLocaleString("en-US", { maximumFractionDigits: 2 })}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="t-study-note">Targets left blank are equal weights; typed ones are scaled so they add to 100. Nothing here places an order.</p>
        </Panel>
      </div>
      <p className="t-study-note t-pf-foot">
        Annualised with {DAILY} sessions a year ({WEEKLY} weeks for the longer windows). Prices from Yahoo Finance, filings from SEC EDGAR. Research information only — not investment advice.
      </p>
      {editor}
    </>
  );
}
