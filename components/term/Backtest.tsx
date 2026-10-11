"use client";

import { useEffect, useMemo, useState } from "react";
import { chooseSymbol } from "@/components/io/choose-symbol";
import { price, shortDate } from "@/components/io/format";
import type { Candles } from "@/lib/adapters/candles";
import { backtest, cleanConditions, computeSeries, STRATEGY_PRESETS, type BacktestResult, type Condition } from "@/lib/term/rules";
import { ConditionEditor } from "./ConditionEditor";
import { Panel } from "./Panel";
import { useStoredText, writeStored } from "./stored";

/**
 * The backtester: one symbol, an entry rule and an exit rule, run over every
 * bar of up to twenty-five years, against simply holding the stock.
 *
 * The arithmetic is lib/term/rules.ts — next-open fills, stops and targets
 * at their level, costs on both sides — and runs in the browser on the long
 * history the candles endpoint keeps for an hour. No dividends on either
 * side, so the comparison is like for like and both understate a payer.
 */

const KEY = "finscope.term.backtest.v1";
type Interval = "1d" | "1wk";

interface Stored {
  symbol: string;
  interval: Interval;
  entry: Condition[];
  exit: Condition[];
  stopLoss: number | null;
  takeProfit: number | null;
  costBps: number;
}

const DEFAULTS: Stored = {
  symbol: "AAPL", interval: "1d", entry: STRATEGY_PRESETS[0].entry, exit: STRATEGY_PRESETS[0].exit,
  stopLoss: null, takeProfit: null, costBps: 5,
};

const percentOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1 ? value : null);

function readStored(text: string | null): Stored {
  try {
    const raw = JSON.parse(text ?? "null") as Partial<Stored> | null;
    if (!raw) return DEFAULTS;
    return {
      symbol: typeof raw.symbol === "string" && /^\^?[A-Z0-9][A-Z0-9.-]{0,11}$/.test(raw.symbol) ? raw.symbol : DEFAULTS.symbol,
      interval: raw.interval === "1wk" ? "1wk" : "1d",
      entry: cleanConditions(raw.entry),
      exit: cleanConditions(raw.exit),
      stopLoss: percentOrNull(raw.stopLoss),
      takeProfit: percentOrNull(raw.takeProfit),
      costBps: typeof raw.costBps === "number" && raw.costBps >= 0 && raw.costBps <= 200 ? raw.costBps : DEFAULTS.costBps,
    };
  } catch {
    return DEFAULTS;
  }
}

const pct = (value: number | null | undefined, places = 1) =>
  value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(places)}%`;
const dir = (value: number | null | undefined) => (value == null ? undefined : value < 0 ? "down" : "up");
const day = (seconds: number) => shortDate(new Date(seconds * 1000).toISOString());

/** The strategy's value against holding the stock, on a log scale so a doubling is a doubling anywhere. */
function EquityChart({ result, times }: { result: BacktestResult; times: number[] }) {
  const W = 1000;
  const H = 260;
  const all = [...result.equity, ...result.benchmark].filter((value) => value > 0);
  const low = Math.log(Math.min(...all));
  const high = Math.log(Math.max(...all));
  const x = (index: number) => (index / Math.max(1, result.equity.length - 1)) * W;
  const y = (value: number) => H - ((Math.log(Math.max(value, 1e-9)) - low) / (high - low || 1)) * (H - 10) - 5;
  const path = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join("");
  const years: { index: number; text: string }[] = [];
  let previous = -1;
  times.forEach((time, index) => {
    const year = new Date(time * 1000).getUTCFullYear();
    if (year !== previous && index > 0) years.push({ index, text: String(year) });
    previous = year;
  });
  const step = Math.ceil(years.length / 10) || 1;
  return (
    <figure className="t-equity" aria-label="Strategy against buy and hold">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1={0} x2={W} y1={y(1)} y2={y(1)} className="t-equity-base" vectorEffect="non-scaling-stroke" />
        {result.trades.map((trade) => (
          <rect
            key={trade.entryIndex} className="t-equity-held"
            x={x(trade.entryIndex - result.start)} width={Math.max(1, x(trade.exitIndex - result.start) - x(trade.entryIndex - result.start))}
            y={0} height={H}
          />
        ))}
        <path d={path(result.benchmark)} className="t-equity-hold" vectorEffect="non-scaling-stroke" />
        <path d={path(result.equity)} className="t-equity-strategy" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="t-equity-years" aria-hidden="true">
        {years.filter((_, at) => at % step === 0).map((label) => (
          <span key={label.index} style={{ left: `${(label.index / Math.max(1, times.length - 1)) * 100}%` }}>{label.text}</span>
        ))}
      </div>
      <figcaption className="t-equity-legend">
        <span><i className="t-equity-key-strategy" />Strategy</span>
        <span><i className="t-equity-key-hold" />Buy and hold</span>
        <span><i className="t-equity-key-held" />In the market</span>
        <span className="t-dim">log scale</span>
      </figcaption>
    </figure>
  );
}

export function Backtest() {
  const stored = readStored(useStoredText(KEY));
  const save = (change: Partial<Stored>) => writeStored(KEY, { ...stored, ...change });
  const [typed, setTyped] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; candles: Candles | null; error: string | null } | null>(null);

  // A link from the scanner or the command line names the symbol, once.
  useEffect(() => {
    const url = new URL(window.location.href);
    const asked = url.searchParams.get("s")?.toUpperCase();
    if (!asked) return;
    writeStored(KEY, { ...readStored(localStorage.getItem(KEY)), symbol: asked });
    url.searchParams.delete("s");
    window.history.replaceState(null, "", url);
  }, []);

  const key = `${stored.symbol}:${stored.interval}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/candles/${encodeURIComponent(stored.symbol)}?interval=${stored.interval}&span=max`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as Candles & { error?: string };
        if (!response.ok || !body.t?.length) throw new Error(body.error ?? `No price history for ${stored.symbol}.`);
        setLoaded({ key, candles: body, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ key, candles: null, error: error instanceof Error ? error.message : "Unreachable." });
      });
    return () => controller.abort();
  }, [key, stored.symbol, stored.interval]);

  const candles = loaded?.key === key ? loaded.candles : null;
  const series = useMemo(() => (candles ? computeSeries(candles) : null), [candles]);
  const entryKey = JSON.stringify([stored.entry, stored.exit, stored.stopLoss, stored.takeProfit, stored.costBps]);
  const result = useMemo(() => {
    if (!candles || !series) return null;
    return backtest(candles, series, stored.entry, stored.exit, { stopLoss: stored.stopLoss, takeProfit: stored.takeProfit, costBps: stored.costBps });
    // The stored rule is read fresh every render; its JSON says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, series, entryKey]);

  const resolve = async () => {
    const text = (typed ?? "").trim();
    setTyped(null);
    if (!text) return;
    if (text.startsWith("^")) { save({ symbol: text.toUpperCase() }); return; }
    try {
      const response = await fetch(`/api/resolve?q=${encodeURIComponent(text)}`);
      const matches = response.ok ? await response.json() as { ticker: string }[] : [];
      save({ symbol: chooseSymbol(text, matches) ?? text.toUpperCase() });
    } catch {
      save({ symbol: text.toUpperCase() });
    }
  };

  const numberField = (label: string, value: number | null, onValue: (next: number | null) => void, suffix: string) => (
    <label className="t-bt-field">
      <span>{label}</span>
      <input
        type="number" min={0} step="any" value={value == null ? "" : value} placeholder="off"
        onChange={(event) => onValue(event.target.value === "" ? null : Number(event.target.value))}
      />
      <span className="t-dim">{suffix}</span>
    </label>
  );

  const span = result && candles ? `${day(candles.t[result.start])} – ${day(candles.t[candles.t.length - 1])}` : "";
  const stats: Array<[string, string, string | undefined, string, string | undefined]> = result ? [
    ["Total return", pct(result.totalReturn), dir(result.totalReturn), pct(result.benchmarkReturn), dir(result.benchmarkReturn)],
    ["CAGR", pct(result.cagr), dir(result.cagr), pct(result.benchmarkCagr), dir(result.benchmarkCagr)],
    ["Max drawdown", pct(result.maxDrawdown), "down", pct(result.benchmarkDrawdown), "down"],
    ["Time in market", `${(result.exposure * 100).toFixed(0)}%`, undefined, "100%", undefined],
    ["Trades", String(result.trades.length), undefined, "1", undefined],
    ["Win rate", result.winRate == null ? "—" : `${(result.winRate * 100).toFixed(0)}%`, undefined, "", undefined],
    ["Average trade", pct(result.averageTrade, 2), dir(result.averageTrade), "", undefined],
    ["Profit factor", result.profitFactor == null ? "—" : result.profitFactor.toFixed(2), undefined, "", undefined],
    ["Best / worst trade", `${pct(result.bestTrade)} / ${pct(result.worstTrade)}`, undefined, "", undefined],
  ] : [];

  return (
    <div className="t-grid t-bt">
      <Panel code="BT" title="Strategy" area="setup" actions={
        <select
          aria-label="Start from a preset" value=""
          onChange={(event) => { const preset = STRATEGY_PRESETS[Number(event.target.value)]; if (preset) save({ entry: preset.entry, exit: preset.exit }); }}
        >
          <option value="" disabled>Presets…</option>
          {STRATEGY_PRESETS.map((preset, at) => <option key={preset.name} value={at}>{preset.name}</option>)}
        </select>
      }>
        <div className="t-panel-pad">
          <div className="t-bt-top">
            <form className="t-symbol" onSubmit={(event) => { event.preventDefault(); void resolve(); }}>
              <input
                value={typed ?? stored.symbol} aria-label="Symbol" spellCheck={false} autoCapitalize="characters"
                onFocus={(event) => { setTyped(""); event.currentTarget.select(); }} onBlur={() => setTyped(null)}
                onChange={(event) => setTyped(event.target.value)}
              />
            </form>
            <div className="seg" role="group" aria-label="Bars">
              <button type="button" aria-pressed={stored.interval === "1d"} onClick={() => save({ interval: "1d" })}>Daily</button>
              <button type="button" aria-pressed={stored.interval === "1wk"} onClick={() => save({ interval: "1wk" })}>Weekly</button>
            </div>
            <span className="t-dim">{candles ? `${candles.name} · ${candles.t.length} bars` : loaded?.error ?? "Loading history…"}</span>
          </div>
          <h3 className="t-bt-head">Enter long when</h3>
          <ConditionEditor conditions={stored.entry} onChange={(entry) => save({ entry })} label="Entry rule" />
          <h3 className="t-bt-head">Exit when</h3>
          <ConditionEditor conditions={stored.exit} onChange={(exit) => save({ exit })} label="Exit rule" />
          <div className="t-bt-options">
            {numberField("Stop loss", stored.stopLoss == null ? null : +(stored.stopLoss * 100).toFixed(2), (value) => save({ stopLoss: value ? value / 100 : null }), "%")}
            {numberField("Take profit", stored.takeProfit == null ? null : +(stored.takeProfit * 100).toFixed(2), (value) => save({ takeProfit: value ? value / 100 : null }), "%")}
            {numberField("Cost per side", stored.costBps, (value) => save({ costBps: value ?? 0 }), "bps")}
          </div>
          <p className="t-study-note">
            Long only, all in. Rules are read on a bar&apos;s close and filled at the next open; stops and targets fill at their level, or at the open
            when it gaps through. No dividends on either side. A test of the past, not a forecast and not advice.
          </p>
        </div>
      </Panel>

      <Panel code="BT" title={result ? `Result · ${stored.symbol} · ${span}` : "Result"} area="result">
        {!candles ? <p className="t-empty">{loaded?.error ?? "Loading twenty-five years of prices…"}</p> : null}
        {candles && !result ? <p className="t-empty">The rule never has the history it needs on these bars. Try daily bars or shorter averages.</p> : null}
        {result && candles ? (
          <>
            <EquityChart result={result} times={candles.t.slice(result.start)} />
            <div className="sheet t-bt-stats">
              <table>
                <thead><tr><th className="key" /><th>Strategy</th><th>Buy and hold</th></tr></thead>
                <tbody>
                  {stats.map(([name, strategy, strategyDir, hold, holdDir]) => (
                    <tr key={name}>
                      <th className="key">{name}</th>
                      <td data-dir={strategyDir}>{strategy}</td>
                      <td data-dir={holdDir}>{hold}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Panel>

      {result && candles && result.trades.length ? (
        <Panel code="BT" title={`Trades · ${result.trades.length}`} area="trades">
          <div className="sheet t-bt-trades">
            <table>
              <thead>
                <tr><th className="key">#</th><th>Entry</th><th>Price</th><th>Exit</th><th>Price</th><th>Bars</th><th>Return</th><th>Exit by</th></tr>
              </thead>
              <tbody>
                {[...result.trades].reverse().map((trade, at) => (
                  <tr key={trade.entryIndex}>
                    <td className="key t-dim">{result.trades.length - at}</td>
                    <td>{day(trade.entryTime)}</td>
                    <td>{price(trade.entryPrice, null)}</td>
                    <td>{trade.reason === "open" ? "open" : day(trade.exitTime)}</td>
                    <td>{price(trade.exitPrice, null)}</td>
                    <td>{trade.bars}</td>
                    <td data-dir={dir(trade.return)}>{pct(trade.return, 2)}</td>
                    <td className="t-dim">{trade.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
