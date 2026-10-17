"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@/lib/segments/customers";
import type { Supplier } from "@/lib/segments/relations";
import { ABSENT } from "@/components/io/format";

/**
 * SPLC: whom the company sells to, as its 10-Ks name them, and which companies
 * of the index name it as a customer in theirs (app/api/relations).
 *
 * Only what the filings state. A customer is disclosed when it brings in a
 * tenth or more of revenue, so a company with many small customers lists none,
 * and a supplier appears here only if it names this company in its own
 * reports: Apple's suppliers that do not single Apple out are not listed.
 */

interface Answer {
  ticker: string;
  customers: Customer[];
  pending: boolean;
  builtAt: string | null;
  suppliers: Array<Supplier & { name: string | null }>;
  companies: number;
  universe: number;
}

const percent = (value: number | null | undefined) => (value == null ? ABSENT : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`);
const year = (end: string | null | undefined) => (end ? `FY ${end.slice(0, 4)}` : ABSENT);
const KIND: Record<Customer["kind"], string> = { named: "", unnamed: "Not named in the filing", group: "Several customers together", class: "" };

/** The share stated year by year, oldest first: "18% → 22% → 25%". */
function history(customer: Customer): string {
  return customer.annual.filter((point) => point.share != null).map((point) => `${point.end.slice(0, 4)}: ${percent(point.share)}${point.derived ? " (worked out)" : ""}`).join(" · ");
}

export function SupplyChain({ ticker }: { ticker: string }) {
  const [answer, setAnswer] = useState<Answer | null | "failed">(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/relations/${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then(async (response) => (response.ok ? await response.json() as Answer : "failed" as const))
      .then((body) => { if (!controller.signal.aborted) setAnswer(body); })
      .catch(() => { if (!controller.signal.aborted) setAnswer("failed"); });
    return () => controller.abort();
  }, [ticker]);

  if (answer === null) return <p className="t-empty">Reading the customers named in the company&apos;s filings…</p>;
  if (answer === "failed") return <p className="t-empty">Customers and suppliers are unavailable just now.</p>;
  const latest = (customer: Customer) => [...customer.annual].reverse().find((point) => point.share != null) ?? null;

  return (
    <div className="t-splc">
      <section className="t-splc-side">
        <h3 className="t-splc-title">Customers <span className="t-dim">named in {answer.ticker}&apos;s reports</span></h3>
        {answer.customers.length ? (
          <div className="sheet">
            <table>
              <thead>
                <tr><th className="key">Customer</th><th title="The customer's share of the company's revenue, latest fiscal year stated">Share of revenue</th><th>Year</th><th title="The customer's share of the company's receivables at the latest balance-sheet date stated">Share of receivables</th></tr>
              </thead>
              <tbody>
                {answer.customers.map((customer) => {
                  const point = latest(customer);
                  const balance = customer.receivables.at(-1);
                  return (
                    <tr key={customer.member} data-kind={customer.kind}>
                      <td className="key" title={KIND[customer.kind] || undefined}>
                        {customer.ticker ? <a href={`/t/s/${encodeURIComponent(customer.ticker)}#splc`}>{customer.ticker}</a> : null}{customer.ticker ? " " : ""}
                        <span className={customer.kind === "named" ? undefined : "t-dim"}>{customer.label}</span>
                      </td>
                      <td title={history(customer) || undefined}>{point ? `${point.derived ? "≈ " : ""}${percent(point.share)}` : ABSENT}</td>
                      <td className="t-dim">{year(point?.end ?? customer.annual.at(-1)?.end)}</td>
                      <td>{balance ? <span title={`At ${balance.end}`}>{percent(balance.share)}</span> : ABSENT}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="t-empty">{answer.pending ? "This company's filings are being read for customers; they appear here within minutes." : "No customer is disclosed as a tenth or more of revenue or receivables in the reports read."}</p>
        )}
      </section>
      <section className="t-splc-side">
        <h3 className="t-splc-title">Suppliers <span className="t-dim">in the {answer.universe} that name {answer.ticker} as a customer</span></h3>
        {answer.suppliers.length ? (
          <div className="sheet">
            <table>
              <thead>
                <tr><th className="key">Supplier</th><th title={`${answer.ticker}'s share of the supplier's revenue, latest fiscal year stated`}>{answer.ticker}&apos;s share of its revenue</th><th>Year</th><th title={`${answer.ticker}'s share of the supplier's receivables`}>Share of receivables</th></tr>
              </thead>
              <tbody>
                {answer.suppliers.map((supplier) => (
                  <tr key={supplier.ticker}>
                    <td className="key"><a href={`/t/s/${encodeURIComponent(supplier.ticker)}#splc`}>{supplier.ticker}</a> <span className="t-dim">{supplier.name ?? ""}</span></td>
                    <td>{percent(supplier.share)}</td>
                    <td className="t-dim">{year(supplier.end ?? supplier.receivablesEnd)}</td>
                    <td>{percent(supplier.receivables)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="t-empty">No company read so far names {answer.ticker} as a customer.</p>}
      </section>
      <p className="t-splc-note t-dim">
        From the companies&apos; 10-K and 10-Q filings: a customer is disclosed when it accounts for 10% or more of revenue (ASC 280), tagged in the filing&apos;s XBRL.
        Only names that are exactly a member of the S&amp;P 500 are linked. Suppliers are the members whose own reports name this company; {answer.companies} of {answer.universe} have been read so far.
      </p>
    </div>
  );
}
