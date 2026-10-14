"use client";

import { useEffect, useState } from "react";
import { costOfEquity, returnsOf, type CostOfEquity } from "@/lib/io/cost-of-equity";
import { FALLBACK_PREMIUM, type MarketPremium } from "@/lib/implied-erp";

/** Today's premium of the S&P 500 for this Treasury rate (app/api/market-premium), or the long-run one where it cannot be read. */
export async function fetchMarketPremium(riskFree: number | null, signal?: AbortSignal): Promise<MarketPremium | null> {
  if (riskFree == null) return null;
  try {
    const response = await fetch(`/api/market-premium?rf=${riskFree.toFixed(4)}`, { signal });
    return response.ok ? await response.json() as MarketPremium : null;
  } catch {
    return null;
  }
}

/**
 * This company's cost of equity: five years of its weekly returns against the
 * S&P 500 for the beta (lib/io/cost-of-equity.ts), on today's ten-year
 * Treasury. Null until it arrives, and null where it cannot be measured — the
 * model then states the rate it falls back on.
 */
export function useCostOfEquity(ticker: string): { value: CostOfEquity | null; settled: boolean; market: MarketPremium | null } {
  const [answer, setAnswer] = useState<{ ticker: string; value: CostOfEquity | null; market: MarketPremium | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const end = new Date();
    const from = new Date(end);
    from.setUTCFullYear(from.getUTCFullYear() - 5);
    const span = `frequency=weekly&start=${from.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`;
    const closes = async (symbol: string) => {
      const response = await fetch(`/api/market/${encodeURIComponent(symbol)}?${span}`, { signal: controller.signal });
      if (!response.ok) return null;
      const body = await response.json() as { bars?: Array<{ close?: number | null; adjustedClose?: number | null }> };
      return (body.bars ?? []).map((bar) => bar.adjustedClose ?? bar.close ?? null);
    };
    Promise.all([
      closes(ticker),
      closes("SPY"),
      fetch("/api/macro", { signal: controller.signal }).then((response) => (response.ok ? response.json() as Promise<{ indicators?: Array<{ id: string; value: number | null }> }> : null)),
    ]).then(async ([company, market, macro]) => {
      if (controller.signal.aborted) return;
      const yields = macro?.indicators?.find((item) => item.id === "treasury-10y")?.value ?? null;
      const riskFree = yields == null ? null : yields / 100;
      // The premium the index pays today rather than one chosen once (lib/implied-erp.ts).
      const premium = await fetchMarketPremium(riskFree, controller.signal);
      if (controller.signal.aborted) return;
      setAnswer({
        ticker,
        value: company && market ? costOfEquity(riskFree, returnsOf(company), returnsOf(market), premium?.premium ?? FALLBACK_PREMIUM) : null,
        market: premium,
      });
    }).catch(() => { if (!controller.signal.aborted) setAnswer({ ticker, value: null, market: null }); });
    return () => controller.abort();
  }, [ticker]);
  const current = answer?.ticker === ticker ? answer : null;
  return { value: current?.value ?? null, settled: current != null, market: current?.market ?? null };
}
