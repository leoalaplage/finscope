"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { flowSince, monthlyFlows, type EtfProfile, type Exposure, type NotReported } from "@/lib/adapters/etf";
import type { Range } from "./ranges";
import { growthOf, monthlyTable } from "@/lib/io/fund-analytics";
import { layoutMap, SECTOR_HEADER } from "@/lib/term/heatmap-layout";
import { useWidth } from "@/components/term/use-width";
import { Panel } from "@/components/term/Panel";
import { MarketPriceSection } from "./PriceSection";
import { sectorColors } from "@/lib/watchlist-bubbles";
import { useCandles } from "./CandleChart";
import { About } from "./About";
import { FundScoreBody, QualityBody, RiskBody, useFundAnalytics } from "./EtfAnalytics";
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
type Surface = "site" | "terminal";

const pct = (value: number | null | undefined, places = 2) => (value == null || !Number.isFinite(value) ? ABSENT : `${(value * 100).toFixed(places)}%`);
const signedPct = (value: number | null | undefined, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(places)}%`);
const tone = (value: number | null | undefined) => (value == null ? undefined : value >= 0 ? "up" : "down");
const signedMoney = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? ABSENT : `${value >= 0 ? "+" : "−"}${money(Math.abs(value), "USD")}`);

/**
 * One block of the page: a section with its heading on the site, a coded panel
 * in the terminal — the same content either way, so the two surfaces read one
 * fund the same way their company pages read one company.
 */
function Box({ surface, code, title, note, actions, span = "full", children }: {
  surface: Surface; code: string; title: string; note?: string; actions?: ReactNode; span?: "full" | "half" | "wide" | "side"; children: ReactNode;
}) {
  if (surface === "terminal") {
    return (
      <div className="etf-cell" data-span={span}>
        <Panel code={code} title={title} actions={actions}>
          <div className="etf-pad">{children}{note ? <p className="t-dim etf-box-note">{note}</p> : null}</div>
        </Panel>
      </div>
    );
  }
  return (
    <section className="etf-cell etf-box" data-span={span} aria-label={title}>
      <div className="section-head">
        <h2 className="label">{title}</h2>
        {actions}
      </div>
      {children}
      {note ? <p className="stat-note etf-box-note">{note}</p> : null}
    </section>
  );
}

export function Etf({ ticker, surface = "site" }: { ticker: string; surface?: Surface }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [range, setRange] = useState<Range>("1Y");
  const [allHoldings, setAllHoldings] = useState(false);
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
  const profile = loaded.kind === "ready" ? loaded.profile : null;
  const fund = profile?.kind === "fund" ? profile : null;
  const name = fund?.name ?? daily.candles?.name ?? ticker;
  const meta = [
    "Exchange-traded fund",
    fund?.prospectus?.returns.indexName ? `Tracks ${fund.prospectus.returns.indexName}` : null,
    fund?.identity ? `CIK ${Number(fund.identity.cik)} · ${fund.identity.seriesId}` : null,
    fund?.holdingsSource ? `Holdings ${fund.holdingsSource.kind === "issuer" ? "from the issuer's daily file" : "from the SEC's N-PORT"} · ${shortDate(fund.holdingsSource.asOf)}` : null,
  ].filter((part): part is string => part != null);

  const head = surface === "terminal" ? (
    <header className="t-head">
      <h1 className="t-head-ticker">{ticker}</h1>
      <div>
        <p className="t-head-name">{name}</p>
        <div className="t-head-meta">{meta.map((part) => <span key={part}>{part}</span>)}</div>
      </div>
      <div className="t-head-price">
        <span className="t-head-last">{last != null ? writePrice(last, currency) : ABSENT}</span>
        <span className="t-head-move" data-dir={tone(change)}>{change == null ? ABSENT : signedPct(change, 2)}</span>
      </div>
    </header>
  ) : (
    <header className="head">
      <div className="head-row">
        <div>
          <div className="head-id">
            <h1 className="head-ticker">{ticker}</h1>
            <p className="head-name">{name}</p>
          </div>
          <div className="head-meta">{meta.map((part) => <span key={part} className="label">{part}</span>)}</div>
        </div>
        <div className="price-block">
          <div className="price">{last != null ? writePrice(last, currency) : ABSENT}</div>
          <div className="price-change" data-dir={tone(change)}>{change == null ? ABSENT : `${signedPct(change, 2)} today`}</div>
        </div>
      </div>
    </header>
  );

  const body = (
    <>
      {/* What it is, first: the prospectus's objective, or the trust's own description where it files none. */}
      {fund?.prospectus?.objective
        ? <About ticker={ticker} fallback={{ text: fund.prospectus.objective, source: `Prospectus filed ${shortDate(fund.prospectus.filed)} · the fund's own words`, url: fund.prospectus.url }} />
        : profile ? <About ticker={ticker} /> : null}
      <div className="etf-grid">
        <Box surface={surface} code="GP" title="Price" span="wide">
          <MarketPriceSection ticker={ticker} currency={currency} range={range} onRange={setRange} chartPage={surface === "terminal" ? "/t/chart" : "/chart"} surface={surface} />
        </Box>
        {fund
          ? <FundView fund={fund} surface={surface} allHoldings={allHoldings} onAll={() => setAllHoldings((value) => !value)} />
          : <div className="etf-cell" data-span="side"><Box surface={surface} code="DES" title="Key statistics" span="side"><p className="stat-note">{loaded.kind === "failed" ? loaded.message : profile?.kind === "unreported" ? profile.reason : "Reading the fund's filings…"}</p></Box></div>}
      </div>
    </>
  );

  return surface === "terminal" ? <>{head}<div className="etf-term">{body}</div></> : <main className="wrap" id="main-content" tabIndex={-1}>{head}{body}</main>;
}

type Analytics = ReturnType<typeof useFundAnalytics>;

/** The fund once read: its analysis computed once, for the side column and the sections below. */
function FundView({ fund, surface, allHoldings, onAll }: { fund: EtfProfile; surface: Surface; allHoldings: boolean; onAll: () => void }) {
  const analytics = useFundAnalytics(fund);
  return (
    <>
      <div className="etf-cell" data-span="side"><KeyFigures fund={fund} surface={surface} analytics={analytics} /></div>
      <FundSections fund={fund} surface={surface} analytics={analytics} allHoldings={allHoldings} onAll={onAll} />
    </>
  );
}

/** The fund's figures and analysis, in pairs where two read together. */
function FundSections({ fund, surface, analytics, allHoldings, onAll }: { fund: EtfProfile; surface: Surface; analytics: Analytics; allHoldings: boolean; onAll: () => void }) {
  const holdings = fund.portfolio?.holdings ?? [];
  const growth = analytics.weekly && analytics.benchmark ? growthOf(analytics.weekly, analytics.benchmark) : [];
  const months = analytics.weekly ? monthlyTable(analytics.weekly) : [];
  return (
    <>
      {fund.prospectus?.returns.calendar.length ? (
        <Box surface={surface} code="TRA" title="Total return by calendar year" span="half"
          note={`At net asset value, after costs, from the prospectus filed ${shortDate(fund.prospectus.filed)}${fund.prospectus.returns.best ? ` · best quarter ${signedPct(fund.prospectus.returns.best.value)}, worst ${signedPct(fund.prospectus.returns.worst?.value)}` : ""}.`}>
          <CalendarYears fund={fund} />
        </Box>
      ) : null}
      {holdings.length >= 5 ? (
        <Box surface={surface} code="HMAP" title={`Holdings map · the largest ${Math.min(60, holdings.length)} positions`} span="half"
          note={`Area: weight · colour: sector · ${pct(holdings.slice(60).reduce((sum, holding) => sum + Math.max(0, holding.weight), 0), 0)} of the fund is in the rest.`}>
          <HoldingsHeat fund={fund} scored={analytics.scored} />
        </Box>
      ) : null}
      {growth.length > 10 ? (
        <Box surface={surface} code="GRO" title="Growth of $10,000 · distributions reinvested" span="half" note={`Against the S&P 500 (SPY) over the same weeks, from ${shortDate(growth[0].date)}.`}>
          <GrowthChart points={growth} ticker={fund.ticker} />
        </Box>
      ) : null}
      {months.length ? (
        <Box surface={surface} code="MRET" title="Total return by month" span="half">
          <MonthTable rows={months.slice(0, 6)} />
        </Box>
      ) : null}
      {analytics.risk ? (
        <Box surface={surface} code="RISK" title="Risk and return" span="full"><RiskBody risk={analytics.risk} benchmark={analytics.benchmarkRisk} /></Box>
      ) : null}
      {fund.history.length > 20 ? <Box surface={surface} code="FLOW" title="Net flows · money created into and redeemed out of the fund" span={fund.commodity ? "half" : "full"}><FlowsBody fund={fund} /></Box> : null}
      {fund.commodity ? <Box surface={surface} code="CMDTY" title={`Holds physical ${fund.commodity.commodity.toLowerCase()}`} span={fund.history.length > 20 ? "half" : "full"}><CommodityBody fund={fund} /></Box> : null}
      {analytics.quality && analytics.quality.coverage >= 0.25 ? (
        <Box surface={surface} code="QUAL" title="What it holds, read as companies" span="full"><QualityBody quality={analytics.quality} /></Box>
      ) : null}
      {holdings.length ? <Box surface={surface} code="EXP" title="Where the money is" span="full"><ExposuresBody fund={fund} /></Box> : null}
      {holdings.length ? (
        <Box surface={surface} code="HDS" title={`Holdings · ${fund.portfolio!.holdingsCount.toLocaleString("en-US")} positions`} span="full"
          actions={holdings.length > 25 ? <button type="button" className={surface === "terminal" ? "t-chip" : "metric-toggle"} onClick={onAll}>{allHoldings ? "Top 25" : `All ${holdings.length}`}</button> : undefined}>
          <HoldingsTable fund={fund} all={allHoldings} />
        </Box>
      ) : null}
      <Box surface={surface} code="DES" title="How it invests" span="full"><HowItInvestsBody fund={fund} /></Box>
    </>
  );
}

/** The side column beside the price: the fund's statistics, then its score — as DES and SC sit beside a company's price. */
function KeyFigures({ fund, surface, analytics }: { fund: EtfProfile; surface: Surface; analytics: Analytics }) {
  const fees = fund.prospectus;
  const trust = fund.commodity;
  const latest = fund.history.at(-1);
  const assets = latest?.netAssets ?? fund.portfolio?.netAssets ?? trust?.netAssets ?? null;
  const average = (years: number) => fees?.returns.average.find((entry) => entry.years === years) ?? null;
  const rows: Array<[string, string, string?, string?]> = [
    ["Expense ratio", pct(fees?.expenseRatio ?? trust?.expenseRatio), fees?.managementFee != null ? `management ${pct(fees.managementFee)}` : trust ? "sponsor's fee" : fees ? undefined : "not in a filing read here"],
    ["Net assets", assets != null ? money(assets, "USD") : ABSENT, latest ? shortDate(latest.date) : fund.portfolio ? shortDate(fund.portfolio.asOf) : trust ? shortDate(trust.asOf) : undefined],
    ["Net flows · 1Y", latest ? signedMoney(flowSince(fund.history, 365)) : ABSENT, latest ? `1M ${signedMoney(flowSince(fund.history, 31))}` : undefined, tone(flowSince(fund.history, 365))],
    ["Holdings", fund.portfolio ? fund.portfolio.holdingsCount.toLocaleString("en-US") : trust ? `100% ${trust.commodity}` : ABSENT, fund.topTenWeight != null ? `top ten ${pct(fund.topTenWeight, 1)}` : undefined],
    ["Turnover", pct(fees?.turnover, 0), "last fiscal year"],
    ["Distributions · 1Y", signedPct(analytics.risk?.distributions), "total less price return", tone(analytics.risk?.distributions)],
    ["Volatility", pct(analytics.risk?.volatility, 1), analytics.benchmarkRisk ? `S&P 500 ${pct(analytics.benchmarkRisk.volatility, 1)}` : undefined],
    ["Beta", analytics.risk?.beta == null ? ABSENT : analytics.risk.beta.toFixed(2), "to the S&P 500"],
    ...[1, 5, 10].map((years) => {
      const entry = average(years);
      return [years === 1 ? "Return · 1Y (NAV)" : `Return · ${years}Y a year`, signedPct(entry?.fund), entry?.index != null ? `index ${signedPct(entry.index)}` : undefined, tone(entry?.fund)] as [string, string, string?, string?];
    }),
    ["Quality of holdings", analytics.quality?.total != null && analytics.quality.coverage >= 0.5 ? analytics.quality.total.toFixed(0) : ABSENT, analytics.quality ? `over ${pct(analytics.quality.coverage, 0)} of the fund` : undefined],
  ];
  const shown = rows.filter(([label, value]) => value !== ABSENT || label === "Expense ratio" || label === "Net assets");
  return (
    <>
      <Box surface={surface} code="DES" title="Key statistics" span="side">
        <dl className="etf-keys">
          {shown.map(([label, value, note, dir]) => (
            <div key={label}><dt>{label}</dt><dd className="num" data-dir={dir}>{value}{note ? <small>{note}</small> : null}</dd></div>
          ))}
        </dl>
      </Box>
      <Box surface={surface} code="SCORE" title="Tenqay fund score" span="side"><FundScoreBody score={analytics.score} /></Box>
    </>
  );
}

/** A year's return in a narrow box: whole per cent, "+33". */
const shortPct = (value: number) => `${value < 0 ? "−" : "+"}${Math.abs(value * 100).toFixed(0)}`;

function CalendarYears({ fund }: { fund: EtfProfile }) {
  const returns = fund.prospectus!.returns;
  const extreme = Math.max(0.01, ...returns.calendar.map((entry) => Math.abs(entry.fund)));
  return (
    <div className="etf-years" role="img" aria-label={`Calendar-year returns: ${returns.calendar.map((entry) => `${entry.year} ${signedPct(entry.fund)}`).join(", ")}`}>
      {returns.calendar.map((entry) => (
        <div key={entry.year} className="etf-year" data-dir={tone(entry.fund)}>
          {/* Two writings of each figure, the short one for a narrow box (app/io.css, @container). */}
          <span className="etf-year-value num"><span className="etf-long">{signedPct(entry.fund)}</span><span className="etf-short">{shortPct(entry.fund)}</span></span>
          <span className="etf-year-track">
            <span className="etf-year-bar" style={{ height: `${(Math.abs(entry.fund) / extreme) * 50}%`, [entry.fund >= 0 ? "bottom" : "top"]: "50%" } as CSSProperties} />
          </span>
          <span className="etf-year-label"><span className="etf-long">{entry.year}</span><span className="etf-short">&apos;{String(entry.year).slice(2)}</span></span>
        </div>
      ))}
    </div>
  );
}

/** The largest positions as a market map: one block per sector, a tile per position sized by weight, a colour per sector. */
function HoldingsHeat({ fund, scored }: { fund: EtfProfile; scored: Map<string, { note: string }> | null }) {
  const { ref, width } = useWidth();
  const height = 300;
  const top = (fund.portfolio?.holdings ?? []).filter((holding) => holding.weight > 0).slice(0, 60);
  const colors = useMemo(() => sectorColors((fund.portfolio?.holdings ?? []).map((holding) => holding.sector ?? holding.assetClass)), [fund]);
  const placed = width > 40 ? layoutMap(top.map((holding, index) => ({
    ticker: `${index}`, sector: holding.sector ?? holding.assetClass, industry: "", cap: holding.weight, holding,
  })), { x: 0, y: 0, width, height }, { industries: false }) : [];
  return (
    <div className="fund-heat" ref={ref} style={{ height }}>
      {placed.map((block) => (
        <div key={block.name} className="fund-heat-sector" style={{ left: block.x, top: block.y, width: block.width, height: block.height, "--tile": colors.get(block.name) ?? "var(--plot)" } as CSSProperties}>
          {block.header ? <div className="fund-heat-name" style={{ height: SECTOR_HEADER }}>{block.name}</div> : null}
          {block.industries.flatMap((industry) => industry.tiles).map((tile) => {
            const holding = tile.item.holding;
            const label = holding.ticker ?? holding.name.split(" ")[0];
            const grade = holding.ticker ? scored?.get(holding.ticker.replace(/[/-]/g, "."))?.note : undefined;
            const big = tile.width > 42 && tile.height > 26;
            return (
              <a key={tile.item.ticker} className="fund-heat-tile" href={holding.ticker ? `/s/${encodeURIComponent(holding.ticker)}` : undefined}
                title={`${holding.name} · ${pct(holding.weight, 2)} · ${block.name}${grade ? ` · grade ${grade}` : ""}`}
                style={{ left: tile.x - block.x, top: tile.y - block.y, width: tile.width, height: tile.height }}>
                {big ? <><b>{label}</b><span>{pct(holding.weight, 1)}</span></> : null}
              </a>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function GrowthChart({ points, ticker }: { points: Array<{ date: string; fund: number; benchmark: number | null }>; ticker: string }) {
  const { ref, width } = useWidth();
  const height = 240;
  const values = points.flatMap((point) => [point.fund, ...(point.benchmark != null ? [point.benchmark] : [])]);
  const low = Math.min(...values) * 0.97; const high = Math.max(...values) * 1.02;
  const x = (index: number) => (index / (points.length - 1)) * (width - 60);
  const y = (value: number) => 10 + (1 - (value - low) / (high - low)) * (height - 30);
  const line = (read: (point: typeof points[number]) => number | null) => points.map((point, index) => {
    const value = read(point);
    return value == null ? "" : `${index && read(points[index - 1]) != null ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`;
  }).join("");
  const last = points.at(-1)!;
  return (
    <div className="etf-growth" ref={ref}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={`$10,000 became ${money(last.fund, "USD")} in ${ticker}${last.benchmark != null ? ` and ${money(last.benchmark, "USD")} in the S&P 500` : ""}`}>
          <line x1={0} x2={width - 60} y1={y(10_000)} y2={y(10_000)} className="etf-growth-base" />
          <path d={line((point) => point.benchmark)} className="etf-growth-bench" />
          <path d={line((point) => point.fund)} className="etf-growth-fund" />
          <text x={width - 56} y={y(last.fund) + 4} className="etf-growth-label" data-fund>{money(last.fund, "USD")}</text>
          {last.benchmark != null ? <text x={width - 56} y={y(last.benchmark) + 4} className="etf-growth-label">{money(last.benchmark, "USD")}</text> : null}
        </svg>
      ) : null}
      <p className="etf-growth-key"><i data-fund /> {ticker} <i /> S&amp;P 500 (SPY)</p>
    </div>
  );
}

const MONTH_NAMES = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
function MonthTable({ rows }: { rows: Array<{ year: number; months: Array<number | null>; year_total: number | null }> }) {
  const heat = (value: number | null) => (value == null ? undefined : ({ background: `color-mix(in srgb, ${value >= 0 ? "var(--gain)" : "var(--loss)"} ${Math.round(Math.min(1, Math.abs(value) / 0.08) * 55)}%, transparent)` } as CSSProperties));
  return (
    <div className="sheet etf-months">
      <table>
        <thead><tr><th className="key">Year</th>{MONTH_NAMES.map((name, index) => <th key={index}>{name}</th>)}<th>Year</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <th className="key" scope="row">{row.year}</th>
              {row.months.map((value, index) => <td key={index} style={heat(value)}>{value == null ? "" : (value * 100).toFixed(1)}</td>)}
              <td data-dir={tone(row.year_total)}><b>{signedPct(row.year_total)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Money in and out, month by month, from the shares outstanding each day (lib/adapters/etf.ts). */
function FlowsBody({ fund }: { fund: EtfProfile }) {
  const months = monthlyFlows(fund.history).slice(-24);
  const extreme = Math.max(1, ...months.map((entry) => Math.abs(entry.flow)));
  const lastDate = fund.history.at(-1)!.date;
  const spans: Array<[string, number]> = [["1 month", 31], ["3 months", 92], ["Year to date", Math.ceil((Date.parse(lastDate) - Date.parse(`${lastDate.slice(0, 4)}-01-01`)) / 86_400_000)], ["1 year", 365], ["3 years", 1096]];
  return (
    <>
      <div className="etf-flow-sums">
        {spans.map(([label, days]) => {
          const value = flowSince(fund.history, days);
          return <div key={label}><span className="label">{label}</span><b className="num" data-dir={tone(value)}>{signedMoney(value)}</b></div>;
        })}
      </div>
      <div className="etf-years etf-flows" role="img" aria-label={`Monthly net flows: ${months.map((entry) => `${entry.month} ${signedMoney(entry.flow)}`).join(", ")}`}>
        {months.map((entry, index) => (
          <div key={entry.month} className="etf-year" data-dir={tone(entry.flow)} data-tick={(months.length - 1 - index) % 3 === 0 || undefined} title={`${entry.month}: ${signedMoney(entry.flow)}`}>
            <span className="etf-year-value num">{Math.abs(entry.flow) >= extreme * 0.35 ? signedMoney(entry.flow) : ""}</span>
            <span className="etf-year-track">
              <span className="etf-year-bar" style={{ height: `${(Math.abs(entry.flow) / extreme) * 50}%`, [entry.flow >= 0 ? "bottom" : "top"]: "50%" } as CSSProperties} />
            </span>
            <span className="etf-year-label">{entry.month.slice(2).replace("-", "/")}</span>
          </div>
        ))}
      </div>
      <p className="stat-note">Daily change in shares outstanding × NAV, from the issuer&apos;s file, to {shortDate(lastDate)}.</p>
    </>
  );
}

/** A trust whose whole portfolio is one physical commodity (GLD, IAU, SLV). */
function CommodityBody({ fund }: { fund: EtfProfile }) {
  const trust = fund.commodity!;
  const extreme = Math.max(1, ...trust.flows.map((entry) => Math.max(entry.created, entry.redeemed)));
  return (
    <>
      <dl className="etf-keys">
        <div><dt>Portfolio</dt><dd className="num">100% {trust.commodity}<small>bullion held for the trust</small></dd></div>
        <div><dt>NAV per share</dt><dd className="num">{trust.navPerShare != null ? writePrice(trust.navPerShare, "USD") : ABSENT}</dd></div>
        <div><dt>Shares outstanding</dt><dd className="num">{trust.shares != null ? `${(trust.shares / 1e6).toFixed(1)}M` : ABSENT}</dd></div>
      </dl>
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
      <p className="stat-note">From the trust&apos;s own report for the period to {shortDate(trust.asOf)}, filed {shortDate(trust.filed)}.</p>
    </>
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

/** The largest few, the rest summed as "Other": the profile keeps every sector, a chart has room for a dozen. */
function largestWithOther(rows: Exposure[], limit: number): Exposure[] {
  if (rows.length <= limit) return rows;
  const rest = rows.slice(limit - 1).reduce((sum, entry) => sum + entry.weight, 0);
  return [...rows.slice(0, limit - 1), { label: "Other", weight: rest }];
}

function ExposuresBody({ fund }: { fund: EtfProfile }) {
  const colors = useMemo(() => sectorColors((fund.portfolio?.holdings ?? []).map((holding) => holding.sector ?? holding.assetClass)), [fund]);
  // An issuer's file names no asset class; its listed securities are read as the shares they are for this test only.
  const equity = fund.exposure.assetClass.filter((entry) => entry.label === "Equity" || entry.label === "Listed security").reduce((sum, entry) => sum + entry.weight, 0);
  return (
    <>
      <div className="etf-exposures">
        {/* Only where most of the fund could be classified: a sector chart of a fifth of a fund is a chart of the wrong thing. */}
        {equity > 0.2 && fund.sectorCoverage >= 0.25 ? (
          <Bars title="Sector" rows={largestWithOther(fund.exposure.sector, 12)} colors={colors}
            note={`${pct(fund.sectorCoverage, 0)} of the fund matched to a company this site reads; the rest is unclassified.`} />
        ) : null}
        <Bars title="Asset class" rows={fund.exposure.assetClass} />
        <Bars title="Country" rows={fund.exposure.country} />
        <Bars title="Currency" rows={fund.exposure.currency} />
        <Bars title="Issuer" rows={fund.exposure.issuerType} />
      </div>
      <p className="stat-note">Positions at {shortDate(fund.portfolio!.asOf)}, {fund.holdingsSource?.kind === "issuer" ? "from the issuer's daily file; country and class from the fund's last SEC report where the security is in it" : "as the fund reported them to the SEC"}.</p>
    </>
  );
}

function HoldingsTable({ fund, all }: { fund: EtfProfile; all: boolean }) {
  const holdings = fund.portfolio!.holdings;
  const shown = all ? holdings : holdings.slice(0, 25);
  const top = Math.max(0.0001, ...holdings.map((holding) => holding.weight));
  const colors = useMemo(() => sectorColors(holdings.map((holding) => holding.sector ?? holding.assetClass)), [holdings]);
  return (
    <div className="sheet etf-holdings">
      <table>
        <thead><tr><th className="key">Holding</th><th className="key">Sector</th><th>Weight</th><th data-drawn /><th>Value</th><th>Country</th></tr></thead>
        <tbody>
          {shown.map((holding, index) => (
            <tr key={`${holding.isin ?? holding.name}-${index}`}>
              <th className="key" scope="row">
                <span className="screener-rank">{index + 1}</span>
                {holding.ticker ? <a className="key-open" href={`/s/${encodeURIComponent(holding.ticker)}`}>{holding.ticker}</a> : null}
                <span className="etf-holding-name">{holding.name}</span>
              </th>
              <td className="key"><span className="qs-sector-tag"><i style={{ background: colors.get(holding.sector ?? holding.assetClass) }} />{holding.sector ?? holding.assetClass}</span></td>
              <td>{pct(holding.weight, 2)}</td>
              <td data-drawn><span className="etf-weight"><span style={{ width: `${(Math.max(0, holding.weight) / top) * 100}%` }} /></span></td>
              <td>{money(holding.value, "USD")}</td>
              <td>{holding.country ?? ABSENT}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HowItInvestsBody({ fund }: { fund: EtfProfile }) {
  return (
    <>
      {fund.prospectus?.strategy ? <p className="etf-objective">{fund.prospectus.strategy}</p> : fund.prospectus?.objective ? <p className="etf-objective">{fund.prospectus.objective}</p> : <p className="stat-note">The fund files no prospectus in a form that can be read here.</p>}
      {fund.prospectus?.risks.length ? (
        <details className="etf-risks">
          <summary className="label">Principal risks · {fund.prospectus.risks.length}, as the prospectus names them</summary>
          <dl>
            {fund.prospectus.risks.map((risk) => <div key={risk.name}><dt>{risk.name}</dt><dd>{risk.text}</dd></div>)}
          </dl>
        </details>
      ) : null}
      <div className="etf-sources">
        <span className="label">Sources</span>
        {fund.holdingsSource?.kind === "issuer" ? <a className="label" href={fund.holdingsSource.url} target="_blank" rel="noreferrer">Issuer&apos;s daily holdings · {shortDate(fund.holdingsSource.asOf)}</a> : null}
        {fund.holdingsSource?.kind === "N-PORT" ? <a className="label" href={fund.holdingsSource.url} target="_blank" rel="noreferrer">SEC N-PORT · positions at {shortDate(fund.holdingsSource.asOf)}</a> : null}
        {fund.commodity ? <span className="label">SEC 10-K / 10-Q · period to {shortDate(fund.commodity.asOf)}</span> : null}
        {fund.prospectus ? <a className="label" href={fund.prospectus.url} target="_blank" rel="noreferrer">Prospectus · filed {shortDate(fund.prospectus.filed)}</a> : null}
      </div>
    </>
  );
}
