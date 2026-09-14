"use client";

import { FilingsList } from "./Filings";
import { NewsList } from "./MarketNews";

/**
 * The two things that happened today, as two sections rather than two tabs.
 *
 * They were tabs, with the filings first. The news is what a reader opening
 * this page looks for, so it is open by default and the filings — the only one
 * of the two this site can vouch for, and the one a reader has to know to want
 * — sit in a fold beneath it. Two sections, because a fold opens a section and
 * a tab inside a fold is a menu inside a menu.
 */

export function NewsSection() {
  return (
    <section className="section wire" aria-labelledby="news-title">
      <div className="section-head">
        <h2 className="label" id="news-title">Latest news</h2>
      </div>
      <NewsList/>
    </section>
  );
}

export function FilingsSection() {
  return (
    <section className="section filings" aria-labelledby="filings-title">
      <div className="section-head">
        <h2 className="label" id="filings-title">Filed today</h2>
      </div>
      <FilingsList/>
    </section>
  );
}
