"use client";

import { useState } from "react";
import { importBrokerCsv, type ImportResult } from "@/lib/broker-csv";
import type { Position } from "@/lib/portfolio";
import { parseTrades, writeTrades, type Transaction } from "@/lib/transactions";
import { parseHoldings, saveHoldings, saveTrades, writeHoldings } from "@/components/io/holdings";
import { useModalDialog } from "@/components/io/use-modal-dialog";
import { shortDate } from "@/components/io/format";

/**
 * The book, three ways in: dated trades typed one a line, undated holdings,
 * or a broker's CSV export read and previewed before anything is saved.
 *
 * Dated trades are what lets PORT tell a deposit from a gain and draw the
 * book as it actually was; undated holdings are priced back as though they
 * had always been held, and the screen says which it is reading.
 */

type Tab = "trades" | "holdings" | "import";

export function BookEditor({ trades, positions, onClose }: { trades: Transaction[]; positions: Position[]; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(trades.length || !positions.length ? "trades" : "holdings");
  const [tradesDraft, setTradesDraft] = useState(() => writeTrades(trades));
  const [holdingsDraft, setHoldingsDraft] = useState(() => writeHoldings(positions));
  const [imported, setImported] = useState<{ name: string; result: ImportResult } | null>(null);
  const [mode, setMode] = useState<"replace" | "add">("replace");
  const { dialogRef, initialFocusRef } = useModalDialog(onClose);

  const parsedTrades = parseTrades(tradesDraft);
  const parsedHoldings = parseHoldings(holdingsDraft);

  const read = async (file: File) => setImported({ name: file.name, result: importBrokerCsv(await file.text()) });
  const save = () => {
    if (tab === "trades") saveTrades(parsedTrades);
    else if (tab === "holdings") saveHoldings(parsedHoldings);
    else if (imported?.result.kind === "trades") saveTrades(mode === "add" ? [...trades, ...imported.result.transactions] : imported.result.transactions);
    else if (imported?.result.kind === "holdings") {
      if (mode === "add") {
        const merged = new Map(positions.map((position) => [position.ticker, position]));
        for (const position of imported.result.positions) {
          const held = merged.get(position.ticker);
          merged.set(position.ticker, held ? { ticker: position.ticker, shares: held.shares + position.shares, ...(held.cost != null && position.cost != null ? { cost: (held.cost * held.shares + position.cost * position.shares) / (held.shares + position.shares) } : {}) } : position);
        }
        saveHoldings([...merged.values()]);
      } else saveHoldings(imported.result.positions);
    } else return;
    onClose();
  };

  const result = imported?.result;
  const dates = result?.transactions.map((entry) => entry.date).sort() ?? [];
  const tickers = new Set([...(result?.transactions ?? []).map((entry) => entry.ticker), ...(result?.positions ?? []).map((entry) => entry.ticker)]);
  const canSave = tab === "trades" ? true : tab === "holdings" ? true : result != null && result.kind !== "none";

  return (
    <div className="watchlist-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="watchlist-editor t-book-editor" role="dialog" aria-modal="true" aria-labelledby="book-editor-title" tabIndex={-1}>
        <div className="watchlist-editor-head">
          <div>
            <p className="label">Kept on this device</p>
            <h2 id="book-editor-title">Edit the book</h2>
          </div>
          <button type="button" className="watchlist-close" onClick={onClose} aria-label="Close the book editor">×</button>
        </div>
        <div className="seg t-book-tabs" role="group" aria-label="How to enter the book">
          <button type="button" aria-pressed={tab === "trades"} onClick={() => setTab("trades")}>Dated trades</button>
          <button type="button" aria-pressed={tab === "holdings"} onClick={() => setTab("holdings")}>Holdings, undated</button>
          <button type="button" aria-pressed={tab === "import"} onClick={() => setTab("import")}>Import a broker CSV</button>
        </div>

        {tab === "trades" ? (
          <label className="watchlist-input">
            <span>One trade a line · date, buy or sell, ticker, shares @ price, and a fee if there was one</span>
            <textarea ref={initialFocusRef} value={tradesDraft} onChange={(event) => setTradesDraft(event.target.value)} spellCheck={false}
              placeholder={"2023-03-14 BUY AAPL 40 @ 150\n2024-01-10 BUY NVDA 30 @ 48.2 fee 1\n2025-06-02 SELL AAPL 10 @ 201.5"} />
          </label>
        ) : null}

        {tab === "holdings" ? (
          <label className="watchlist-input">
            <span>One holding a line · ticker, shares, and what you paid. Priced back as though always held; saving replaces any dated trades.</span>
            <textarea ref={initialFocusRef} value={holdingsDraft} onChange={(event) => setHoldingsDraft(event.target.value)} spellCheck={false}
              placeholder={"AAPL 40 @ 150\nNVDA 15\nCOST 8 @ 720.50"} />
          </label>
        ) : null}

        {tab === "import" ? (
          <div className="t-book-import">
            <label className="t-book-file">
              <span>A CSV export from Interactive Brokers, Schwab, Fidelity, Robinhood, Vanguard, E*TRADE — or any file with a date, a side, a symbol, a quantity and a price. A positions statement without dates imports as holdings.</span>
              <input type="file" accept=".csv,text/csv,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void read(file); }} />
            </label>
            {result ? (
              <div className="t-book-preview" aria-live="polite">
                <p>
                  <b>{imported!.name}</b> · read as <b>{result.format}</b> · {result.rows} rows ·{" "}
                  {result.kind === "trades"
                    ? <>{result.transactions.length} trades ({result.transactions.filter((entry) => entry.kind === "buy").length} buys, {result.transactions.filter((entry) => entry.kind === "sell").length} sales) in {tickers.size} tickers, {shortDate(dates[0])} to {shortDate(dates.at(-1))}</>
                    : result.kind === "holdings" ? <>{result.positions.length} holdings, undated</> : <>nothing that could be read as a trade or a holding</>}
                </p>
                {result.kind !== "none" ? (
                  <div className="sheet">
                    <table>
                      <thead>{result.kind === "trades"
                        ? <tr><th className="key">Date</th><th>Side</th><th>Ticker</th><th>Shares</th><th>Price</th><th>Fee</th></tr>
                        : <tr><th className="key">Ticker</th><th>Shares</th><th>Cost / share</th></tr>}</thead>
                      <tbody>
                        {result.kind === "trades"
                          ? result.transactions.slice(0, 8).map((entry) => <tr key={entry.id}><td className="key">{entry.date}</td><td>{entry.kind}</td><td>{entry.ticker}</td><td>{entry.shares}</td><td>{entry.price.toFixed(2)}</td><td>{entry.fee ? entry.fee.toFixed(2) : "—"}</td></tr>)
                          : result.positions.slice(0, 8).map((entry) => <tr key={entry.ticker}><td className="key">{entry.ticker}</td><td>{entry.shares}</td><td>{entry.cost?.toFixed(2) ?? "—"}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {result.skipped.length ? (
                  <details>
                    <summary>{result.skipped.length} rows left out — dividends, transfers, ISINs and the like</summary>
                    <ul>{result.skipped.slice(0, 30).map((entry) => <li key={`${entry.line}-${entry.reason}`}>Line {entry.line}: {entry.reason}</li>)}</ul>
                  </details>
                ) : null}
                {result.kind !== "none" ? (
                  <div className="seg" role="group" aria-label="Import mode">
                    <button type="button" aria-pressed={mode === "replace"} onClick={() => setMode("replace")}>Replace the book</button>
                    <button type="button" aria-pressed={mode === "add"} onClick={() => setMode("add")} disabled={result.kind === "trades" && !trades.length && positions.length > 0}
                      title={result.kind === "trades" && !trades.length && positions.length > 0 ? "Undated holdings cannot be merged with dated trades" : undefined}>Add to the book</button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="watchlist-editor-foot">
          <span className="label">
            {tab === "trades" ? `${parsedTrades.length} ${parsedTrades.length === 1 ? "trade" : "trades"}` : tab === "holdings" ? `${parsedHoldings.length} holdings` : result ? `${result.kind === "trades" ? result.transactions.length : result.positions.length} to import` : "No file yet"}
          </span>
          <div>
            {tab !== "import" ? <button type="button" className="watchlist-reset" onClick={() => (tab === "trades" ? setTradesDraft("") : setHoldingsDraft(""))}>Clear</button> : null}
            <button type="button" className="watchlist-save" onClick={save} disabled={!canSave}>{tab === "import" ? "Import" : "Save"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
