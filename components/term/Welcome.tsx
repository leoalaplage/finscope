"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { COMPANY_FUNCTIONS, GLOBAL_FUNCTIONS, hrefFor, parseCommand } from "@/lib/term/command";
import { useStoredWatchlist, writeWatchlist } from "@/components/io/watchlist";
import { useAccount } from "@/components/io/account";
import { useCompany } from "@/components/io/use-company";
import { delta, money, price } from "@/components/io/format";
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

const STEPS = ["Welcome", "Command line", "Screens", "A company", "Your list", "Alerts", "Ready"] as const;
const TRY = ["AAPL GP", "NVDA DCF", "DAL KPI", "ECO", "MSFT EE"];
const CHAPTERS = ["Snapshot", "Business", "Results", "Valuation", "Ownership", "Record"];

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
        {step === 3 ? <CompanyStep /> : null}
        {step === 4 ? <ListStep /> : null}
        {step === 5 ? <AlertsStep /> : null}
        {step === 6 ? <ReadyStep onFinish={finish} /> : null}
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
        {CHAPTERS.map((title, index) => (
          <div key={title}><b>{index + 1} {title}</b><span>{COMPANY_FUNCTIONS.filter((spec) => spec.chapter === index + 1).map((spec) => spec.code).join(" · ")}</span></div>
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
