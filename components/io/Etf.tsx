"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { EtfProfile, Exposure, NotReported } from "@/lib/adapters/etf";
import { candlesInRange, CHART_RANGES, type ChartRange } from "@/lib/io/chart-ranges";
import { sectorColors } from "@/lib/watchlist-bubbles";
import { CandleChart, useCandles } from "./CandleChart";
import { ABSENT, money, price as writePrice, shortDate } from "./format";

/**
 * An exchange-traded fund, on a page of its own (lib/etf-profile.ts).
 *
 * What it costs, what it holds, where its money is — by sector, country, asset
 * class and currency — and what it has returned, year by year and against its
 * index. Everything below the price is the fund's own filing: its monthly
 * portfolio report (N-PORT) and its prospectus, each linked and dated.
 */

type Loaded = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; profile: EtfProfile | NotReported };

const RANGES: ChartRange[] = ["1M", "1Q", "YTD", "1Y", "5Y"];
const pct = (value: number | null | undefined, places = 2) => (value == null || !Number.isFinite(value) ? ABSENT : `${(value * 100).toFixed(places)}%`);
const signedPct = (value: number | null | undefined, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(places)}%`);
const tone = (value: number | null | undefined) => (value == null ? undefined : value >= 0 ? "up" : "down");

export function Etf({ ticker }: { ticker: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [range, setRange] = useState<ChartRange>("1Y");
  const [allHoldings, setAllHoldings] = useState(false);
  const period = CHART_RANGES.find((entry) => entry.id === range)!;
  const candles = useCandles(ticker, period.interval);
  const daily = useCandles(ticker, "1d");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/etf/${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as EtfProfile | NotReported | { error: string };
        if (!response.ok || "error" in body) throw new Error("error" in body ? body.error : `${ticker} could not be read.`);
        setLoaded({ kind: "ready", profile: body });
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setLoaded({ kind: "failed", message: error instanceof Error ? error.message : "Unreachable." }); });
    return () => controller.abort();
  }, [ticker]);

  const last = daily.candles?.last ?? daily.candles?.c.at(-1) ?? null;
  // The close of the session before the last: a daily history's own "previous close" is the one before its first candle, two years back.
  const previous = daily.candles && daily.candles.c.length > 1 ? daily.candles.c[daily.candles.c.length - 2] : null;
  const change = last != null && previous ? last / previous - 1 : null;
  const currency = daily.candles?.currency ?? "USD";
  const openOn = candles.candles ? candlesInRange(candles.candles.t, range) : undefined;
  const profile = loaded.kind === "ready" ? loaded.profile : null;
  const fund = profile?.kind === "fund" ? profile : null;
  const name = fund?.name ?? daily.candles?.name ?? ticker;

  return (
    <main className="wrap" id="main-content" tabIndex={-1}>
      <header className="head">
        <div className="head-row">
          <div>
            <div className="head-id">
              <h1 className="head-ticker">{ticker}</h1>
              <p className="head-name">{name}</p>
            </div>
            <div className="head-meta">
              <span className="label">Exchange-traded fund</span>
              {fund?.prospectus?.returns.indexName ? <span className="label">Tracks {fund.prospectus.returns.indexName}</span> : null}
              {fund ? <span className="label">CIK {Number(fund.identity.cik)} · {fund.identity.seriesId}</span> : null}
            </div>
          </div>
          <div className="price-block">
            <div className="price">{last != null ? writePrice(last, currency) : ABSENT}</div>
            <div className="price-change" data-dir={tone(change)}>{change == null ? ABSENT : `${signedPct(change, 2)} today`}</div>
          </div>
        </div>
      </header>

      {fund ? <KeyFigures fund={fund} /> : null}

      <section className="section" aria-labelledby="etf-price-title">
        <div className="section-head">
          <h2 className="label" id="etf-price-title">Price · {period.title.toLowerCase()}</h2>
          <div className="seg" role="group" aria-label="Chart range">
            {RANGES.map((id) => <button key={id} type="button" aria-pressed={range === id} onClick={() => setRange(id)}>{id}</button>)}
          </div>
        </div>
        <div className="etf-chart">
          <CandleChart candles={candles.candles} interval={period.interval} loading={candles.loading} error={candles.error} openOn={openOn || undefined} label={`${ticker}, ${period.title.toLowerCase()}`} />
        </div>
      </section>

      {loaded.kind === "loading" ? <p className="state"><span className="pulse" />Reading the fund&apos;s filings</p> : null}
      {loaded.kind === "failed" ? <div className="state"><p>{loaded.message}</p></div> : null}
      {profile?.kind === "unreported" ? <div className="state"><p>{profile.reason}</p></div> : null}

      {fund?.prospectus ? <Returns fund={fund} /> : null}
      {fund?.portfolio ? <Exposures fund={fund} /> : null}
      {fund?.portfolio ? <Holdings fund={fund} all={allHoldings} onAll={() => setAllHoldings((value) => !value)} /> : null}
      {fund ? <About fund={fund} /> : null}
    </main>
  );
}

function KeyFigures({ fund }: { fund: EtfProfile }) {
  const fees = fund.prospectus;
  const average = (years: number) => fees?.returns.average.find((entry) => entry.years === years) ?? null;
  const figures: Array<{ label: string; value: string; note?: string; dir?: string }> = [
    { label: "Expense ratio", value: pct(fees?.expenseRatio), note: fees?.managementFee != null ? `Management ${pct(fees.managementFee)}` : undefined },
    { label: "Net assets", value: fund.portfolio?.netAssets != null ? money(fund.portfolio.netAssets, "USD") : ABSENT, note: fund.portfolio ? `At ${shortDate(fund.portfolio.asOf)}` : undefined },
    { label: "Holdings", value: fund.portfolio ? fund.portfolio.holdingsCount.toLocaleString("en-US") : ABSENT, note: fund.topTenWeight != null ? `Top ten ${pct(fund.topTenWeight, 1)}` : undefined },
    { label: "Turnover", value: pct(fees?.turnover, 0), note: "Of the portfolio, last fiscal year" },
    ...[1, 5, 10].map((years) => {
      const entry = average(years);
      return {
        label: years === 1 ? "Return · 1 year" : `Return · ${years}Y a year`, value: signedPct(entry?.fund), dir: tone(entry?.fund),
        note: entry?.index != null ? `Index ${signedPct(entry.index)}` : "At net asset value",
      };
    }),
  ];
  return (
    <div className="grid-ruled stats etf-stats">
      {figures.map((figure) => (
        <div className="stat" key={figure.label}>
          <div className="label">{figure.label}</div>
          <div className="stat-value num" data-dir={figure.dir}>{figure.value}</div>
          {figure.note ? <div className="stat-note">{figure.note}</div> : null}
        </div>
      ))}
    </div>
  );
}

function Returns({ fund }: { fund: EtfProfile }) {
  const returns = fund.prospectus!.returns;
  const extreme = Math.max(0.01, ...returns.calendar.map((entry) => Math.abs(entry.fund)));
  return (
    <section className="section" aria-labelledby="etf-returns-title">
      <div className="section-head">
        <h2 className="label" id="etf-returns-title">Total return by calendar year · at net asset value</h2>
        <span className="stat-note">
          {returns.best ? `Best quarter ${signedPct(returns.best.value)} (${shortDate(returns.best.date)})` : ""}
          {returns.worst ? ` · worst ${signedPct(returns.worst.value)} (${shortDate(returns.worst.date)})` : ""}
        </span>
      </div>
      <div className="etf-years" role="img" aria-label={`Calendar-year returns: ${returns.calendar.map((entry) => `${entry.year} ${signedPct(entry.fund)}`).join(", ")}`}>
        {returns.calendar.map((entry) => (
          <div key={entry.year} className="etf-year" data-dir={tone(entry.fund)}>
            <span className="etf-year-value num">{signedPct(entry.fund)}</span>
            <span className="etf-year-track">
              <span className="etf-year-bar" style={{ height: `${(Math.abs(entry.fund) / extreme) * 50}%`, [entry.fund >= 0 ? "bottom" : "top"]: "50%" } as CSSProperties} />
            </span>
            <span className="etf-year-label">{entry.year}</span>
          </div>
        ))}
      </div>
      {returns.average.length ? (
        <div className="sheet etf-average">
          <table>
            <thead><tr><th className="key">Average a year</th>{returns.average.map((entry) => <th key={entry.years}>{entry.years} year{entry.years > 1 ? "s" : ""}</th>)}</tr></thead>
            <tbody>
              <tr><th className="key" scope="row">{fund.ticker} at NAV</th>{returns.average.map((entry) => <td key={entry.years} data-dir={tone(entry.fund)}>{signedPct(entry.fund, 2)}</td>)}</tr>
              {returns.indexName ? <tr><th className="key" scope="row">{returns.indexName}</th>{returns.average.map((entry) => <td key={entry.years}>{signedPct(entry.index, 2)}</td>)}</tr> : null}
              {returns.indexName ? <tr><th className="key" scope="row">Difference</th>{returns.average.map((entry) => <td key={entry.years} data-dir={tone(entry.fund != null && entry.index != null ? entry.fund - entry.index : null)}>{entry.fund != null && entry.index != null ? signedPct(entry.fund - entry.index, 2) : ABSENT}</td>)}</tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="stat-note">From the prospectus filed {shortDate(fund.prospectus!.filed)}: returns to the end of the last calendar year, after the fund&apos;s costs.</p>
    </section>
  );
}

function Bars({ title, rows, colors, note }: { title: string; rows: Exposure[]; colors?: Map<string, string>; note?: string }) {
  if (!rows.length) return null;
  const top = Math.max(0.0001, ...rows.map((row) => row.weight));
  return (
    <section className="etf-exposure" aria-label={title}>
      <h3 className="label">{title}</h3>
      {rows.map((row) => (
        <div key={row.label} className="etf-bar" style={{ "--bar": colors?.get(row.label) ?? "var(--plot)" } as CSSProperties}>
          <span className="etf-bar-name">{colors ? <i aria-hidden="true" /> : null}{row.label}</span>
          <span className="etf-bar-track"><span style={{ width: `${(Math.max(0, row.weight) / top) * 100}%` }} /></span>
          <span className="etf-bar-value num">{pct(row.weight, 1)}</span>
        </div>
      ))}
      {note ? <p className="stat-note">{note}</p> : null}
    </section>
  );
}

function Exposures({ fund }: { fund: EtfProfile }) {
  const colors = useMemo(() => sectorColors(fund.exposure.sector.map((entry) => entry.label)), [fund]);
  const equity = fund.exposure.assetClass.find((entry) => entry.label === "Equity")?.weight ?? 0;
  return (
    <section className="section" aria-labelledby="etf-exposure-title">
      <div className="section-head">
        <h2 className="label" id="etf-exposure-title">Where the money is</h2>
        <span className="stat-note">Positions at {shortDate(fund.portfolio!.asOf)}, as the fund reported them</span>
      </div>
      <div className="etf-exposures">
        {/* Only where most of the fund could be classified: a sector chart of a fifth of a fund is a chart of the wrong thing. */}
        {equity > 0.2 && fund.sectorCoverage >= 0.25 ? (
          <Bars title="Sector" rows={fund.exposure.sector} colors={colors}
            note={`${pct(fund.sectorCoverage, 0)} of the fund matched to a company this site reads; the rest is unclassified.`} />
        ) : null}
        <Bars title="Asset class" rows={fund.exposure.assetClass} />
        <Bars title="Country" rows={fund.exposure.country} />
        <Bars title="Currency" rows={fund.exposure.currency} />
        <Bars title="Issuer" rows={fund.exposure.issuerType} />
      </div>
    </section>
  );
}

function Holdings({ fund, all, onAll }: { fund: EtfProfile; all: boolean; onAll: () => void }) {
  const holdings = fund.portfolio!.holdings;
  const shown = all ? holdings : holdings.slice(0, 25);
  const top = Math.max(0.0001, ...holdings.map((holding) => holding.weight));
  return (
    <section className="section" aria-labelledby="etf-holdings-title">
      <div className="section-head">
        <h2 className="label" id="etf-holdings-title">Holdings · {fund.portfolio!.holdingsCount.toLocaleString("en-US")} positions</h2>
        {holdings.length > 25 ? <button type="button" className="metric-toggle" onClick={onAll}>{all ? "Show the top 25" : `Show ${holdings.length}`}</button> : null}
      </div>
      <div className="sheet etf-holdings">
        <table>
          <thead><tr><th className="key">Holding</th><th>Weight</th><th data-drawn /><th>Value</th><th>Country</th><th>Class</th></tr></thead>
          <tbody>
            {shown.map((holding, index) => (
              <tr key={`${holding.isin ?? holding.name}-${index}`}>
                <th className="key" scope="row">
                  <span className="screener-rank">{index + 1}</span>
                  {holding.ticker ? <a className="key-open" href={`/s/${encodeURIComponent(holding.ticker)}`}>{holding.ticker}</a> : null}
                  <span className="etf-holding-name">{holding.name}</span>
                </th>
                <td>{pct(holding.weight, 2)}</td>
                <td data-drawn><span className="etf-weight"><span style={{ width: `${(Math.max(0, holding.weight) / top) * 100}%` }} /></span></td>
                <td>{money(holding.value, "USD")}</td>
                <td>{holding.country ?? ABSENT}</td>
                <td>{holding.assetClass}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function About({ fund }: { fund: EtfProfile }) {
  return (
    <section className="section" aria-labelledby="etf-about-title">
      <div className="section-head"><h2 className="label" id="etf-about-title">What it sets out to do</h2></div>
      {fund.prospectus?.objective ? <p className="etf-objective">{fund.prospectus.objective}</p> : <p className="stat-note">The prospectus states no objective in a form that can be read here.</p>}
      {fund.portfolio?.monthlyReturns.length ? (
        <p className="stat-note">Monthly total return, last reported: {fund.portfolio.monthlyReturns.map((entry) => `${entry.month} ${signedPct(entry.value)}`).join(" · ")}</p>
      ) : null}
      <footer className="foot">
        <span className="label">Sources</span>
        {fund.portfolio ? <a className="label" href={fund.portfolio.url} target="_blank" rel="noreferrer">SEC N-PORT · positions at {shortDate(fund.portfolio.asOf)}, filed {shortDate(fund.portfolio.filed)}</a> : <span className="label">No portfolio report found</span>}
        {fund.prospectus ? <a className="label" href={fund.prospectus.url} target="_blank" rel="noreferrer">Prospectus · filed {shortDate(fund.prospectus.filed)}</a> : <span className="label">No XBRL prospectus found</span>}
      </footer>
    </section>
  );
}
