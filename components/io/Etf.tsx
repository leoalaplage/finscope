"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { flowSince, monthlyFlows, type EtfProfile, type Exposure, type NotReported } from "@/lib/adapters/etf";
import { candlesInRange, CHART_RANGES, type ChartRange } from "@/lib/io/chart-ranges";
import { sectorColors } from "@/lib/watchlist-bubbles";
import { CandleChart, useCandles } from "./CandleChart";
import { About } from "./About";
import { EtfAnalytics } from "./EtfAnalytics";
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
const signedMoney = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? ABSENT : `${value >= 0 ? "+" : "−"}${money(Math.abs(value), "USD")}`);

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
              {fund?.identity ? <span className="label">CIK {Number(fund.identity.cik)} · {fund.identity.seriesId}</span> : null}
              {fund?.holdingsSource ? (
                <span className="label">
                  Holdings {fund.holdingsSource.kind === "issuer" ? "from the issuer's daily file" : "from the SEC's N-PORT"} · {shortDate(fund.holdingsSource.asOf)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="price-block">
            <div className="price">{last != null ? writePrice(last, currency) : ABSENT}</div>
            <div className="price-change" data-dir={tone(change)}>{change == null ? ABSENT : `${signedPct(change, 2)} today`}</div>
          </div>
        </div>
      </header>

      {/* What it is, first: the prospectus's objective, or the trust's own description where it files none. */}
      {fund?.prospectus?.objective
        ? <About ticker={ticker} fallback={{ text: fund.prospectus.objective, source: `Prospectus filed ${shortDate(fund.prospectus.filed)} · the fund's own words`, url: fund.prospectus.url }} />
        : profile ? <About ticker={ticker} /> : null}
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

      {fund ? <EtfAnalytics fund={fund} /> : null}
      {fund?.commodity ? <Commodity fund={fund} /> : null}
      {fund && fund.history.length > 20 ? <Flows fund={fund} /> : null}
      {fund?.prospectus ? <Returns fund={fund} /> : null}
      {fund?.portfolio && fund.portfolio.holdings.length ? <Exposures fund={fund} /> : null}
      {fund?.portfolio && fund.portfolio.holdings.length ? <Holdings fund={fund} all={allHoldings} onAll={() => setAllHoldings((value) => !value)} /> : null}
      {fund ? <HowItInvests fund={fund} /> : null}
    </main>
  );
}

function KeyFigures({ fund }: { fund: EtfProfile }) {
  const fees = fund.prospectus;
  const average = (years: number) => fees?.returns.average.find((entry) => entry.years === years) ?? null;
  const trust = fund.commodity;
  const latest = fund.history.at(-1);
  const assets = latest?.netAssets ?? fund.portfolio?.netAssets ?? trust?.netAssets ?? null;
  const figures: Array<{ label: string; value: string; note?: string; dir?: string }> = [
    { label: "Expense ratio", value: pct(fees?.expenseRatio ?? trust?.expenseRatio), note: fees?.managementFee != null ? `Management ${pct(fees.managementFee)}` : trust ? "Sponsor's fee and expenses" : fees ? undefined : "Not stated in a filing read here" },
    { label: "Net assets", value: assets != null ? money(assets, "USD") : ABSENT, note: latest ? `At ${shortDate(latest.date)}` : fund.portfolio ? `At ${shortDate(fund.portfolio.asOf)}` : trust ? `At ${shortDate(trust.asOf)}` : undefined },
    ...(latest ? [{ label: "Net flows · 1Y", value: signedMoney(flowSince(fund.history, 365)), dir: tone(flowSince(fund.history, 365)), note: `1M ${signedMoney(flowSince(fund.history, 31))}` }] : []),
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
  // What does not apply to this fund is left out — a gold trust has no turnover — except the two every fund has.
  const shown = figures.filter((figure) => figure.value !== ABSENT || figure.label === "Expense ratio" || figure.label === "Net assets");
  return (
    <div className="grid-ruled stats etf-stats">
      {shown.map((figure) => (
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

/** Money in and out, month by month, from the shares outstanding each day (lib/adapters/etf.ts). */
function Flows({ fund }: { fund: EtfProfile }) {
  const months = monthlyFlows(fund.history).slice(-24);
  const extreme = Math.max(1, ...months.map((entry) => Math.abs(entry.flow)));
  const spans: Array<[string, number]> = [["1 month", 31], ["3 months", 92], ["Year to date", Math.ceil((Date.parse(fund.history.at(-1)!.date) - Date.parse(`${fund.history.at(-1)!.date.slice(0, 4)}-01-01`)) / 86_400_000)], ["1 year", 365], ["3 years", 1096]];
  return (
    <section className="section" aria-labelledby="etf-flows-title">
      <div className="section-head">
        <h2 className="label" id="etf-flows-title">Net flows · money created into and redeemed out of the fund</h2>
        <span className="stat-note">Daily change in shares outstanding × NAV, from the issuer&apos;s file, to {shortDate(fund.history.at(-1)!.date)}</span>
      </div>
      <div className="etf-flow-sums">
        {spans.map(([label, days]) => {
          const value = flowSince(fund.history, days);
          return <div key={label}><span className="label">{label}</span><b className="num" data-dir={tone(value)}>{signedMoney(value)}</b></div>;
        })}
      </div>
      <div className="etf-years etf-flows" role="img" aria-label={`Monthly net flows: ${months.map((entry) => `${entry.month} ${signedMoney(entry.flow)}`).join(", ")}`}>
        {months.map((entry) => (
          <div key={entry.month} className="etf-year" data-dir={tone(entry.flow)} title={`${entry.month}: ${signedMoney(entry.flow)}`}>
            <span className="etf-year-value num">{Math.abs(entry.flow) >= extreme * 0.35 ? signedMoney(entry.flow) : ""}</span>
            <span className="etf-year-track">
              <span className="etf-year-bar" style={{ height: `${(Math.abs(entry.flow) / extreme) * 50}%`, [entry.flow >= 0 ? "bottom" : "top"]: "50%" } as CSSProperties} />
            </span>
            <span className="etf-year-label">{entry.month.slice(2).replace("-", "/")}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** A trust whose whole portfolio is one physical commodity (GLD, IAU, SLV). */
function Commodity({ fund }: { fund: EtfProfile }) {
  const trust = fund.commodity!;
  const extreme = Math.max(1, ...trust.flows.map((entry) => Math.max(entry.created, entry.redeemed)));
  return (
    <section className="section" aria-labelledby="etf-commodity-title">
      <div className="section-head">
        <h2 className="label" id="etf-commodity-title">Holds physical {trust.commodity.toLowerCase()}</h2>
        <span className="stat-note">From the trust&apos;s own report for the period to {shortDate(trust.asOf)}, filed {shortDate(trust.filed)}</span>
      </div>
      <div className="grid-ruled stats stats-seven etf-stats">
        <div className="stat"><div className="label">Portfolio</div><div className="stat-value num">100% {trust.commodity}</div><div className="stat-note">Bullion held for the trust</div></div>
        <div className="stat"><div className="label">NAV per share</div><div className="stat-value num">{trust.navPerShare != null ? writePrice(trust.navPerShare, "USD") : ABSENT}</div></div>
        <div className="stat"><div className="label">Shares outstanding</div><div className="stat-value num">{trust.shares != null ? `${(trust.shares / 1e6).toFixed(1)}M` : ABSENT}</div></div>
      </div>
      {trust.flows.length ? (
        <div className="etf-exposure">
          <h3 className="label">Shares created and redeemed, by quarter</h3>
          {trust.flows.map((entry) => (
            <div key={entry.end} className="etf-bar etf-bar-pair">
              <span className="etf-bar-name">{shortDate(entry.end)}</span>
              <span className="etf-bar-track" data-dir="up"><span style={{ width: `${(entry.created / extreme) * 100}%` }} /></span>
              <span className="etf-bar-value num">+{money(entry.created, "USD")}</span>
              <span className="etf-bar-track" data-dir="down"><span style={{ width: `${(entry.redeemed / extreme) * 100}%` }} /></span>
              <span className="etf-bar-value num">−{money(entry.redeemed, "USD")}</span>
            </div>
          ))}
        </div>
      ) : null}
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
  // An issuer's file names no asset class; its listed securities are read as the shares they are for this test only.
  const equity = fund.exposure.assetClass.filter((entry) => entry.label === "Equity" || entry.label === "Listed security").reduce((sum, entry) => sum + entry.weight, 0);
  return (
    <section className="section" aria-labelledby="etf-exposure-title">
      <div className="section-head">
        <h2 className="label" id="etf-exposure-title">Where the money is</h2>
        <span className="stat-note">Positions at {shortDate(fund.portfolio!.asOf)}, {fund.holdingsSource?.kind === "issuer" ? "from the issuer's daily file; country and class from the fund's last SEC report where the security is in it" : "as the fund reported them to the SEC"}</span>
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

function HowItInvests({ fund }: { fund: EtfProfile }) {
  return (
    <section className="section" aria-labelledby="etf-about-title">
      <div className="section-head"><h2 className="label" id="etf-about-title">How it invests</h2></div>
      {fund.prospectus?.strategy ? <p className="etf-objective">{fund.prospectus.strategy}</p> : fund.prospectus?.objective ? <p className="etf-objective">{fund.prospectus.objective}</p> : <p className="stat-note">The fund files no prospectus in a form that can be read here.</p>}
      {fund.prospectus?.risks.length ? (
        <details className="etf-risks">
          <summary className="label">Principal risks · {fund.prospectus.risks.length}, as the prospectus names them</summary>
          <dl>
            {fund.prospectus.risks.map((risk) => <div key={risk.name}><dt>{risk.name}</dt><dd>{risk.text}</dd></div>)}
          </dl>
        </details>
      ) : null}
      {fund.portfolio?.monthlyReturns.length ? (
        <p className="stat-note">Monthly total return, last reported: {fund.portfolio.monthlyReturns.map((entry) => `${entry.month} ${signedPct(entry.value)}`).join(" · ")}</p>
      ) : null}
      <footer className="foot">
        <span className="label">Sources</span>
        {fund.holdingsSource?.kind === "issuer" ? <a className="label" href={fund.holdingsSource.url} target="_blank" rel="noreferrer">Issuer&apos;s daily holdings · {shortDate(fund.holdingsSource.asOf)}</a> : null}
        {fund.holdingsSource?.kind === "N-PORT" ? <a className="label" href={fund.holdingsSource.url} target="_blank" rel="noreferrer">SEC N-PORT · positions at {shortDate(fund.holdingsSource.asOf)}, filed {shortDate(fund.portfolio?.filed)}</a> : null}
        {fund.commodity ? <span className="label">SEC 10-K / 10-Q · period to {shortDate(fund.commodity.asOf)}</span> : null}
        {fund.prospectus ? <a className="label" href={fund.prospectus.url} target="_blank" rel="noreferrer">Prospectus · filed {shortDate(fund.prospectus.filed)}</a> : null}
      </footer>
    </section>
  );
}
