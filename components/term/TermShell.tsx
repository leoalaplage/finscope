"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COMPANY_FUNCTIONS, GLOBAL_FUNCTIONS, hrefFor, LAUNCHPAD_PANELS, terminalHref } from "@/lib/term/command";
import { marketState, newYorkTime } from "@/lib/term/market-clock";
import { useStoredWatchlist } from "@/components/io/watchlist";
import { delta, price } from "@/components/io/format";
import { CommandLine } from "./CommandLine";
import { useTape } from "./quotes";
import { AlertsChip } from "./Alerts";
import { AccountChip } from "./Account";
import { useTermPrefs } from "./prefs";

/**
 * The frame every terminal screen sits in.
 *
 * Top to bottom: the command line, the tape, the function keys for the security
 * on screen, the screen itself, and a status line that says whether New York is
 * trading and how old the prices are. The legal line the document site carries
 * in its footer is on the status line, so it is on screen at all times rather
 * than at the bottom of a page nobody scrolls to.
 */

/** Seconds since the epoch, ticking once a second; zero on the server. */
function subscribeSecond(notify: () => void) {
  const timer = setInterval(notify, 1_000);
  return () => clearInterval(timer);
}
const nowSecond = () => Math.floor(Date.now() / 1_000);
const serverSecond = () => 0;

function useSecond() {
  return useSyncExternalStore(subscribeSecond, nowSecond, serverSecond);
}

function Tape() {
  const tickers = useStoredWatchlist();
  const tape = useTape(tickers);
  const quotes = tape?.quotes ?? [];
  if (!quotes.length) {
    return <div className="t-tape"><div className="t-tape-empty">{tape?.failed ? "Tape unavailable" : "Loading tape…"}</div></div>;
  }
  // Drawn twice and moved by half its width, so the loop has no seam.
  const run = (copy: number) => (
    <div className="t-tape-run" aria-hidden={copy === 1 ? true : undefined}>
      {quotes.map((quote) => (
        <a
          key={`${copy}-${quote.kind}-${quote.symbol}`}
          href={quote.kind === "index" ? "/t/market" : quote.kind === "future" ? `/t/chart?s=${encodeURIComponent(quote.symbol)}` : `/t/s/${encodeURIComponent(quote.symbol)}`}
          tabIndex={copy === 1 ? -1 : undefined}
        >
          <b>{quote.label}</b>
          <span>{quote.price == null ? "—" : price(quote.price, null)}</span>
          <span className={quote.changePercent == null ? "t-dim" : quote.changePercent < 0 ? "t-down" : "t-up"}>
            {delta(quote.changePercent)}
          </span>
        </a>
      ))}
    </div>
  );
  return (
    <div className="t-tape" aria-label="Indices and watchlist, today's move">
      <div className="t-tape-track">{run(0)}{run(1)}</div>
    </div>
  );
}

function FunctionKeys({ ticker }: { ticker: string | null }) {
  /*
   * ⌥1 to ⌥0, the function keys of a keyboard that has none to spare.
   *
   * The F-keys a real terminal uses are the browser's — F5 reloads, F11 and F12
   * belong to the window — and on a Mac they are the volume and brightness keys
   * before they are anything else. Option and a digit is free everywhere.
   *
   * On a company the bar follows its page, chapter by chapter, and the digit
   * is the chapter: ⌥4 is the valuation wherever it sits in the bar, and the
   * key after the last chapter opens the comparison. Elsewhere the digit is
   * the function's place in the bar.
   */
  const functions = ticker ? COMPANY_FUNCTIONS : GLOBAL_FUNCTIONS.filter((spec) => spec.code !== "HELP" && spec.code !== "TOUR");
  const hrefs = functions.map((spec) => (ticker
    ? hrefFor({ kind: "company", ticker, fn: spec.code as never })
    : hrefFor({ kind: "global", fn: spec.code as never })));
  const chapters = Math.max(0, ...functions.map((spec) => spec.chapter ?? 0));
  // Which function each digit opens, and the digit shown on it.
  const keyOf = functions.map((spec, index) => {
    if (!ticker) return index < 10 ? (index + 1) % 10 : null;
    if (spec.chapter != null) return functions.findIndex((other) => other.chapter === spec.chapter) === index ? spec.chapter : null;
    const after = chapters + functions.slice(0, index).filter((other) => other.chapter == null).length + 1;
    return after <= 10 ? after % 10 : null;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      // ⌥ and a digit in a field is a character on a Mac keyboard, not a function key.
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      const digit = /^Digit(\d)$/.exec(event.code)?.[1];
      if (digit == null) return;
      const href = hrefs[keyOf.indexOf(Number(digit))];
      if (!href) return;
      event.preventDefault();
      window.location.assign(href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hrefs, keyOf]);

  return (
    <nav className="t-fn" aria-label={ticker ? `${ticker} functions` : "Functions"}>
      {ticker ? <span className="t-fn-sec">{ticker} US</span> : null}
      {functions.map((spec, index) => (
        <a key={spec.code} href={hrefs[index] ?? "#"}
          data-chapter-start={ticker && keyOf[index] != null ? true : undefined}
          title={keyOf[index] != null ? `${spec.name} · ⌥${keyOf[index]}` : spec.name}
        >
          {keyOf[index] != null ? <kbd>{keyOf[index]}</kbd> : null}{spec.code}
        </a>
      ))}
    </nav>
  );
}

function StatusLine() {
  const second = useSecond();
  const { clock } = useTermPrefs();
  const at = second ? new Date(second * 1_000) : null;
  const state = at ? marketState(at) : null;
  const local = at ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "--:--:--";
  return (
    <footer className="t-status">
      <span className="t-status-state" data-state={state ?? undefined}>NYSE {state ?? "—"}</span>
      {clock !== "local" ? <span className="t-status-clock">{at ? `${newYorkTime(at).clock} ET` : "--:--:-- ET"}</span> : null}
      {clock !== "ny" ? <span className="t-status-clock">{local} local</span> : null}
      <span className="t-status-src">Filings · SEC EDGAR</span>
      <span className="t-status-src">Prices · Yahoo Finance, may be delayed</span>
      <span className="t-status-legal">Research information only · not investment advice · analyst estimates only where labelled</span>
    </footer>
  );
}

function Help({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="t-help" onClose={onClose} aria-labelledby="t-help-title">
      <header className="t-panel-head">
        <span className="t-code">HELP</span>
        <h2 id="t-help-title">Commands</h2>
        <div className="t-panel-actions"><button type="button" className="t-help-close" onClick={onClose}>ESC ✕</button></div>
      </header>
      <div className="t-help-body">
        <section>
          <h3>A security, then a function</h3>
          <dl>
            {COMPANY_FUNCTIONS.map((spec) => <Fragment key={spec.code}><dt>{spec.code}</dt><dd>{spec.name}</dd></Fragment>)}
          </dl>
          <h3 style={{ marginTop: 12 }}>Launchpad panels</h3>
          <dl>
            {LAUNCHPAD_PANELS.map((spec) => <Fragment key={spec.code}><dt>{spec.code}</dt><dd>{spec.name}</dd></Fragment>)}
          </dl>
        </section>
        <section>
          <h3>On their own</h3>
          <dl>
            {GLOBAL_FUNCTIONS.map((spec) => <Fragment key={spec.code}><dt>{spec.code}</dt><dd>{spec.name}</dd></Fragment>)}
          </dl>
          <h3 style={{ marginTop: 12 }}>Keys</h3>
          <dl>
            <dt>A–Z</dt><dd>Type anywhere to command</dd>
            <dt>/ ⌘K</dt><dd>Command line</dd>
            <dt>⌥1–⌥0</dt><dd>Function keys</dd>
            <dt>TAB</dt><dd>Complete</dd>
            <dt>↑ ↓ ⏎</dt><dd>Walk a table, open the row</dd>
            <dt>ESC</dt><dd>Close, clear</dd>
          </dl>
          <h3 style={{ marginTop: 12 }}>Examples</h3>
          <dl>
            <dt>AAPL</dt><dd>Apple</dd>
            <dt>NVDA GP</dt><dd>Nvidia price graph</dd>
            <dt>FA</dt><dd>Financials of the security on screen</dd>
            <dt>COCA</dt><dd>Search by name</dd>
          </dl>
        </section>
      </div>
    </dialog>
  );
}

/**
 * The panel a function code names, brought into view and lit for a moment.
 *
 * `AAPL HDS` is `/t/s/AAPL#hds`; arriving on it, or moving the hash on a screen
 * already open, scrolls that panel under the frame and outlines it in amber so
 * the eye lands where the command said.
 */
function useFocusedPanel() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const focus = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const panel = document.getElementById(id);
      // Panels draw once the company has loaded; wait for them a little.
      if (!panel) {
        if (tries++ < 40) timer = setTimeout(focus, 250);
        return;
      }
      tries = 0;
      panel.scrollIntoView({ block: "start" });
      panel.dataset.focus = "true";
      timer = setTimeout(() => { delete panel.dataset.focus; }, 1_600);
    };
    focus();
    const onHash = () => { tries = 0; focus(); };
    window.addEventListener("hashchange", onHash);
    return () => { window.removeEventListener("hashchange", onHash); if (timer) clearTimeout(timer); };
  }, []);
}

/**
 * Links stay in the terminal.
 *
 * The screens borrowed from the document site link to /s/AAPL and /compare;
 * a click on one is sent to the terminal's twin instead (terminalHref), unless
 * the link says it means the document site (`data-classic`) or the reader asked
 * for a new tab.
 */
function useTerminalLinks() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("data-classic") || anchor.target === "_blank") return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin) return;
      const twin = terminalHref(`${url.pathname}${url.search}${url.hash}`);
      if (!twin) return;
      event.preventDefault();
      window.location.assign(twin);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

/**
 * ↑ and ↓ walk the rows of a table, ⏎ opens the row.
 *
 * The table is the one the reader last clicked in, or else the first one on
 * screen. The row under the cursor is outlined in amber and kept in view; ⏎
 * follows its first link, or presses its first button — the same thing a click
 * on the row's name does. Letters stay the command line's.
 */
function useTableKeys() {
  useEffect(() => {
    let table: HTMLTableElement | null = null;
    let row = -1;
    const rowsOf = (of: HTMLTableElement) => [...of.tBodies].flatMap((body) => [...body.rows]).filter((item) => item.offsetParent != null);
    const visibleTable = () => [...document.querySelectorAll<HTMLTableElement>(".t-main table")].find((item) => {
      const box = item.getBoundingClientRect();
      return box.bottom > 120 && box.top < window.innerHeight - 40 && item.offsetParent != null;
    }) ?? null;
    const mark = (next: HTMLTableRowElement | null) => {
      document.querySelectorAll("tr[data-cursor]").forEach((item) => item.removeAttribute("data-cursor"));
      if (next) { next.dataset.cursor = "true"; next.scrollIntoView({ block: "nearest" }); }
    };
    const onPointer = (event: PointerEvent) => {
      const found = event.target instanceof Element ? event.target.closest(".t-main table") : null;
      if (found instanceof HTMLTableElement) { table = found; row = -1; mark(null); }
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], dialog")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
      if (!table || !table.isConnected) { table = visibleTable(); row = -1; }
      if (!table) return;
      const rows = rowsOf(table);
      if (!rows.length) return;
      if (event.key === "Enter") {
        if (row < 0 || !rows[row]) return;
        const action = rows[row].querySelector<HTMLElement>("a[href], button");
        if (!action) return;
        event.preventDefault();
        action.click();
        return;
      }
      event.preventDefault();
      row = event.key === "ArrowDown" ? Math.min(rows.length - 1, row + 1) : Math.max(0, row - 1);
      mark(rows[row]);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); window.removeEventListener("keydown", onKey); };
  }, []);
}

export function TermShell({ ticker = null, bare = false, children }: {
  ticker?: string | null;
  /** The screen brings its own <main> — a page borrowed whole from the document site. */
  bare?: boolean;
  children: React.ReactNode;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const prefs = useTermPrefs();
  useFocusedPanel();
  useTerminalLinks();
  useTableKeys();
  return (
    <div className="io term" data-density={prefs.density} data-colors={prefs.colors}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="t-top">
        <div className="t-bar">
          <a className="t-brand" href="/t" aria-label="Tenqay terminal home"><span className="t-brand-long">TENQAY</span><span className="t-brand-short" aria-hidden="true">TQ</span></a>
          <CommandLine current={ticker} onHelp={() => setHelpOpen(true)} />
          <div className="t-bar-right">
            <AlertsChip />
            <AccountChip />
            <button type="button" onClick={() => setHelpOpen(true)} className="t-amber">HELP</button>
            <a href="/t/settings" title="Settings and what this device keeps">SET</a>
          </div>
        </div>
        {prefs.tape ? <Tape /> : null}
        <FunctionKeys ticker={ticker} />
      </div>
      {bare ? <div className="t-main">{children}</div> : <main className="t-main" id="main-content" tabIndex={-1}>{children}</main>}
      <StatusLine />
      <Help open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
