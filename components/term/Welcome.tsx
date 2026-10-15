"use client";

import { useEffect, useState } from "react";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";
import { COMPANY_FUNCTIONS, GLOBAL_FUNCTIONS, hrefFor, parseCommand } from "@/lib/term/command";
import { useStoredWatchlist, writeWatchlist } from "@/components/io/watchlist";
import { useAccount } from "@/components/io/account";
import { readPrefs, START_SCREENS, writePrefs } from "./prefs";

/**
 * TOUR: the first visit, in seven steps — what Tenqay is, the command line
 * that drives it, the screens, a company page chapter by chapter, the
 * reader's own list and start screen (saved for real), alerts and the
 * account, and the way in. Opened once on a first visit (components/term/
 * Launchpad.tsx, ONBOARDED_KEY); always on /t/welcome, TOUR, or SET.
 */

export const ONBOARDED_KEY = "finscope.term.onboarded.v1";
export const markOnboarded = () => { try { localStorage.setItem(ONBOARDED_KEY, new Date().toISOString()); } catch { /* Shown again next time. */ } };

const STEPS = ["Welcome", "Command line", "Screens", "A company", "Your list", "Alerts and account", "Ready"] as const;

const SCREEN_NOTES: Record<string, string> = {
  HOME: "The session written out, rates, the Fed's odds, the US releases, the heat map, your list and its earnings.",
  MKT: "Indices, futures, rates, currencies, commodities, sectors and breadth.",
  SCRN: "Screen the US 1,000 on filed figures, valuation and technicals.",
  PORT: "Your book: value, performance against the S&P 500, risk, income.",
  CHART: "Charts with indicators, side by side, in layouts you keep.",
  BT: "Test a rule on years of daily prices before trusting it.",
  ECAL: "Who reports, when, and against what consensus.",
  ECO: "CPI, jobs, GDP, PCE: each release against the consensus, and how markets took it.",
  INSB: "Officers and directors buying their own company's shares.",
  ALRT: "Prices, big moves, filings, insider buying and US releases you want to hear about.",
};

const CHAPTERS = ["What it is and how it trades", "The business", "Results", "Valuation", "Ownership", "The record"];

const TRY = ["AAPL GP", "NVDA DCF", "DAL KPI", "ECO", "MSFT EE", "apple"];

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
              <button type="button" onClick={() => go(index)} aria-current={index === step ? "step" : undefined}>
                <b>{index + 1}</b><span>{name}</span>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="t-chip" onClick={() => finish()}>Skip the tour</button>
      </header>

      <section className="t-wel-body" aria-live="polite">
        {step === 0 ? <Intro /> : null}
        {step === 1 ? <CommandStep /> : null}
        {step === 2 ? <ScreensStep /> : null}
        {step === 3 ? <CompanyStep /> : null}
        {step === 4 ? <ListStep /> : null}
        {step === 5 ? <AccountStep /> : null}
        {step === 6 ? <ReadyStep onFinish={finish} /> : null}
      </section>

      <footer className="t-wel-foot">
        <button type="button" className="t-chip" onClick={() => go(step - 1)} disabled={step === 0}>← Back</button>
        <span className="t-dim">{step + 1} / {STEPS.length} · ← → to move</span>
        {step < last
          ? <button type="button" className="t-chip t-wel-next" onClick={() => go(step + 1)}>Next: {STEPS[step + 1]} →</button>
          : <button type="button" className="t-chip t-wel-next" onClick={() => finish()}>Open the terminal →</button>}
      </footer>
    </div>
  );
}

function Intro() {
  return (
    <div className="t-wel-intro">
      <p className="t-wel-mark">TENQAY</p>
      <h1>A terminal for every US-listed company.</h1>
      <p className="t-wel-lead">
        Financials read straight from the filings companies make with the SEC, live market prices, the US economy as markets trade it,
        and the tools to follow what matters to you — on one dark, dense screen you drive from the keyboard.
      </p>
      <div className="t-wel-pillars">
        <div><b>Filed, not guessed</b><span>Every figure comes from a 10-K, a 10-Q or an 8-K, with the filing a click away. A figure that cannot be read honestly is left out, never estimated.</span></div>
        <div><b>Live where it moves</b><span>Prices, futures, Treasury yields, the dollar, the Fed&apos;s odds from futures, and US releases the minute they come out.</span></div>
        <div><b>Yours</b><span>A watchlist, a portfolio, alerts and notes, kept in your browser — and on your account if you sign in.</span></div>
      </div>
      <p className="t-dim t-wel-small">Research information, not investment advice. Two minutes for the tour; skip it any time.</p>
    </div>
  );
}

function CommandStep() {
  const [text, setText] = useState("AAPL GP");
  const command = parseCommand(text, null);
  const href = hrefFor(command);
  const lone = command.kind === "company" && command.fn === "DES" && !/\s/.test(text.trim());
  const reading = lone
    ? `A ticker or a company's name: looked up in the SEC registry, then its page`
    : command.kind === "company"
    ? `${command.ticker} · ${COMPANY_FUNCTIONS.find((spec) => spec.code === command.fn)?.name ?? command.fn}`
    : command.kind === "global" ? GLOBAL_FUNCTIONS.find((spec) => spec.code === command.fn)?.name ?? command.fn
      : command.kind === "search" ? `Search the SEC registry for “${command.query}”`
        : command.kind === "needs-ticker" ? `Name a company first: AAPL ${command.fn}` : "Type something";
  return (
    <div className="t-wel-grid">
      <div>
        <h2>One line drives everything</h2>
        <p>The line at the top of every screen takes a <b>company</b>, then a <b>function</b>: <code>AAPL GP</code> is Apple&apos;s price graph, <code>NVDA DCF</code> Nvidia&apos;s discounted cash flow. A function alone opens a screen: <code>ECO</code>, <code>PORT</code>. A name works too: <code>apple</code>.</p>
        <ul className="t-wel-keys">
          <li><kbd>/</kbd> or any letter — the line takes the keyboard</li>
          <li><kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> — from anywhere</li>
          <li><kbd>Tab</kbd> — complete a suggestion · <kbd>Enter</kbd> — go</li>
          <li><kbd>⌥1</kbd>…<kbd>⌥9</kbd> — the function keys on the bar</li>
          <li>Focused empty, the line offers your last three places</li>
        </ul>
      </div>
      <div className="t-wel-try">
        <label htmlFor="t-wel-try">Try it</label>
        <div className="t-wel-line">
          <span aria-hidden="true">&gt;</span>
          <input id="t-wel-try" value={text} onChange={(event) => setText(event.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="characters" />
        </div>
        <p className="t-wel-reads">{reading}{href && !lone ? <span className="t-dim"> · {href}</span> : null}</p>
        <div className="t-wel-chips">{TRY.map((sample) => <button key={sample} type="button" className="t-chip" onClick={() => setText(sample)}>{sample}</button>)}</div>
        {href && !lone ? <a className="t-chip t-wel-next" href={href} target="_blank" rel="noreferrer">Open it in a new tab ↗</a> : null}
      </div>
    </div>
  );
}

function ScreensStep() {
  const screens = GLOBAL_FUNCTIONS.filter((spec) => SCREEN_NOTES[spec.code]);
  return (
    <div>
      <h2>The screens</h2>
      <p>Each is a code you can type, or a key on the function bar.</p>
      <div className="t-wel-cards">
        {screens.map((spec) => (
          <a key={spec.code} className="t-wel-card" href={hrefFor({ kind: "global", fn: spec.code }) ?? "/t"} target="_blank" rel="noreferrer">
            <span className="t-code">{spec.code}</span>
            <b>{spec.name.split(":")[0]}</b>
            <span>{SCREEN_NOTES[spec.code]}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function CompanyStep() {
  return (
    <div>
      <h2>A company, in six chapters</h2>
      <p>Every company page reads the way an analyst reads a business. Jump to any panel with its code: <code>MSFT FA</code> lands on Microsoft&apos;s financial analysis.</p>
      <div className="t-wel-chapters">
        {CHAPTERS.map((title, index) => (
          <div key={title}>
            <b>{index + 1} · {title}</b>
            <span>{COMPANY_FUNCTIONS.filter((spec) => spec.chapter === index + 1).map((spec) => <code key={spec.code} title={spec.name}>{spec.code}</code>)}</span>
          </div>
        ))}
      </div>
      <p className="t-dim">Funds have their own page: what they hold, what they cost, flows, risk and a quality score of their holdings.</p>
      <div className="t-wel-chips">
        {["AAPL", "NVDA", "JPM", "SPY"].map((ticker) => <a key={ticker} className="t-chip" href={`/t/s/${ticker}`} target="_blank" rel="noreferrer">Open {ticker} ↗</a>)}
      </div>
    </div>
  );
}

function ListStep() {
  const current = useStoredWatchlist();
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [start, setStart] = useState(() => (typeof window === "undefined" ? "/t" : readPrefs().start));
  const [saved, setSaved] = useState(false);
  const picked = chosen ?? current;
  const toggle = (ticker: string) => { setSaved(false); setChosen(picked.includes(ticker) ? picked.filter((each) => each !== ticker) : [...picked, ticker]); };
  const save = () => { writeWatchlist(picked); writePrefs({ start }); setSaved(true); };
  return (
    <div>
      <h2>Make it yours</h2>
      <p>Your watchlist follows you across HOME, the alerts and the earnings calendar. Pick a few to start; you can add any US-listed company later with <b>Edit</b> on the watchlist.</p>
      <div className="t-wel-picks">
        {DEFAULT_WATCHLIST.map((company) => (
          <button key={company.ticker} type="button" aria-pressed={picked.includes(company.ticker)} onClick={() => toggle(company.ticker)} title={company.name}>
            <b>{company.ticker}</b><span>{company.name.replace(/,? (Inc\.|Corporation|Corp\.|Company|Co\.|Incorporated|plc|N\.V\.)$/i, "")}</span>
          </button>
        ))}
      </div>
      <div className="t-set-row t-wel-start">
        <span className="t-set-label">Open the terminal on</span>
        <select className="t-set-select" value={START_SCREENS.some((screen) => screen.path === start) ? start : "/t"} onChange={(event) => { setStart(event.target.value); setSaved(false); }}>
          {START_SCREENS.map((screen) => <option key={screen.path} value={screen.path}>{screen.label}</option>)}
        </select>
      </div>
      <div className="t-wel-chips">
        <button type="button" className="t-chip t-wel-next" onClick={save} disabled={!picked.length}>Save my list ({picked.length})</button>
        {saved ? <span className="t-wel-ok" role="status">Saved. HOME shows these now.</span> : null}
      </div>
      <p className="t-dim t-wel-small">Holdings go on PORT: type them, paste them from a broker, or import a CSV. Nothing leaves your browser unless you sign in.</p>
    </div>
  );
}

function AccountStep() {
  const { account } = useAccount();
  return (
    <div className="t-wel-grid">
      <div>
        <h2>Alerts</h2>
        <p>Tell Tenqay what you want to hear about — a price crossing a level, a move of more than a few per cent, results and red flags filed with the SEC, insiders buying, or a US release like CPI — and where: here, in a browser notification, or by email.</p>
        <p>Three sensible alerts are set already. Edit, pause or delete them on <code>ALRT</code>.</p>
        <a className="t-chip" href="/t/alerts" target="_blank" rel="noreferrer">Open ALRT ↗</a>
      </div>
      <div>
        <h2>Your account</h2>
        {account ? (
          <p>You are signed in as <b>{account.name}</b>: your list, portfolio, notes and alerts follow you to every device.</p>
        ) : (
          <>
            <p>Optional, and free. Sign in with <b>Google</b>, an <b>email link</b> or a <b>passkey</b> and your list, portfolio, notes and alerts follow you to every device — and alerts can reach you by email.</p>
            <a className="t-chip t-wel-next" href="/t/account" target="_blank" rel="noreferrer">Sign in or create an account ↗</a>
          </>
        )}
        <p className="t-dim t-wel-small">Display, start screen and what this browser keeps are on <code>SET</code>.</p>
      </div>
    </div>
  );
}

function ReadyStep({ onFinish }: { onFinish: (href?: string) => void }) {
  return (
    <div className="t-wel-intro">
      <h1>You&apos;re set.</h1>
      <p className="t-wel-lead">Three good first moves:</p>
      <div className="t-wel-cards">
        <button type="button" className="t-wel-card" onClick={() => onFinish("/t")}><span className="t-code">HOME</span><b>Today&apos;s session</b><span>The summary, rates, the Fed and your list.</span></button>
        <button type="button" className="t-wel-card" onClick={() => onFinish("/t/s/AAPL")}><span className="t-code">AAPL</span><b>A company page</b><span>Six chapters, from the price to every filed line.</span></button>
        <button type="button" className="t-wel-card" onClick={() => onFinish("/t/screener")}><span className="t-code">SCRN</span><b>Find ideas</b><span>Screen a thousand companies on what they file.</span></button>
      </div>
      <p className="t-dim t-wel-small">This tour is always on <code>TOUR</code>, and on SET.</p>
    </div>
  );
}
