"use client";

import { useEffect, useMemo, useState } from "react";
import type { Estimates } from "@/lib/estimates";
import type { IoCompanyView } from "@/lib/io/view";
import { keyStatistics, type StatRow } from "@/lib/io/key-statistics";
import { isValuationMetric } from "./valuation-series";
import type { IoQuote } from "./quote";
import { ABSENT, compact, money, percent, price as writePrice } from "./format";

/**
 * DES on the terminal: eight compact blocks of figures (lib/io/key-statistics.ts)
 * in as many columns as the panel has room for. The market value and the
 * enterprise value are struck exactly as on the tiles they replace
 * (components/io/Stats.tsx), whose notes still say what each figure rests on.
 */
export function KeyStatistics({ view, quote, shown = [], onShow }: {
  view: IoCompanyView; quote: IoQuote | null;
  /** The measures the price chart draws now, and how to put one there in the price's place. */
  shown?: string[]; onShow?: (metric: string) => void;
}) {
  const basis = view.basis;
  const price = quote?.price ?? null;
  const currency = basis?.currency ?? view.company.currency;
  const usable = basis != null && price != null && Number.isFinite(price) && price > 0 && (!quote?.currency || quote.currency === basis.currency);
  const marketCap = usable ? price * basis.shares : null;
  const enterpriseValue = usable && basis.netDebt != null ? marketCap! + basis.netDebt + (basis.minorityInterest != null && basis.minorityInterest > 0 ? basis.minorityInterest : 0) : null;

  // The consensus is per US-listed share in dollars: only for a company that files in dollars and trades as itself.
  const forwardable = usable && currency === "USD" && !quote?.conversion;
  const [estimates, setEstimates] = useState<{ ticker: string; data: Estimates | null } | null>(null);
  useEffect(() => {
    if (!forwardable) return;
    const controller = new AbortController();
    fetch(`/api/estimates/${encodeURIComponent(view.company.ticker)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ estimates: Estimates }> : null))
      .then((body) => setEstimates({ ticker: view.company.ticker, data: body?.estimates ?? null }))
      .catch(() => { if (!controller.signal.aborted) setEstimates({ ticker: view.company.ticker, data: null }); });
    return () => controller.abort();
  }, [forwardable, view.company.ticker]);
  const consensus = forwardable && estimates?.ticker === view.company.ticker ? estimates.data : null;

  const blocks = useMemo(
    () => keyStatistics({ view, price: usable ? price : null, marketCap, enterpriseValue, shares: basis?.shares ?? null, estimates: consensus }),
    [view, usable, price, marketCap, enterpriseValue, basis, consensus],
  );

  const write = (row: StatRow) => {
    const value = row.value;
    if (value == null) return ABSENT;
    switch (row.kind) {
      case "money": return money(value, currency);
      case "count": return compact(value);
      case "percent": return percent(value, 1);
      case "multiple": return value.toFixed(1);
      case "price": return writePrice(value, currency);
    }
  };

  if (!blocks.length) return null;
  return (
    <div className="t-keystats">
      {blocks.map((block) => (
        <section key={block.title} className="t-keystats-block" aria-label={block.title}>
          <h3>{block.title}</h3>
          <dl>
            {block.rows.map((row) => {
              // A figure whose series this page can draw: a click puts it in the chart above, a second click the price back.
              const drawable = onShow && row.metric && (isValuationMetric(row.metric) || view.metrics.some((metric) => metric.key === row.metric)) ? row.metric : null;
              const on = drawable != null && shown.length === 1 && shown[0] === drawable;
              return (
                <div
                  key={row.label} title={drawable ? `${row.title ? `${row.title}. ` : ""}${on ? "Back to the price" : "Chart it in place of the price"}` : row.title}
                  {...(drawable ? {
                    role: "button", tabIndex: 0, "data-drawable": true, "aria-pressed": on,
                    onClick: () => onShow!(drawable),
                    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onShow!(drawable); } },
                  } : {})}
                >
                  <dt>{row.label}</dt>
                  <dd data-neg={row.kind === "percent" && row.value != null && row.value < 0 || undefined}>{write(row)}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}
