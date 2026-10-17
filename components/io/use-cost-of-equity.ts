"use client";

import { useEffect, useState } from "react";
import { alignedWeeklyReturns, costOfEquity, MIN_BETA_OBSERVATIONS, rawBeta, type CostOfEquity, type DatedClose } from "@/lib/io/cost-of-equity";
import { FALLBACK_PREMIUM, type MarketPremium } from "@/lib/implied-erp";

/** Index-implied premium where available; the long-run assumption is identified separately. */
export async function fetchMarketPremium(riskFree: number | null, signal?: AbortSignal): Promise<MarketPremium | null> {
  if (riskFree == null || !Number.isFinite(riskFree)) return null;
  try {
    const response = await fetch(`/api/market-premium?rf=${riskFree.toFixed(4)}`, { signal });
    const answer = response.ok ? await response.json() as MarketPremium : null;
    return answer && Number.isFinite(answer.premium) && answer.premium > 0 && answer.premium <= .25 ? answer : null;
  } catch {
    return null;
  }
}

export interface RiskFreeObservation {
  rate: number;
  date: string;
  source: "U.S. Treasury · yield curve" | "U.S. Treasury · macro";
}

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, { signal });
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  }
}

/** Reject undated or stale observations rather than presenting them as today's rate. */
function treasuryObservation(value: number | null | undefined, date: string | null | undefined, source: RiskFreeObservation["source"], asOf: Date): RiskFreeObservation | null {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 25 || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  const age = (asOf.getTime() - time) / 86_400_000;
  // Ten calendar days permits weekends and market holidays. Future observations
  // and longer outages require an explicit user assumption instead.
  if (!Number.isFinite(age) || age < 0 || age > 10) return null;
  return { rate: value / 100, date, source };
}

/** A narrow Treasury request avoids depending on unrelated macro providers. */
export async function fetchRiskFree(signal?: AbortSignal, asOf = new Date()): Promise<RiskFreeObservation | null> {
  const curve = await readJson<{ now?: { date?: string; points?: Array<{ years: number; value: number | null }> } }>("/api/yield-curve", signal);
  const direct = treasuryObservation(curve?.now?.points?.find((point) => point.years === 10)?.value, curve?.now?.date, "U.S. Treasury · yield curve", asOf);
  if (direct || signal?.aborted) return direct;
  const macro = await readJson<{ indicators?: Array<{ id: string; value: number | null; date?: string | null }> }>("/api/macro?country=US", signal);
  const point = macro?.indicators?.find((item) => item.id === "treasury-10y");
  return treasuryObservation(point?.value, point?.date, "U.S. Treasury · macro", asOf);
}

export type CostOfEquityUnavailableReason = "risk-free-unavailable" | "market-data-unavailable" | "insufficient-history" | "invalid-beta" | "invalid-cost-of-equity";
export interface CostOfEquityEstimate {
  value: CostOfEquity | null;
  settled: boolean;
  market: MarketPremium | null;
  /** Kept even when the company has insufficient history for a beta. */
  riskFree: number | null;
  riskFreeDate: string | null;
  riskFreeSource: RiskFreeObservation["source"] | null;
  unavailableReason: CostOfEquityUnavailableReason | null;
  observations: number;
  startDate: string | null;
  endDate: string | null;
  premiumSource: "index-implied" | "long-run-assumption";
}

const pending: CostOfEquityEstimate = {
  value: null, settled: false, market: null, riskFree: null, riskFreeDate: null,
  riskFreeSource: null, unavailableReason: null, observations: 0,
  startDate: null, endDate: null, premiumSource: "long-run-assumption",
};

/** Fetch independently: a failed beta must not erase an available Treasury rate. */
export async function loadCostOfEquity(ticker: string, signal?: AbortSignal, asOf = new Date()): Promise<CostOfEquityEstimate> {
  const from = new Date(asOf);
  from.setUTCFullYear(from.getUTCFullYear() - 5);
  const span = `frequency=weekly&start=${from.toISOString().slice(0, 10)}&end=${asOf.toISOString().slice(0, 10)}`;
  const history = (symbol: string) => readJson<{ bars?: DatedClose[] }>(`/api/market/${encodeURIComponent(symbol)}?${span}`, signal);
  const [company, benchmark, treasury] = await Promise.all([history(ticker), history("SPY"), fetchRiskFree(signal, asOf)]);
  const paired = alignedWeeklyReturns(company?.bars ?? [], benchmark?.bars ?? []);
  const market = await fetchMarketPremium(treasury?.rate ?? null, signal);
  const value = costOfEquity(treasury?.rate ?? null, paired.company, paired.market, market?.premium ?? FALLBACK_PREMIUM);
  const beta = rawBeta(paired.company, paired.market);
  const unavailableReason: CostOfEquityUnavailableReason | null = value ? null
    : !treasury ? "risk-free-unavailable"
      : !company?.bars?.length || !benchmark?.bars?.length ? "market-data-unavailable"
        : paired.company.length < MIN_BETA_OBSERVATIONS ? "insufficient-history"
          : beta == null || !Number.isFinite(beta) || beta <= 0 ? "invalid-beta"
            : "invalid-cost-of-equity";
  return {
    value, settled: true, market, riskFree: treasury?.rate ?? null,
    riskFreeDate: treasury?.date ?? null, riskFreeSource: treasury?.source ?? null,
    unavailableReason, observations: paired.company.length, startDate: paired.startDate, endDate: paired.endDate,
    premiumSource: market && !market.fallback ? "index-implied" : "long-run-assumption",
  };
}

/** Five years of exactly matched weekly adjusted returns against SPY, in USD. */
export function useCostOfEquity(ticker: string): CostOfEquityEstimate {
  const [answer, setAnswer] = useState<{ ticker: string; estimate: CostOfEquityEstimate } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadCostOfEquity(ticker, controller.signal).then((estimate) => {
      if (!controller.signal.aborted) setAnswer({ ticker, estimate });
    }).catch(() => {
      if (!controller.signal.aborted) setAnswer({ ticker, estimate: { ...pending, settled: true, unavailableReason: "market-data-unavailable" } });
    });
    return () => controller.abort();
  }, [ticker]);
  return answer?.ticker === ticker ? answer.estimate : pending;
}
