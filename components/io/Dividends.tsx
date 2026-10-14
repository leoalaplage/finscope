"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { DividendPayment } from "@/lib/adapters/yahoo-dividends";
import { dividendRecord } from "@/lib/dividends";
import type { IoCompanyView } from "@/lib/io/view";
import type { ChartData, Preset } from "@/lib/term/fundamental-charts";
import { ComboChart } from "@/components/term/FundamentalCharts";
import { ABSENT, price as writePrice, shortDate } from "./format";

const pct = (value: number | null | undefined, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${(value * 100).toFixed(places)}%`);
const signed = (value: number | null | undefined, places = 1) => (value == null || !Number.isFinite(value) ? ABSENT : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(places)}%`);
const tone = (value: number | null | undefined) => (value == null ? undefined : value >= 0 ? "up" : "down");
const RHYTHM: Record<number, string> = { 12: "Monthly", 4: "Quarterly", 2: "Twice a year", 1: "Yearly" };

/**
 * DVD: the dividend as an income investor reads it — the yield on today's
 * price, the rate, how fast it has grown, how many years in a row it has been
 * raised, how much of the earnings and of the free cash flow it takes, and the
 * next ex-date the company's rhythm points to. Payments from Yahoo's history
 * (lib/adapters/yahoo-dividends.ts), payout from the filings.
 */
export function Dividends({ view, price }: { view: IoCompanyView; price: number | null }) {
  const ticker = view.company.ticker;
  const [answer, setAnswer] = useState<{ ticker: string; payments: DividendPayment[] | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/io/${encodeURIComponent(ticker)}/dividends`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ payments: DividendPayment[] }> : null))
      .then((body) => { if (!controller.signal.aborted) setAnswer({ ticker, payments: body?.payments ?? null }); })
      .catch(() => { if (!controller.signal.aborted) setAnswer({ ticker, payments: null }); });
    return () => controller.abort();
  }, [ticker]);

  const payments = answer?.ticker === ticker ? answer.payments : undefined;
  const record = useMemo(() => (payments ? dividendRecord(payments) : null), [payments]);
  const currency = view.company.currency;
  const trailing = view.trailing.at(-1) ?? view.annual.at(-1);
  const paid = trailing?.values.dividendsPaid ?? null;
  const payoutEarnings = trailing?.values.dividendPayout ?? null;
  const fcf = trailing?.values.freeCashFlow ?? null;
  const payoutCash = paid != null && fcf != null && fcf > 0 ? Math.abs(paid) / fcf : null;

  if (payments === undefined) return <p className="t-empty">Reading the dividend record…</p>;
  if (payments === null) return <p className="t-empty">The dividend record could not be read just now.</p>;
  if (!record || (!record.annualRate && record.trailing === 0)) {
    return <p className="t-empty">{payments.length ? `No dividend paid since ${shortDate(payments.at(-1)!.date)}.` : "This company has paid no dividend in the last 25 years."}</p>;
  }

  const yieldNow = record.annualRate != null && price ? record.annualRate / price : null;
  const shown = record.years.filter((entry) => entry.regular + entry.special > 0).slice(-16);
  const growth = shown.map((entry, index) => {
    const before = shown[index - 1];
    return before && entry.complete && before.complete && before.rate > 0 && entry.year === before.year + 1 ? entry.rate / before.rate - 1 : null;
  });
  const data: ChartData = {
    labels: shown.map((entry) => `${entry.complete ? "" : "YTD "}${String(entry.year).slice(2)}`),
    names: shown.map((entry) => `${entry.year}${entry.complete ? "" : " · so far"} · ${entry.payments} payment${entry.payments === 1 ? "" : "s"}`),
    series: [
      { spec: { id: "regular", label: "Regular dividend", kind: "bar", axis: "left", color: "var(--c2)", value: () => null }, values: shown.map((entry) => entry.regular), colors: shown.map((entry) => (entry.complete ? null : "var(--ink-3)")) },
      ...(shown.some((entry) => entry.special > 0) ? [{ spec: { id: "special", label: "Special", kind: "bar" as const, axis: "left" as const, color: "var(--c5)", value: () => null }, values: shown.map((entry) => entry.special || null) }] : []),
      { spec: { id: "growth", label: "Rate growth on a year (right)", kind: "line", axis: "right", color: "var(--amber)", value: () => null }, values: growth },
    ],
  };
  const preset: Preset = { id: "dividends", title: "Dividend a share, by year", left: "perShare", right: "percent", series: data.series.map((entry) => entry.spec) };

  return (
    <div className="dvd">
      <div className="grid-ruled stats dvd-strip">
        <Figure label="Yield" value={pct(yieldNow, 2)} note={record.annualRate != null ? `${writePrice(record.annualRate, currency)} a year at ${price ? writePrice(price, currency) : ABSENT}` : "No regular rate"} />
        <Figure label="Raised" value={record.raisedYears ? `${record.raisedYears}${record.raisedSinceRecord ? "+" : ""} year${record.raisedYears === 1 ? "" : "s"} in a row` : "Not last year"} note={record.raisedSinceRecord ? `Every year since ${record.years.find((entry) => entry.complete)?.year ?? "the record began"}, as far as the record goes` : record.uncutYears > record.raisedYears ? `Not cut for ${record.uncutYears} years` : RHYTHM[record.frequency ?? 0] ?? undefined} />
        <Figure label="Growth · 5 years" value={signed(record.growth5)} tone={tone(record.growth5)} note={`1Y ${signed(record.growth1)} · 10Y ${signed(record.growth10)} a year`} />
        <Figure label="Payout · earnings" value={pct(payoutEarnings, 0)} tone={payoutEarnings != null && payoutEarnings > 0.9 ? "down" : undefined} note={`Of free cash flow ${pct(payoutCash, 0)}`} />
        <Figure label="Next ex-date" value={record.nextExpected ? shortDate(record.nextExpected) : ABSENT} note={record.nextExpected ? "Expected from the rhythm, not announced" : record.last ? `Last ${shortDate(record.last.date)}` : undefined} />
      </div>
      <div className="dvd-grid">
        <figure className="t-gf-card">
          <figcaption><h3>Dividend a share, by calendar year</h3></figcaption>
          <ComboChart preset={preset} data={data} currency={currency} height={220} />
          <ul className="t-gf-legend">
            {data.series.map((entry) => <li key={entry.spec.id} data-kind={entry.spec.kind} style={{ "--key": entry.spec.color } as CSSProperties}><i aria-hidden="true" />{entry.spec.label}</li>)}
          </ul>
        </figure>
        <div className="sheet dvd-sheet">
          <table>
            <thead><tr><th className="key">Ex-date</th><th>A share</th><th>Change</th></tr></thead>
            <tbody>
              {record.payments.slice(0, 12).map((payment) => (
                <tr key={payment.date}>
                  <td className="key">{shortDate(payment.date)}</td>
                  <td>{writePrice(payment.amount, currency, 4).replace(/0{1,2}$/, "")}{payment.special ? <span className="t-dim"> special</span> : null}</td>
                  <td data-dir={payment.change ? tone(payment.change) : undefined}>{payment.change == null || Math.abs(payment.change) < 0.0005 ? ABSENT : signed(payment.change)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="t-study-note">Ex-dates and amounts a share, split-adjusted, from Yahoo Finance; payout from the latest filings. A payment over 1.75 times the regular ones around it is counted as special and left out of the rate and the growth.</p>
    </div>
  );
}

function Figure({ label, value, note, tone: dir }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="stat-value" data-dir={dir} data-empty={value === ABSENT}>{value}</div>
      {note ? <p className="stat-note">{note}</p> : null}
    </div>
  );
}
