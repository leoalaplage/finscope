"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { EventCategory, FilingEvent } from "@/lib/adapters/filing-events";
import { shortDate } from "./format";

const CATEGORIES: Array<{ id: EventCategory | "all" | "flag"; label: string }> = [
  { id: "all", label: "All" },
  { id: "flag", label: "Flags" },
  { id: "results", label: "Results" },
  { id: "leadership", label: "Leadership" },
  { id: "deals", label: "Deals" },
  { id: "financing", label: "Financing" },
  { id: "governance", label: "Governance" },
  { id: "other", label: "Other" },
];
const SHOWN = 20;

/**
 * EVT: what the company has announced over two years, from its SEC index
 * (lib/adapters/filing-events.ts) — each 8-K by the items it was filed under,
 * with the reports, proxies, registrations and activist stakes around them.
 * A row opens to the first sentences of each item, read from the filing.
 */
export function CompanyEvents({ ticker, cik }: { ticker: string; cik: string }) {
  const [answer, setAnswer] = useState<{ key: string; events: FilingEvent[] | null } | null>(null);
  const [filter, setFilter] = useState<EventCategory | "all" | "flag">("all");
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const key = `${ticker}:${cik}`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/io/${encodeURIComponent(ticker)}/events?cik=${encodeURIComponent(cik)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ events: FilingEvent[] }> : null))
      .then((body) => { if (!controller.signal.aborted) setAnswer({ key, events: body?.events ?? null }); })
      .catch(() => { if (!controller.signal.aborted) setAnswer({ key, events: null }); });
    return () => controller.abort();
  }, [key, ticker, cik]);

  const events = answer?.key === key ? answer.events : undefined;
  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const event of events ?? []) {
      tally.set(event.category, (tally.get(event.category) ?? 0) + 1);
      if (event.flag) tally.set("flag", (tally.get("flag") ?? 0) + 1);
    }
    tally.set("all", events?.length ?? 0);
    return tally;
  }, [events]);

  if (events === undefined) return <p className="t-empty">Reading the SEC index…</p>;
  if (events === null) return <p className="t-empty">The SEC index could not be read just now. Try again in a minute.</p>;
  if (!events.length) return <p className="t-empty">Nothing filed in the last two years.</p>;

  const chosen = events.filter((event) => filter === "all" || (filter === "flag" ? event.flag : event.category === filter));
  const rows = all ? chosen : chosen.slice(0, SHOWN);
  return (
    <div className="events">
      <div className="events-bar">
        <div className="seg" role="group" aria-label="Kind of event">
          {CATEGORIES.filter((category) => category.id === "all" || counts.get(category.id)).map((category) => (
            <button key={category.id} type="button" aria-pressed={filter === category.id} onClick={() => { setFilter(category.id); setAll(false); }}>
              {category.label} <span>{counts.get(category.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="sheet events-sheet">
        <table>
          <thead><tr><th className="key">Filed</th><th>Event</th><th>Kind</th><th>Form</th><th aria-label="Filing" /></tr></thead>
          <tbody>
            {rows.map((event) => {
              const readable = (event.form === "8-K" || event.form === "8-K/A") && event.document != null && event.items.some((item) => /^\d\.\d\d$/.test(item.code));
              const isOpen = open === event.accession;
              return (
                <Fragment key={event.accession}>
                  <tr data-flag={event.flag || undefined} data-open={isOpen || undefined}>
                    <td className="key">{shortDate(event.date)}</td>
                    <td className="events-what">
                      {readable ? (
                        <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : event.accession)}>
                          {event.flag ? <b aria-label="Flag">!</b> : null}{event.items.map((item) => item.label).join(" · ")}
                        </button>
                      ) : <span>{event.flag ? <b aria-label="Flag">!</b> : null}{event.items.map((item) => item.label).join(" · ")}</span>}
                    </td>
                    <td><span className="events-kind" data-kind={event.category}>{CATEGORIES.find((category) => category.id === event.category)?.label}</span></td>
                    <td className="t-dim">{event.form}</td>
                    <td><a href={event.url} target="_blank" rel="noreferrer" aria-label={`Open the ${event.form} of ${shortDate(event.date)} at the SEC`}>SEC ↗</a></td>
                  </tr>
                  {isOpen ? (
                    <tr className="events-excerpt"><td colSpan={5}><Excerpt ticker={ticker} cik={cik} event={event} /></td></tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {chosen.length > SHOWN ? (
        <button type="button" className="t-chip events-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${chosen.length}`}</button>
      ) : null}
    </div>
  );
}

/** The first sentences under each item of one 8-K. */
function Excerpt({ ticker, cik, event }: { ticker: string; cik: string; event: FilingEvent }) {
  const [text, setText] = useState<Array<{ code: string; text: string }> | null | undefined>(undefined);
  const codes = event.items.map((item) => item.code).filter((code) => /^\d\.\d\d$/.test(code));
  const document = event.document?.split("/").pop() ?? "";
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ cik, accession: event.accession, document, items: codes.join(",") });
    fetch(`/api/io/${encodeURIComponent(ticker)}/events/excerpt?${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ excerpts: Array<{ code: string; text: string }> }> : null))
      .then((body) => { if (!controller.signal.aborted) setText(body?.excerpts ?? null); })
      .catch(() => { if (!controller.signal.aborted) setText(null); });
    return () => controller.abort();
    // The codes are the event's own; the accession names them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, cik, event.accession, document]);
  if (text === undefined) return <p className="t-dim">Reading the filing…</p>;
  if (!text?.length) return <p className="t-dim">The filing&apos;s items could not be read here. <a href={event.url} target="_blank" rel="noreferrer">Open it at the SEC ↗</a></p>;
  return (
    <div className="events-text">
      {text.map((entry) => (
        <p key={entry.code}><span>{event.items.find((item) => item.code === entry.code)?.label ?? `Item ${entry.code}`}</span>{entry.text}</p>
      ))}
    </div>
  );
}
