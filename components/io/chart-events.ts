"use client";

import { useEffect, useState } from "react";

/**
 * What happened to a company on the chart's dates: its earnings releases (the
 * 8-K item 2.02 filings in its SEC index) and its dividends (twenty-five years
 * of payments). Read only for a company — an index, a future or a coin has
 * neither — and only when the reader has the markers on.
 */

export interface ChartEvent { kind: "earnings" | "dividend"; date: string; amount?: number }

const COMPANY = /^[A-Z][A-Z0-9.-]{0,9}$/;

export function useChartEvents(symbol: string, enabled: boolean): ChartEvent[] {
  const [loaded, setLoaded] = useState<{ symbol: string; events: ChartEvent[] }>({ symbol: "", events: [] });
  const wanted = enabled && COMPANY.test(symbol);
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    const read = async <T,>(url: string): Promise<T | null> => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        return response.ok ? await response.json() as T : null;
      } catch {
        return null;
      }
    };
    (async () => {
      const [matches, dividends] = await Promise.all([
        read<Array<{ ticker: string; cik?: string }>>(`/api/resolve?q=${encodeURIComponent(symbol)}`),
        read<{ payments?: Array<{ date: string; amount: number }> }>(`/api/io/${encodeURIComponent(symbol)}/dividends`),
      ]);
      const cik = matches?.find((match) => match.ticker.toUpperCase().replace("-", ".") === symbol.replace("-", "."))?.cik;
      const history = cik ? await read<{ dates?: string[] }>(`/api/io/${encodeURIComponent(symbol)}/earnings-history?cik=${encodeURIComponent(String(Number(cik)))}`) : null;
      if (controller.signal.aborted) return;
      const events: ChartEvent[] = [
        ...(history?.dates ?? []).map((date) => ({ kind: "earnings" as const, date })),
        ...(dividends?.payments ?? []).map((payment) => ({ kind: "dividend" as const, date: payment.date, amount: payment.amount })),
      ];
      setLoaded({ symbol, events });
    })();
    return () => controller.abort();
  }, [symbol, wanted]);
  return wanted && loaded.symbol === symbol ? loaded.events : [];
}
