import { balanceSheetIsTheBusiness } from "@/lib/business-type";
import { annualRate, GROWTH_YIELD_CEILING, GROWTH_YIELD_YEARS, growthYield } from "@/lib/io/growth-yield";
import type { IoCompanyView } from "@/lib/io/view";
import type { IoQuote } from "./quote";
import { ABSENT, percent } from "./format";

/**
 * Whether the price is dear for the growth behind it, in one rate.
 *
 * The arithmetic and the reason for it are in `lib/io/growth-yield.ts`. The
 * market capitalisation is struck exactly as the statistics above strike it —
 * the engine's share count, today's price, the same currency or nothing — and
 * the free cash flow is the newest period that reports one, so the yield here
 * is the yield printed there.
 *
 * Withheld for a bank, a broker or an insurer, whose free cash flow is not a
 * measure of anything a shareholder is paid from.
 */
export function GrowthYield({ view, quote }: { view: IoCompanyView; quote: IoQuote | null }) {
  if (balanceSheetIsTheBusiness((view.company.businessType ?? undefined) as Parameters<typeof balanceSheetIsTheBusiness>[0])) return null;

  const basis = view.basis;
  const price = quote?.price ?? null;
  const sameCurrency = !quote?.currency || !basis || quote.currency === basis.currency;
  const marketCap = basis && sameCurrency && price != null && Number.isFinite(price) && price > 0 ? price * basis.shares : null;

  const series = [...view.annual, ...view.trailing].sort((left, right) => left.end.localeCompare(right.end));
  const cash = [...series].reverse().find((period) => period.values.freeCashFlow != null && Number.isFinite(period.values.freeCashFlow));
  const fcfYield = marketCap && cash ? cash.values.freeCashFlow! / marketCap : null;

  const rate = annualRate(view.annual, "revenuePerShare", GROWTH_YIELD_YEARS);
  const reading = growthYield(fcfYield, rate.value);
  if (reading.fcfYield == null && reading.growth == null) return null;

  const growthTitle = rate.reason ?? `${rate.startDate} to ${rate.endDate}${reading.capped ? ` · counted at ${percent(GROWTH_YIELD_CEILING, 0)}` : ""}`;
  const yieldTitle = cash ? `Free cash flow ${cash.label} over today's market capitalisation` : "No period reports a free cash flow";

  return (
    <section className="section growth-yield" id="growth-yield">
      <div className="section-head">
        <h2 className="label">Price against growth</h2>
        <span className="label">FCF yield + revenue / share {GROWTH_YIELD_YEARS}Y CAGR</span>
      </div>
      <div className="grid-ruled growth-yield-grid">
        <div className="stat" title="What a buyer earns at today's price if the business goes on growing as it has">
          <div className="label">Growth yield</div>
          <div className="stat-value" data-empty={reading.value == null}>{reading.value == null ? ABSENT : percent(reading.value, 1)}</div>
        </div>
        <div className="stat" title={yieldTitle}>
          <div className="label">FCF yield</div>
          <div className="stat-value" data-empty={reading.fcfYield == null}>{reading.fcfYield == null ? ABSENT : percent(reading.fcfYield, 1)}</div>
        </div>
        <div className="stat" title={growthTitle}>
          <div className="label">Revenue / share · {GROWTH_YIELD_YEARS}Y</div>
          <div className="stat-value" data-empty={reading.growth == null}>
            {reading.growth == null ? ABSENT : percent(reading.growth, 1)}
            {reading.capped ? <span className="dim"> · {percent(GROWTH_YIELD_CEILING, 0)} counted</span> : null}
          </div>
        </div>
      </div>
      <p className="stat-note">
        The return at today&apos;s price if the business goes on as it has: its cash yield plus five years of revenue growth per
        share, counted at no more than {percent(GROWTH_YIELD_CEILING, 0)} a year. Higher is cheaper for the growth.
      </p>
    </section>
  );
}
