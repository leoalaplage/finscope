"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { DebtMaturities as Schedule } from "@/lib/debt-maturities";
import type { IoCompanyView } from "@/lib/io/view";
import type { ChartData, Preset } from "@/lib/term/fundamental-charts";
import { ComboChart } from "@/components/term/FundamentalCharts";
import { ABSENT, money, shortDate } from "./format";

/**
 * DDIS: when the company's borrowings fall due — the principal by year from
 * its latest 10-K (lib/debt-maturities.ts), against the cash it holds today.
 */
export function DebtMaturities({ view }: { view: IoCompanyView }) {
  const ticker = view.company.ticker;
  const cik = view.company.cik;
  const [answer, setAnswer] = useState<{ key: string; schedule: Schedule | null; failed: boolean } | null>(null);
  const key = `${ticker}:${cik}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/io/${encodeURIComponent(ticker)}/debt-maturities?cik=${encodeURIComponent(cik)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ maturities: Schedule | null }> : null))
      .then((body) => { if (!controller.signal.aborted) setAnswer({ key, schedule: body?.maturities ?? null, failed: body == null }); })
      .catch(() => { if (!controller.signal.aborted) setAnswer({ key, schedule: null, failed: true }); });
    return () => controller.abort();
  }, [key, ticker, cik]);

  const current = answer?.key === key ? answer : null;
  if (!current) return <p className="t-empty">Reading the latest 10-K…</p>;
  if (current.failed) return <p className="t-empty">The filing could not be read just now.</p>;
  const schedule = current.schedule;
  if (!schedule) return <p className="t-empty">The latest 10-K does not tag when the debt falls due, by year or note by note.</p>;

  const currency = view.company.currency;
  const latest = view.trailing.at(-1) ?? view.annual.at(-1);
  const cash = (latest?.values.cashAndEquivalents ?? 0) + Math.max(0, latest?.values.shortTermInvestments ?? 0);
  const first = schedule.buckets[0]?.value ?? 0;
  const fiveYears = schedule.buckets.slice(0, 5).reduce((sum, bucket) => sum + (bucket.value ?? 0), 0);
  const untagged = schedule.buckets.filter((bucket) => bucket.value == null).map((bucket) => bucket.label);
  const data: ChartData = {
    labels: schedule.buckets.map((bucket) => bucket.label),
    names: schedule.buckets.map((bucket, index) => (index === 5 ? `${bucket.label} · everything later` : `${bucket.label} · year ${index + 1} after ${shortDate(schedule.asOf)}`)),
    series: [
      { spec: { id: "due", label: "Principal due", kind: "bar", axis: "left", color: "var(--c4)", value: () => null }, values: schedule.buckets.map((bucket) => bucket.value) },
      ...(cash > 0 ? [{ spec: { id: "cash", label: "Cash and short-term investments today", kind: "line" as const, axis: "left" as const, color: "var(--gain)", value: () => null }, values: schedule.buckets.map(() => cash) }] : []),
    ],
  };
  const preset: Preset = { id: "ddis", title: "Debt maturities", left: "currency", series: data.series.map((entry) => entry.spec) };

  return (
    <div className="ddis">
      <div className="grid-ruled stats dvd-strip">
        <Stat label="Scheduled" value={money(schedule.total, currency)} note={untagged.length ? `Not tagged: ${untagged.join(", ")}` : `At ${shortDate(schedule.asOf)}, ${schedule.form} filed ${shortDate(schedule.filed)}`} />
        <Stat label="Due within a year" value={money(first, currency)} note={first > 0 && cash > 0 ? `Cash covers it ${(cash / first).toFixed(1)}×` : cash > 0 ? "Nothing due" : undefined} tone={first > 0 && cash < first ? "down" : undefined} />
        <Stat label="Due within five years" value={money(fiveYears, currency)} note={schedule.total > 0 ? `${Math.round((fiveYears / schedule.total) * 100)}% of the total` : undefined} />
        <Stat label="Later" value={schedule.buckets[5]?.value == null ? "Not tagged" : money(schedule.buckets[5].value, currency)} note={schedule.source === "notes" ? `Rebuilt from ${schedule.notes?.length ?? 0} notes` : "As the 10-K schedules it"} />
      </div>
      <div className={schedule.notes?.length ? "dvd-grid" : undefined}>
        <figure className="t-gf-card">
          <figcaption><h3>Principal due, by fiscal year</h3></figcaption>
          <ComboChart preset={preset} data={data} currency={currency} height={210} />
          <ul className="t-gf-legend">
            {data.series.map((entry) => <li key={entry.spec.id} data-kind={entry.spec.kind} style={{ "--key": entry.spec.color } as CSSProperties}><i aria-hidden="true" />{entry.spec.label}</li>)}
          </ul>
        </figure>
        {schedule.notes?.length ? (
          <div className="sheet dvd-sheet">
            <table>
              <thead><tr><th className="key">Note</th><th>Matures</th><th>Face</th></tr></thead>
              <tbody>
                {schedule.notes.map((note) => (
                  <tr key={`${note.name}-${note.maturity}`}><td className="key">{note.name}</td><td>{shortDate(note.maturity)}</td><td>{money(note.face, currency)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      <p className="t-study-note">
        {schedule.source === "schedule"
          ? "The principal due in each of the next five years and after, as the 10-K tags it."
          : "The 10-K tags no schedule: its notes, each with its face amount and its maturity (a date, the time left to run, or the year in the note's name), added up by year."}
        {" "}Cash today, for scale{schedule.url ? <> · <a href={schedule.url} target="_blank" rel="noreferrer">the filing ↗</a></> : null}.
      </p>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="stat-value" data-dir={tone} data-empty={value === ABSENT}>{value}</div>
      {note ? <p className="stat-note">{note}</p> : null}
    </div>
  );
}
