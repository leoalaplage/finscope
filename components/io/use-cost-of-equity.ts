"use client";

import { useEffect, useState } from "react";
import { costOfEquity, returnsOf, type CostOfEquity } from "@/lib/io/cost-of-equity";

/**
 * This company's cost of equity: five years of its weekly returns against the
 * S&P 500 for the beta (lib/io/cost-of-equity.ts), on today's ten-year
 * Treasury. Null until it arrives, and null where it cannot be measured — the
 * model then states the rate it falls back on.
 */
export function useCostOfEquity(ticker: string): { value: CostOfEquity | null; settled: boolean } {
  const [answer, setAnswer] = useState<{ ticker: string; value: CostOfEquity | null } | null>(null);
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
    ]).then(([company, market, macro]) => {
      if (controller.signal.aborted) return;
      const yields = macro?.indicators?.find((item) => item.id === "treasury-10y")?.value ?? null;
      setAnswer({ ticker, value: company && market ? costOfEquity(yields == null ? null : yields / 100, returnsOf(company), returnsOf(market)) : null });
    }).catch(() => { if (!controller.signal.aborted) setAnswer({ ticker, value: null }); });
    return () => controller.abort();
  }, [ticker]);
  const current = answer?.ticker === ticker ? answer : null;
  return { value: current?.value ?? null, settled: current != null };
}
