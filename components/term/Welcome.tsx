"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { COMPANY_FUNCTIONS, GLOBAL_FUNCTIONS, hrefFor, parseCommand } from "@/lib/term/command";
import { useStoredWatchlist, writeWatchlist } from "@/components/io/watchlist";
import { useAccount } from "@/components/io/account";
import { useCompany } from "@/components/io/use-company";
import { compact, delta, money, price } from "@/components/io/format";
import { readPrefs, START_SCREENS, writePrefs } from "./prefs";
import { Indices } from "./Indices";
import { Heatmap } from "./Heatmap";
import { EconBrief } from "./Economy";
import { AlertsBrief } from "./Alerts";
import { FedPanel, SignalsPanel, useHomeData } from "./Home";
import { useTape } from "./quotes";
import { useWidth } from "./use-width";

/**
 * TOUR: the first visit, shown more than told — every step is one line over
 * the terminal's own live panels: the market now, the command line to try,
 * the screens as they stand today, a company's price and ten years of filed
 * figures, the watchlist with today's prices, the alerts as they fire. Opened
 * once on a first visit (components/term/Launchpad.tsx, ONBOARDED_KEY);
 * always on /t/welcome, TOUR, or SET.
 */

export const ONBOARDED_KEY = "finscope.term.onboarded.v1";
export const markOnboarded = () => { try { localStorage.setItem(ONBOARDED_KEY, new Date().toISOString()); } catch { /* Shown again next time. */ } };

const STEPS = ["Welcome", "Command line", "Screens", "Hard-to-find data", "A company", "Your list", "Alerts", "Ready"] as const;
const TRY = ["AAPL GP", "NVDA DCF", "DAL KPI", "ECO", "MSFT EE"];
/** What each chapter of a company page holds, in the reader's words. */
const CHAPTERS: Array<{ title: string; holds: string }> = [
  { title: "Snapshot", holds: "Price, key statistics, quality grade, description" },
  { title: "Business", holds: "Segments, geography, operating KPIs, 10 years of figures" },
  { title: "Results", holds: "Last quarter vs consensus, estimates, reaction, seasonality" },
  { title: "Valuation", holds: "Multiples in history, peers, your own DCF, dividends" },
  { title: "Ownership", holds: "Insider trades (Form 4), 13F institutional holders" },
  { title: "Record", holds: "Debt maturities, 8-K events, your notes, every statement" },
];

/** What is inside, beyond the screens: the features a reader would otherwise pay for or piece together. */
const FEATURES: Array<{ code: string; title: string; line: string }> = [
  { code: "KPI", title: "Operating KPIs", line: "Seat miles, bookings, members — read from releases" },
  { code: "SEG", title: "Segments", line: "Revenue and profit by business and region" },
  { code: "INSB", title: "Insider clusters", line: "Several insiders buying the same week" },
  { code: "HDS", title: "13F holders", line: "Who owns it, who added, who sold" },
  { code: "DDIS", title: "Debt wall", line: "What falls due, year by year, from the 10-K" },
  { code: "DCF", title: "Your DCF", line: "Your assumptions, a sensitivity grid, saved" },
  { code: "ERX", title: "Earnings reaction", line: "How the stock moved after each release" },
  { code: "EST", title: "Consensus", line: "EPS estimates, revisions, price targets" },
  { code: "EVT", title: "8-K events", line: "Leadership changes, deals, red flags" },
  { code: "FED", title: "Fed odds", line: "Each FOMC meeting, priced from futures" },
  { code: "SCRN", title: "Screener", line: "1,000 US stocks on filings and technicals" },
  { code: "BT", title: "Backtest", line: "Test a rule on years of daily prices" },
];

export function Welcome() {
  const [step, setStep] = useState(0);
  const last = STEPS.length - 1;
  const go = (next: number) => setStep(Math.max(0, Math.min(last, next)));
  const finish = (href = "/t") => { markOnboarded(); window.location.assign(href); };
  // Seen is enough: a reader who leaves halfway is not sent back to it on every visit.
  useEffect(() => { markOnboarded(); }, []);
  // ← and → walk the tour, unless a field has the keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("input, select, textarea")) return;
      if (event.key === "ArrowRight") setStep((current) => Math.min(last, current + 1));
      if (event.key === "ArrowLeft") setStep((current) => Math.max(0, current - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  return (
    <div className="t-wel">
      <header className="t-wel-head">
        <span className="t-code">TOUR</span>
        <ol className="t-wel-steps" aria-label="Steps">
          {STEPS.map((name, index) => (
            <li key={name} data-state={index === step ? "now" : index < step ? "done" : undefined}>
              <button type="button" onClick={() => go(index)} aria-current={index === step ? "step" : undefined}><b>{index + 1}</b><span>{name}</span></button>
            </li>
          ))}
        </ol>
        <button type="button" className="t-chip" onClick={() => finish()}>Skip</button>
      </header>

      <section className="t-wel-body" aria-live="polite">
        {step === 0 ? <Intro /> : null}
        {step === 1 ? <CommandStep /> : null}
        {step === 2 ? <ScreensStep /> : null}
        {step === 3 ? <DataStep /> : null}
        {step === 4 ? <CompanyStep /> : null}
        {step === 5 ? <ListStep /> : null}
        {step === 6 ? <AlertsStep /> : null}
        {step === 7 ? <ReadyStep onFinish={finish} /> : null}
      </section>

      <footer className="t-wel-foot">
        <button type="button" className="t-chip" onClick={() => go(step - 1)} disabled={step === 0}>← Back</button>
        <span className="t-dim">{step + 1} / {STEPS.length}</span>
        {step < last
          ? <button type="button" className="t-chip t-wel-next" onClick={() => go(step + 1)}>{STEPS[step + 1]} →</button>
          : <button type="button" className="t-chip t-wel-next" onClick={() => finish()}>Open the terminal →</button>}
      </footer>
    </div>
  );
}

/** One line over each step: what it is, in a sentence. */
function Lead({ title, children }: { title: string; children: ReactNode }) {
  return <div className="t-wel-lead"><h2>{title}</h2><p>{children}</p></div>;
}

/** A live panel of the terminal, framed and named by its code. */
function Live({ code, title, href, children }: { code: string; title: string; href?: string; children: ReactNode }) {
  return (
    <div className="t-wel-live">
      <header>
        <span className="t-code">{code}</span><span>{title}</span>
        {href ? <a href={href} target="_blank" rel="noreferrer">Open ↗</a> : <i className="t-wel-dot" title="Live" />}
      </header>
      <div className="t-wel-live-body">{children}</div>
    </div>
  );
}

function Intro() {
  return (
    <div className="t-wel-split">
      <div className="t-wel-hello">
        <p className="t-wel-mark">TENQAY</p>
        <h1>A terminal for every US-listed company.</h1>
        <p>Filed financials, live markets and the US economy, on one screen you drive from the keyboard.</p>
        <ul className="t-wel-tags">
          <li>SEC filings, never guessed</li><li>Live prices and rates</li><li>Fed odds from futures</li><li>Your list, book and alerts</li>
        </ul>
      </div>
      <div className="t-wel-stack">
        <Live code="WEI" title="The market, now"><Indices /></Live>
        <Live code="IMAP" title="The S&P 500 today"><Heatmap height={250} compact /></Live>
      </div>
    </div>
  );
}

function CommandStep() {
  const [text, setText] = useState("AAPL GP");
  const command = parseCommand(text, null);
  const href = hrefFor(command);
  const lone = command.kind === "company" && command.fn === "DES" && !/\s/.test(text.trim());
  const reading = lone ? "A ticker or a company name — looked up in the SEC registry"
    : command.kind === "company" ? `${command.ticker} · ${COMPANY_FUNCTIONS.find((spec) => spec.code === command.fn)?.name ?? command.fn}`
      : command.kind === "global" ? GLOBAL_FUNCTIONS.find((spec) => spec.code === command.fn)?.name ?? command.fn
        : command.kind === "needs-ticker" ? `Name a company first: AAPL ${command.fn}` : "Type a command";
  return (
    <>
      <Lead title="One line drives everything">A company, then a function. Or just a screen.</Lead>
      <div className="t-wel-try">
        <div className="t-wel-line">
          <span aria-hidden="true">&gt;</span>
          <input aria-label="Try a command" value={text} onChange={(event) => setText(event.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="characters" />
          {href && !lone ? <a className="t-chip t-wel-next" href={href} target="_blank" rel="noreferrer">GO ↗</a> : null}
        </div>
        <p className="t-wel-reads">→ {reading}</p>
        <div className="t-wel-chips">{TRY.map((sample) => <button key={sample} type="button" className="t-chip" aria-pressed={text === sample} onClick={() => setText(sample)}>{sample}</button>)}</div>
      </div>
      <div className="t-wel-keys">
        <span><kbd>/</kbd> or any key</span><span><kbd>⌘K</kbd> anywhere</span><span><kbd>Tab</kbd> complete</span><span><kbd>⌥1</kbd>–<kbd>⌥9</kbd> screens</span><span>Empty line: your last 3</span>
      </div>
    </>
  );
}

function ScreensStep() {
  const home = useHomeData([]);
  return (
    <>
      <Lead title="The screens, live">What they show right now. Each is a code you type.</Lead>
      <div className="t-wel-quad">
        <Live code="FED" title="Rate odds from futures" href="/t"><FedPanel data={home} /></Live>
        <Live code="ECO" title="US releases vs consensus" href="/t/eco"><EconBrief /></Live>
        <Live code="SIGS" title="52-week highs and lows" href="/t"><SignalsPanel data={home} /></Live>
        <Live code="MKT" title="Sectors and movers" href="/t/market"><Heatmap height={230} compact /></Live>
      </div>
      <div className="t-wel-codes">
        {GLOBAL_FUNCTIONS.filter((spec) => !["HELP", "TOUR", "ACCT", "SET"].includes(spec.code)).map((spec) => (
          <a key={spec.code} href={hrefFor({ kind: "global", fn: spec.code }) ?? "/t"} target="_blank" rel="noreferrer" title={spec.name}><b>{spec.code}</b><span>{spec.name.split(":")[0]}</span></a>
        ))}
      </div>
    </>
  );
}

/* ---------- Hard-to-find data, live ---------- */

const KPI_COMPANIES: Array<{ ticker: string; cik: string }> = [
  { ticker: "DAL", cik: "0000027904" }, { ticker: "UBER", cik: "0001543151" }, { ticker: "COST", cik: "0000909832" },
];

function DataStep() {
  return (
    <>
      <Lead title="Data you won't find elsewhere">Read from the filings themselves — the figures most sites leave out.</Lead>
      <div className="t-wel-data">
        <KpiCard />
        <InsiderCard />
        <DebtCard />
      </div>
      <div className="t-wel-features">
        {FEATURES.map((feature) => (
          <div key={feature.code}><span className="t-code">{feature.code}</span><b>{feature.title}</b><small>{feature.line}</small></div>
        ))}
      </div>
    </>
  );
}

interface KpiSeries { name: string; unit: string; scale: string | null; points: Array<{ end: string; value: number }> }

function KpiCard() {
  const [company, setCompany] = useState(KPI_COMPANIES[0]);
  const [answer, setAnswer] = useState<{ ticker: string; kpis: KpiSeries[] | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/io/${company.ticker}/kpis?cik=${company.cik}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ kpis: KpiSeries[] }> : null))
      .then((body) => setAnswer({ ticker: company.ticker, kpis: body?.kpis ?? null }))
      .catch(() => { if (!controller.signal.aborted) setAnswer({ ticker: company.ticker, kpis: null }); });
    return () => controller.abort();
  }, [company]);
  const kpis = answer?.ticker === company.ticker ? answer.kpis : undefined;
  const shown = (kpis ?? []).filter((kpi) => kpi.points.length >= 3).slice(0, 4);
  const write = (kpi: KpiSeries, value: number) => {
    const scaled = value * (kpi.scale === "millions" ? 1e6 : kpi.scale === "thousands" ? 1e3 : kpi.scale === "billions" ? 1e9 : 1);
    if (kpi.unit === "currency") return Math.abs(scaled) >= 1e3 ? money(scaled, "USD") : `$${value.toFixed(2)}`;
    if (kpi.unit === "percent") return `${(value * (Math.abs(value) <= 1 ? 100 : 1)).toFixed(1)}%`;
    return Math.abs(scaled) >= 1e4 ? compact(scaled) : scaled.toLocaleString("en-US", { maximumFractionDigits: 1 });
  };
  return (
    <Live code="KPI" title="Operating figures, from earnings releases" href={`/t/s/${company.ticker}#kpi`}>
      <div className="t-wel-chips t-wel-pad">
        {KPI_COMPANIES.map((each) => <button key={each.ticker} type="button" className="t-chip" aria-pressed={company.ticker === each.ticker} onClick={() => setCompany(each)}>{each.ticker}</button>)}
      </div>
      {kpis === undefined ? <p className="t-empty">Reading the releases…</p> : !shown.length ? <p className="t-empty">No figures read for this company just now.</p> : (
        <div className="t-wel-kpis">
          {shown.map((kpi) => {
            const points = [...kpi.points].sort((a, b) => a.end.localeCompare(b.end));
            const last = points.at(-1)!;
            const yearAgo = [...points].reverse().find((point) => Date.parse(last.end) - Date.parse(point.end) > 300 * 86_400_000);
            const change = yearAgo && yearAgo.value ? last.value / yearAgo.value - 1 : null;
            return (
              <div key={kpi.name} className="t-wel-kpi">
                <span className="t-wel-kpi-name" title={kpi.name}>{kpi.name.replace(/\s*·\s*GAAP$/, "")}</span>
                <b>{write(kpi, last.value)}</b>
                <span data-dir={change == null ? undefined : change < 0 ? "down" : "up"}>{change == null ? "" : `${delta(change, 1)} y/y`}</span>
                <Spark values={points.map((point) => point.value)} />
              </div>
            );
          })}
        </div>
      )}
    </Live>
  );
}

function Spark({ values }: { values: number[] }) {
  const width = 90, height = 26;
  const low = Math.min(...values), high = Math.max(...values);
  const path = values.map((value, index) => `${index ? "L" : "M"}${((index / Math.max(values.length - 1, 1)) * width).toFixed(1)} ${(2 + (1 - (value - low) / (high - low || 1)) * (height - 4)).toFixed(1)}`).join("");
  return <svg width={width} height={height} className="t-wel-spark" aria-hidden="true"><path d={path} /></svg>;
}

interface Purchase { ticker: string; owner: string; role: string; date: string; value: number }
interface Cluster { ticker: string; buyers: number; value: number; to: string }

function InsiderCard() {
  const [answer, setAnswer] = useState<{ purchases: Purchase[]; clusters: Cluster[] } | null | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/insider-buying", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ purchases: Purchase[]; clusters: Cluster[] }> : null))
      .then((body) => setAnswer(body))
      .catch(() => { if (!controller.signal.aborted) setAnswer(null); });
    return () => controller.abort();
  }, []);
  // One bar a company: what its insiders bought together over the weeks read, the largest six.
  const top = answer ? Object.values(answer.purchases.reduce<Record<string, { ticker: string; value: number; buyers: Set<string>; last: string }>>((byTicker, purchase) => {
    const entry = byTicker[purchase.ticker] ??= { ticker: purchase.ticker, value: 0, buyers: new Set(), last: purchase.date };
    entry.value += purchase.value; entry.buyers.add(purchase.owner); if (purchase.date > entry.last) entry.last = purchase.date;
    return byTicker;
  }, {})).sort((a, b) => b.value - a.value).slice(0, 6) : [];
  const largest = Math.max(1, ...top.map((entry) => entry.value));
  return (
    <Live code="INSB" title="Insiders buying their own shares · Form 4" href="/t/insiders">
      {answer === undefined ? <p className="t-empty">Reading Form 4 filings…</p> : answer === null ? <p className="t-empty">The filings could not be read just now.</p> : (
        <>
          {answer.clusters[0] ? (
            <p className="t-wel-pad t-wel-callout"><b>{answer.clusters[0].ticker}</b>: {answer.clusters[0].buyers} insiders bought together ({money(answer.clusters[0].value, "USD")})</p>
          ) : null}
          <div className="t-wel-bars">
            {top.map((entry) => (
              <a key={entry.ticker} href={`/t/s/${entry.ticker}#ins`} target="_blank" rel="noreferrer" title={`${entry.buyers.size} insider${entry.buyers.size > 1 ? "s" : ""} · last ${entry.last}`}>
                <b>{entry.ticker}</b>
                {/* A square-root scale: one holder's block purchase would otherwise flatten every other bar. */}
                <span className="t-wel-bar-track"><span style={{ width: `${Math.sqrt(entry.value / largest) * 100}%` }} /></span>
                <span>{money(entry.value, "USD")}<small className="t-dim"> · {entry.buyers.size}</small></span>
              </a>
            ))}
          </div>
        </>
      )}
    </Live>
  );
}

interface Maturities { asOf: string; form: string; buckets: Array<{ label: string; value: number }>; total: number }

function DebtCard() {
  const [ticker, setTicker] = useState("DAL");
  const ciks: Record<string, string> = { DAL: "0000027904", UBER: "0001543151", COST: "0000909832" };
  const [answer, setAnswer] = useState<{ ticker: string; maturities: Maturities | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/io/${ticker}/debt-maturities?cik=${ciks[ticker]}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ maturities: Maturities | null }> : null))
      .then((body) => setAnswer({ ticker, maturities: body?.maturities ?? null }))
      .catch(() => { if (!controller.signal.aborted) setAnswer({ ticker, maturities: null }); });
    return () => controller.abort();
    // The CIKs are fixed alongside the tickers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);
  const maturities = answer?.ticker === ticker ? answer.maturities : undefined;
  const largest = Math.max(1, ...(maturities?.buckets ?? []).map((bucket) => bucket.value));
  return (
    <Live code="DDIS" title="When the debt falls due · from the 10-K" href={`/t/s/${ticker}#ddis`}>
      <div className="t-wel-chips t-wel-pad">
        {Object.keys(ciks).map((each) => <button key={each} type="button" className="t-chip" aria-pressed={ticker === each} onClick={() => setTicker(each)}>{each}</button>)}
      </div>
      {maturities === undefined ? <p className="t-empty">Reading the annual report…</p> : maturities === null ? <p className="t-empty">No schedule filed for this company.</p> : (
        <>
          <div className="t-wel-wall">
            {maturities.buckets.map((bucket) => (
              <div key={bucket.label} title={`${bucket.label}: ${money(bucket.value, "USD")}`}>
                <span className="t-wel-wall-value">{money(bucket.value, "USD")}</span>
                <span className="t-wel-wall-bar" style={{ height: `${Math.max(2, (bucket.value / largest) * 100)}%` }} />
                <span className="t-wel-wall-label">{bucket.label.replace("After ", "> ")}</span>
              </div>
            ))}
          </div>
          <p className="t-wel-pad t-dim t-wel-small">{money(maturities.total, "USD")} in all · {maturities.form} at {maturities.asOf}</p>
        </>
      )}
    </Live>
  );
}

function CompanyStep() {
  const [ticker, setTicker] = useState("AAPL");
  return (
    <>
      <Lead title="A company, from its filings">Price, ten years of figures, valuation, owners — in six chapters.</Lead>
      <div className="t-wel-chips">
        {["AAPL", "NVDA", "COST", "JPM"].map((each) => <button key={each} type="button" className="t-chip" aria-pressed={ticker === each} onClick={() => setTicker(each)}>{each}</button>)}
        <a className="t-chip t-wel-next" href={`/t/s/${ticker}`} target="_blank" rel="noreferrer">Open {ticker} ↗</a>
      </div>
      <CompanyGlimpse key={ticker} ticker={ticker} />
      <div className="t-wel-codes t-wel-chapters">
        {CHAPTERS.map((chapter, index) => (
          <div key={chapter.title}>
            <b>{index + 1} {chapter.title}</b>
            <small>{chapter.holds}</small>
            <span>{COMPANY_FUNCTIONS.filter((spec) => spec.chapter === index + 1).map((spec) => spec.code).join(" · ")}</span>
          </div>
        ))}
      </div>
    </>
  );
}

interface Bar { date: string; close: number | null }

/** Five years of weekly closes and the last ten filed years of revenue and free cash flow. */
function CompanyGlimpse({ ticker }: { ticker: string }) {
  const { state, quote } = useCompany(ticker);
  const [bars, setBars] = useState<Bar[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
    fetch(`/api/market/${ticker}?frequency=weekly&start=${start}&end=${end}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ bars: Bar[] }> : null))
      .then((body) => setBars((body?.bars ?? []).filter((bar) => bar.close != null)))
      .catch(() => { if (!controller.signal.aborted) setBars([]); });
    return () => controller.abort();
  }, [ticker]);
  const years = useMemo(() => (state.kind === "ready"
    ? [...state.view.annual].sort((a, b) => a.fiscalYear - b.fiscalYear).slice(-10).map((period) => ({ year: period.fiscalYear, revenue: period.values.revenue ?? null, fcf: period.values.freeCashFlow ?? null, margin: period.values.netMargin ?? null }))
    : []), [state]);
  const first = bars?.[0]?.close ?? null, lastClose = bars?.at(-1)?.close ?? null;
  const fiveYear = first && lastClose ? lastClose / first - 1 : null;
  const latest = years.at(-1);
  return (
    <div className="t-wel-company">
      <Live code="GP" title={`${ticker} · five years, weekly`}>
        <div className="t-wel-figures">
          <span><small>Price</small><b>{quote?.price != null ? price(quote.price, quote.currency) : "—"}</b></span>
          <span><small>Today</small><b data-dir={quote?.changePercent == null ? undefined : quote.changePercent < 0 ? "down" : "up"}>{delta(quote?.changePercent ?? null)}</b></span>
          <span><small>5 years</small><b data-dir={fiveYear == null ? undefined : fiveYear < 0 ? "down" : "up"}>{delta(fiveYear, 0)}</b></span>
        </div>
        {bars ? <PriceLine bars={bars} /> : <p className="t-empty">Reading prices…</p>}
      </Live>
      <Live code="FA" title="Revenue and free cash flow · filed years">
        {state.kind === "ready" ? (
          <>
            <div className="t-wel-figures">
              <span><small>Revenue FY{latest?.year}</small><b>{money(latest?.revenue ?? null, "USD")}</b></span>
              <span><small>FCF</small><b>{money(latest?.fcf ?? null, "USD")}</b></span>
              <span><small>Net margin</small><b>{latest?.margin == null ? "—" : `${(latest.margin * 100).toFixed(1)}%`}</b></span>
            </div>
            <YearBars years={years} />
          </>
        ) : <p className="t-empty">{state.kind === "failed" ? "Could not read the filings just now." : "Reading the filings…"}</p>}
      </Live>
    </div>
  );
}

function PriceLine({ bars }: { bars: Bar[] }) {
  const { ref, width } = useWidth();
  const height = 170;
  const closes = bars.map((bar) => bar.close!);
  const low = Math.min(...closes), high = Math.max(...closes);
  const x = (index: number) => (index / Math.max(closes.length - 1, 1)) * width;
  const y = (value: number) => 6 + (1 - (value - low) / (high - low || 1)) * (height - 12);
  const path = closes.map((close, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(close).toFixed(1)}`).join("");
  const up = closes.length > 1 && closes.at(-1)! >= closes[0];
  return (
    <div ref={ref} className="t-wel-chart">
      {width > 0 && closes.length > 1 ? (
        <svg width={width} height={height} role="img" aria-label="Five years of weekly closes">
          <path d={`${path}L${width} ${height}L0 ${height}Z`} className={up ? "t-wel-area-up" : "t-wel-area-down"} />
          <path d={path} className={up ? "t-wel-line-up" : "t-wel-line-down"} />
        </svg>
      ) : null}
    </div>
  );
}

function YearBars({ years }: { years: Array<{ year: number; revenue: number | null; fcf: number | null }> }) {
  const { ref, width } = useWidth();
  const height = 170;
  const top = Math.max(1, ...years.map((year) => Math.max(year.revenue ?? 0, year.fcf ?? 0)));
  const slot = width / Math.max(years.length, 1);
  const h = (value: number | null) => (value == null || value <= 0 ? 0 : (value / top) * (height - 22));
  return (
    <div ref={ref} className="t-wel-chart">
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label="Revenue and free cash flow by fiscal year">
          {years.map((year, index) => (
            <g key={year.year}>
              <title>{`FY${year.year}: revenue ${money(year.revenue, "USD")}, FCF ${money(year.fcf, "USD")}`}</title>
              <rect x={index * slot + slot * 0.14} y={height - 16 - h(year.revenue)} width={slot * 0.4} height={h(year.revenue)} className="t-wel-bar-rev" />
              <rect x={index * slot + slot * 0.54} y={height - 16 - h(year.fcf)} width={slot * 0.3} height={h(year.fcf)} className="t-wel-bar-fcf" />
              <text x={index * slot + slot / 2} y={height - 3} textAnchor="middle" className="t-wel-tick">{String(year.year).slice(2)}</text>
            </g>
          ))}
        </svg>
      ) : null}
      <p className="t-wel-legend"><i className="t-wel-bar-rev" /> Revenue <i className="t-wel-bar-fcf" /> Free cash flow</p>
    </div>
  );
}

function ListStep() {
  const current = useStoredWatchlist();
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [start, setStart] = useState(() => (typeof window === "undefined" ? "/t" : readPrefs().start));
  const [saved, setSaved] = useState(false);
  const tape = useTape(DEFAULT_WATCHLIST.map((company) => company.ticker));
  const quotes = new Map((tape?.quotes ?? []).filter((quote) => quote.kind === "equity").map((quote) => [quote.symbol, quote]));
  const picked = chosen ?? current;
  const toggle = (ticker: string) => { setSaved(false); setChosen((list) => { const now = list ?? current; return now.includes(ticker) ? now.filter((each) => each !== ticker) : [...now, ticker]; }); };
  const save = () => { writeWatchlist(picked); writePrefs({ start }); setSaved(true); };
  return (
    <>
      <Lead title="Make it yours">Pick your names — prices are live. HOME, alerts and the calendar follow them.</Lead>
      <div className="t-wel-picks">
        {DEFAULT_WATCHLIST.map((company) => {
          const quote = quotes.get(company.ticker);
          const move = quote?.changePercent ?? null;
          return (
            <button key={company.ticker} type="button" aria-pressed={picked.includes(company.ticker)} onClick={() => toggle(company.ticker)} title={company.name} data-dir={move == null ? undefined : move < 0 ? "down" : "up"}>
              <b>{company.ticker}</b>
              <span className="t-wel-pick-price">{quote?.price != null ? price(quote.price, null) : "…"}</span>
              <span className="t-wel-pick-move">{delta(move)}</span>
            </button>
          );
        })}
      </div>
      <div className="t-wel-chips">
        <select className="t-set-select" aria-label="Open the terminal on" value={START_SCREENS.some((screen) => screen.path === start) ? start : "/t"} onChange={(event) => { setStart(event.target.value); setSaved(false); }}>
          {START_SCREENS.map((screen) => <option key={screen.path} value={screen.path}>Open on {screen.label}</option>)}
        </select>
        <button type="button" className="t-chip t-wel-next" onClick={save} disabled={!picked.length}>Save {picked.length} names</button>
        {saved ? <span className="t-wel-ok" role="status">Saved ✓</span> : null}
      </div>
    </>
  );
}

function AlertsStep() {
  const { account } = useAccount();
  return (
    <div className="t-wel-split">
      <div>
        <Lead title="Alerts that come to you">Prices, big moves, filings, insider buys, US releases — here, in the browser or by email.</Lead>
        <Live code="ALRT" title="What your alerts caught" href="/t/alerts"><AlertsBrief /></Live>
      </div>
      <div className="t-wel-account">
        <span className="t-code">ACCT</span>
        <b>{account ? `Signed in as ${account.name}` : "Everywhere you are"}</b>
        <p>{account ? "Your list, book, notes and alerts follow you to every device." : "Sign in with Google, an email link or a passkey: list, book, notes and alerts on every device."}</p>
        {account ? null : <a className="t-chip t-wel-next" href="/t/account" target="_blank" rel="noreferrer">Sign in ↗</a>}
      </div>
    </div>
  );
}

function ReadyStep({ onFinish }: { onFinish: (href?: string) => void }) {
  return (
    <>
      <Lead title="You're set">Three good first moves.</Lead>
      <div className="t-wel-ready">
        <button type="button" onClick={() => onFinish("/t")}><span className="t-code">HOME</span><b>Today&apos;s session</b></button>
        <button type="button" onClick={() => onFinish("/t/s/AAPL")}><span className="t-code">AAPL</span><b>A company page</b></button>
        <button type="button" onClick={() => onFinish("/t/screener")}><span className="t-code">SCRN</span><b>Find ideas</b></button>
      </div>
      <p className="t-dim t-wel-small">The tour stays on <code>TOUR</code> and on SET. Research information, not investment advice.</p>
    </>
  );
}
