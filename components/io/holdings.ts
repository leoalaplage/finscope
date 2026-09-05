"use client";

import { useSyncExternalStore } from "react";
import type { Position } from "@/lib/portfolio";

/**
 * What a reader holds, kept in their own browser.
 *
 * Shares, not weights, because shares are what a brokerage statement says and
 * a weight is what follows from them. Nothing is uploaded: the book is written
 * to this device's storage and read back from it, the same way the watchlist
 * is, and the page that values it does so in the browser from figures that were
 * public before anybody typed anything in.
 */

export const HOLDINGS_KEY = "finscope.io.portfolio.v1";
export const HOLDINGS_EVENT = "finscope:portfolio";
export const HOLDINGS_LIMIT = 60;

const TICKER = /^[A-Z][A-Z0-9.-]{0,11}$/;

/**
 * A line of the book, as somebody would actually type it.
 *
 * `AAPL 40`, `AAPL 40 @ 150.25`, `AAPL, 40, 150.25` — a symbol, a share count,
 * and optionally what it cost, in any of the punctuations a person reaches for.
 * Fractional shares are ordinary now, so they are accepted; a thousands
 * separator, a currency sign and an `@` are stripped rather than refused.
 *
 * A line that names no ticker or no positive share count is skipped in silence.
 * This runs on every keystroke while the editor is open, and half a typed line
 * is not an error, it is a line somebody is still typing.
 */
export function parseHoldings(text: string): Position[] {
  const held = new Map<string, { shares: number; cost: number; costedShares: number }>();
  for (const line of text.split(/[\n;]+/)) {
    const parts = words(line);
    if (!parts.length) continue;
    const ticker = parts[0].toUpperCase();
    if (!TICKER.test(ticker)) continue;
    // Only what carries a digit: a lone `@`, a stray dash or the word "shares"
    // is punctuation, and reading it as a nought would take a real cost away.
    const numbers = parts.slice(1)
      .map((token) => token.replace(/[@$€£]/g, ""))
      .filter((token) => /\d/.test(token))
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    const [shares, cost] = numbers;
    if (!(shares > 0)) continue;
    const current = held.get(ticker) ?? { shares: 0, cost: 0, costedShares: 0 };
    /*
     * Two lines for one company are two lots of it, not a correction.
     *
     * The shares add and the cost is averaged over the shares that carry one,
     * so a lot entered without a price does not drag the average towards zero —
     * it simply is not part of it.
     */
    held.set(ticker, {
      shares: current.shares + shares,
      cost: cost != null && cost > 0 ? current.cost + cost * shares : current.cost,
      costedShares: cost != null && cost > 0 ? current.costedShares + shares : current.costedShares,
    });
    if (held.size === HOLDINGS_LIMIT) break;
  }
  return [...held].map(([ticker, lot]) => ({
    ticker,
    shares: lot.shares,
    ...(lot.costedShares > 0 ? { cost: lot.cost / lot.costedShares } : {}),
  }));
}

/**
 * A line, split the way a person writes one.
 *
 * Whitespace separates, and so does a comma — except inside a number, where a
 * comma is how everybody writes a thousand. `WMT 2,000 @ 90` is two thousand
 * shares and `AAPL,40,150` is three fields, and the difference is whether the
 * comma groups three digits at a time.
 */
function words(line: string): string[] {
  return line.trim().split(/\s+/).flatMap((token) => {
    const bare = token.replace(/^[,;]+|[,;]+$/g, "");
    if (!bare) return [];
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(bare)) return [bare.replace(/,/g, "")];
    return bare.split(",").filter(Boolean);
  });
}

/** The book as the editor shows it: one line a holding, in the order held. */
export function writeHoldings(positions: Position[]): string {
  return positions
    .map((position) => `${position.ticker} ${trim(position.shares)}${position.cost ? ` @ ${trim(position.cost)}` : ""}`)
    .join("\n");
}

const trim = (value: number) => Number(value.toFixed(4)).toString();

function subscribe(notify: () => void) {
  window.addEventListener(HOLDINGS_EVENT, notify);
  // Another tab editing the book is the same edit, and reaches here as a
  // storage event rather than as ours.
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(HOLDINGS_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
}

const read = () => {
  try { return localStorage.getItem(HOLDINGS_KEY); } catch { return null; }
};

const EMPTY: Position[] = [];

/**
 * The stored book, or an empty one.
 *
 * There is no default portfolio and there could not be: a watchlist of the
 * largest twenty-seven companies is a reasonable thing to hand somebody who has
 * chosen nothing, and a portfolio of them is a claim about their money.
 */
export function useStoredHoldings(): Position[] {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  try {
    const value = JSON.parse(stored ?? "null") as unknown;
    if (!Array.isArray(value)) return EMPTY;
    const parsed = value.flatMap((item) => {
      if (typeof item !== "object" || item == null) return [];
      const { ticker, shares, cost } = item as Record<string, unknown>;
      if (typeof ticker !== "string" || !TICKER.test(ticker.toUpperCase())) return [];
      if (typeof shares !== "number" || !Number.isFinite(shares) || shares <= 0) return [];
      const priced = typeof cost === "number" && Number.isFinite(cost) && cost > 0;
      return [{ ticker: ticker.toUpperCase(), shares, ...(priced ? { cost: cost as number } : {}) }];
    });
    return parsed.length ? parsed.slice(0, HOLDINGS_LIMIT) : EMPTY;
  } catch {
    // A book that cannot be read is an empty one, never a wrong one.
    return EMPTY;
  }
}

export function saveHoldings(positions: Position[]) {
  try {
    localStorage.setItem(HOLDINGS_KEY, JSON.stringify(positions));
    window.dispatchEvent(new Event(HOLDINGS_EVENT));
  } catch { /* The in-memory edit still works. */ }
}
