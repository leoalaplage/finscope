"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { getJson } from "@/lib/fetch-json";
import type { CompanyProfile } from "@/lib/types";

/** How long to wait after the last keystroke before asking the SEC. */
const RESOLVE_MS = 220;
const FILERS_SHOWN = 8;

type Hit = { company: CompanyProfile; followed: boolean };

/**
 * The front door: one field, and every filer behind it.
 *
 * The application used to open on somebody else's watchlist — twenty-two cards
 * of figures for companies the reader had not asked about, before they had
 * said what they came for. Opening on the question instead is both a shorter
 * path to any company and a truer statement of what this is: a way to look
 * something up in the filings, not a portfolio someone left open.
 *
 * The watchlist is still a destination, one word away, and its cards are still
 * how you browse. This page is how you arrive.
 */
export function SearchPage({ watchlist, onOpen, onAdd, onBrowse }: {
  watchlist: CompanyProfile[];
  onOpen: (ticker: string) => void;
  onAdd: (company: CompanyProfile) => void;
  onBrowse: () => void;
}) {
  const [query, setQuery] = useState("");
  /*
   * What came back, and the query it came back for.
   *
   * Keeping them together is what lets a stale answer be ignored while
   * rendering rather than cleared by an effect: one more keystroke and the
   * previous list stops matching, so it simply is not shown.
   */
  const [resolved, setResolved] = useState<{ needle: string; companies: CompanyProfile[]; error: string }>({ needle: "", companies: [], error: "" });
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  // The cursor belongs in the field on a page whose only purpose is the field.
  useEffect(() => { field.current?.focus(); }, []);

  const needle = query.trim().toUpperCase();
  const answered = resolved.needle === needle;
  const searchError = answered ? resolved.error : "";
  const searching = needle.length >= 2 && !answered;

  const followed = useMemo(() => {
    if (!needle) return [];
    return watchlist.filter((company) =>
      company.ticker.toUpperCase().includes(needle) || company.name.toUpperCase().includes(needle));
  }, [watchlist, needle]);

  useEffect(() => {
    if (needle.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      getJson<CompanyProfile[]>(`/api/resolve?q=${encodeURIComponent(needle)}`, { what: `companies matching “${needle}”` })
        .then((payload) => { if (live) setResolved({ needle, companies: Array.isArray(payload) ? payload : [], error: "" }); })
        .catch((cause) => { if (live) setResolved({ needle, companies: [], error: cause instanceof Error ? cause.message : "The search could not be completed." }); });
    }, RESOLVE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [needle]);

  const hits: Hit[] = useMemo(() => {
    const filers = answered ? resolved.companies : [];
    const held = new Set(followed.map((company) => company.ticker.toUpperCase()));
    return [
      ...followed.map((company) => ({ company, followed: true })),
      ...filers.filter((company) => !held.has(company.ticker.toUpperCase())).slice(0, FILERS_SHOWN).map((company) => ({ company, followed: false })),
    ];
  }, [followed, resolved, answered]);

  // A highlight that outlived the list under it would point at a different
  // company than the one the reader was looking at.
  const highlighted = Math.min(active, Math.max(0, hits.length - 1));

  function choose(hit: Hit) {
    setQuery(""); setResolved({ needle: "", companies: [], error: "" }); setActive(0);
    if (hit.followed) onOpen(hit.company.ticker); else onAdd(hit.company);
  }

  return <div className="search-page">
    <header className="search-lede">
      <div className="search-brandline"><span className="scope-mark hero" aria-hidden="true"><i/></span><span><b>FinScope</b><small>Research without the black box</small></span></div>
      <span className="search-eyebrow">Filings · Prices · Provenance</span>
      <h1>See the business.<br/>Verify the numbers.</h1>
      <p>
        Search any company that files with the SEC. FinScope turns the filing record into a readable operating
        history, then keeps every period, concept and accession one click away.
      </p>
    </header>

    <div className="search-field">
      <Search size={19} aria-hidden="true"/>
      <input
        ref={field}
        type="search"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Search any company that files with the SEC"
        value={query}
        placeholder="Company name or ticker"
        onChange={(event) => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setQuery(""); return; }
          if (!hits.length) return;
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((current) => (current + 1) % hits.length); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive((current) => (current - 1 + hits.length) % hits.length); }
          else if (event.key === "Enter") { event.preventDefault(); choose(hits[highlighted]); }
        }}
      />
      {searching && <span className="search-working" aria-hidden="true"/>}
    </div>

    <div className="search-proof" aria-label="FinScope data principles">
      <span><b>SEC sourced</b><small>Filed fundamentals</small></span>
      <span><b>No estimates</b><small>Unknown stays unknown</small></span>
      <span><b>Fully traceable</b><small>Source on every figure</small></span>
    </div>

    {searchError && <p className="notice search-notice">{searchError}</p>}

    {needle.length > 0 && !searchError && <ul className="search-results" id={listId} role="listbox" aria-label="Search results">
      {hits.length === 0
        ? <li className="search-empty">{needle.length < 2
            ? "Keep typing…"
            : searching ? "Searching the SEC register…" : `Nothing matches “${query.trim()}”. Try a ticker, or the name as it appears on the filing.`}</li>
        : hits.map((hit, index) => <li key={`${hit.followed ? "own" : "sec"}:${hit.company.ticker}`} role="option" aria-selected={index === highlighted}>
            <button type="button" className={index === highlighted ? "active" : ""} onMouseEnter={() => setActive(index)} onClick={() => choose(hit)}>
              <b>{hit.company.ticker}</b>
              <span>{hit.company.name}</span>
              <small>{hit.followed ? "Following" : "Add"}</small>
            </button>
          </li>)}
    </ul>}

    {/*
      * With nothing typed, the companies already followed — as tickers rather
      * than as cards. A wall of figures for companies the reader did not ask
      * about is what this page exists not to be; a row of names they chose is
      * a way in, and the watchlist proper is one word away.
      */}
    {!needle && watchlist.length > 0 && <section className="search-followed">
      <div className="search-followed-head">
        <span className="rule-label">Following</span>
        <button type="button" className="text-button" onClick={onBrowse}>Open the watchlist →</button>
      </div>
      <div className="search-tickers">
        {watchlist.filter((company) => company.resolutionStatus !== "unresolved").map((company) => (
          <button key={company.ticker} type="button" title={company.name} onClick={() => onOpen(company.ticker)}>{company.ticker}</button>
        ))}
      </div>
    </section>}
  </div>;
}
