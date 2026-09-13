"use client";

import { useEffect, useState } from "react";
import type { FilingItem, FilingsAnswer } from "@/app/api/filings/route";
import { edgarUrl } from "./format";

/**
 * What the companies on this site told the market, as they told it.
 *
 * This replaced a general news wire, and the reason was a count rather than a
 * feeling: of its eighteen headlines, ten were political, six were about wars,
 * one was a Formula One result, and one was about a company. A market page
 * cannot open on a Grand Prix.
 *
 * The replacement is the same material every figure on this site comes from.
 * A filing needs no summarising and no byline: the form name is the news —
 * an 8-K is something the company had to tell you today, a 10-Q is a quarter,
 * a SC 13D is somebody buying enough of it to matter — and both ends of every
 * line are links, one to the company here and one to the document at the SEC.
 *
 * Nothing is filtered by importance, because importance is a judgement and the
 * form is a fact. What is filtered is form type: on one ordinary Friday the
 * index filed 454 documents, of which 264 were prospectus supplements and 81
 * were insider transactions.
 */

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "ready"; answer: FilingsAnswer };

/** What a form is, for a reader who does not have the codes by heart. */
const MEANING: Record<string, string> = {
  "10-K": "annual report",
  "10-Q": "quarterly report",
  "8-K": "material event",
  "20-F": "annual report, foreign filer",
  "40-F": "annual report, Canadian filer",
  "6-K": "interim report, foreign filer",
  "DEF 14A": "proxy statement",
  "DEFA14A": "proxy material",
  "SC 13D": "an active stake",
  "SC 13G": "a passive stake",
  "S-1": "registration of new shares",
  "S-3": "shelf registration",
  "S-4": "registration for a merger",
  "11-K": "employee share plan",
  "25-NSE": "a delisting",
};

const meaning = (form: string) => {
  const amended = form.endsWith("/A");
  const base = amended ? form.slice(0, -2) : form;
  const said = MEANING[base.toUpperCase()];
  return said ? (amended ? `${said}, amended` : said) : null;
};

/** "Fri 11 Sep", which is how a day of filings is spoken about. */
function dayLabel(iso: string) {
  const parsed = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? iso
    : parsed.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function Filings() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/filings", { signal: controller.signal });
        if (!response.ok) { setState({ kind: "absent" }); return; }
        const answer = await response.json() as FilingsAnswer;
        if (!controller.signal.aborted) setState(answer.items?.length ? { kind: "ready", answer } : { kind: "absent" });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "absent" });
      }
    })();
    return () => controller.abort();
  }, []);

  if (state.kind === "absent") return null;

  return (
    <section className="section filings" aria-labelledby="filings-title">
      <div className="section-head">
        <h2 className="label" id="filings-title">Filed today</h2>
        <span className="label">
          {state.kind === "ready" ? `${state.answer.items.length} from the index · ${dayLabel(state.answer.date)}` : "Reading EDGAR"}
        </span>
      </div>

      {state.kind === "loading" ? (
        <div className="filings-list">
          {[0, 1, 2, 3].map((row) => <div className="news-item skeleton" key={row} style={{ height: 34 }}/>)}
        </div>
      ) : (
        <div className="filings-list">
          {state.answer.items.map((item) => <Row key={`${item.accession}${item.form}`} item={item}/>)}
        </div>
      )}
    </section>
  );
}

function Row({ item }: { item: FilingItem }) {
  const document = edgarUrl(item.cik, item.accession);
  const said = meaning(item.form);
  return (
    <article className="filings-item">
      <a className="filings-ticker" href={`/s/${encodeURIComponent(item.ticker)}`}>{item.ticker}</a>
      <span className="filings-form">{item.form}</span>
      <span className="label filings-said">{said ?? item.name}</span>
      {/* The document itself, because everything here is read out of one. */}
      {document ? <a className="label filings-source" href={document} target="_blank" rel="noreferrer">SEC</a> : <span className="label"/>}
    </article>
  );
}
