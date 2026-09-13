"use client";

import { useState } from "react";
import { FilingsList } from "./Filings";
import { NewsList } from "./MarketNews";

/**
 * What happened, from the two places it can be read.
 *
 * The filings are first and are the default, because they are the only ones
 * this site can vouch for: EDGAR's index of what was accepted today, where the
 * form name is the news and both ends of every line are documents.
 *
 * The wire is the second tab rather than a second section. It is somebody
 * else's newsroom and it is general — counted on an ordinary day, of eighteen
 * headlines ten were political, six were about wars, one was a Formula One
 * result and one was about a company — so it is available to a reader who
 * wants it and not put in front of one who does not. Nothing from it is
 * followed: no link, no byline, no summary, only the line itself.
 *
 * Two tabs rather than two sections, because they answer the same question and
 * a reader wants one of the answers, not both stacked.
 */

type Tab = "filings" | "news";

export function Wire() {
  const [tab, setTab] = useState<Tab>("filings");

  return (
    <section className="section wire" aria-labelledby="wire-title">
      <div className="section-head">
        <h2 className="label" id="wire-title">What happened</h2>
        <div className="seg" role="group" aria-label="Which wire to read">
          <button type="button" aria-pressed={tab === "filings"} onClick={() => setTab("filings")}>Filed today</button>
          <button type="button" aria-pressed={tab === "news"} onClick={() => setTab("news")}>News</button>
        </div>
      </div>
      {tab === "filings" ? <FilingsList/> : <NewsList/>}
    </section>
  );
}
