"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { CompanyProfile } from "@/lib/types";

/**
 * How long to wait after the last keystroke before asking the SEC.
 *
 * The reader's own watchlist is filtered on every keystroke — it is an array in
 * memory. The registry of every filer in the United States is a request, and
 * firing one per character would be a request per character.
 */
const RESOLVE_MS = 250;
const WATCHLIST_SHOWN = 6;
const FILERS_SHOWN = 5;

type Hit = { company: CompanyProfile; followed: boolean };

/**
 * A way to reach any company, from anywhere in the application.
 *
 * Reaching one used to mean going back to the Watchlist and searching there, or
 * opening the import dialog — so the answer to "what does Costco's balance
 * sheet look like" started with leaving whatever you were reading. This sits in
 * the header on every page: it filters the companies you follow as you type,
 * and searches every SEC filer behind them.
 *
 * A company you do not follow is added to your watchlist when you open it,
 * which is the same thing the import dialog does and the only sensible reading
 * of choosing it.
 */
export function HeaderSearch({ watchlist, onOpen, onAdd }: {
  watchlist: CompanyProfile[];
  onOpen: (ticker: string) => void;
  onAdd: (company: CompanyProfile) => void;
}) {
  const [query, setQuery] = useState("");
  /*
   * The filers that came back, and the query they came back for.
   *
   * Keeping the query alongside them is what lets a stale answer be ignored
   * while rendering rather than cleared by an effect: the reader types one more
   * character and the previous list stops matching, so it simply is not shown.
   * Clearing it in an effect instead means a render showing the wrong list,
   * then a second render correcting it.
   */
  const [resolved, setResolved] = useState<{ needle: string; companies: CompanyProfile[] }>({ needle: "", companies: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const needle = query.trim().toUpperCase();

  const followed = useMemo(() => {
    if (!needle) return [];
    return watchlist
      .filter((company) => company.ticker.toUpperCase().includes(needle) || company.name.toUpperCase().includes(needle))
      .slice(0, WATCHLIST_SHOWN);
  }, [watchlist, needle]);

  // Every SEC filer, for anything the reader does not already follow. Asked for
  // after a pause, and abandoned if they keep typing.
  useEffect(() => {
    if (needle.length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      fetch(`/api/resolve?q=${encodeURIComponent(needle)}`)
        .then((response) => response.json())
        .then((payload) => { if (active) setResolved({ needle, companies: Array.isArray(payload) ? payload as CompanyProfile[] : [] }); })
        .catch(() => { if (active) setResolved({ needle, companies: [] }); });
    }, RESOLVE_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [needle]);

  const hits: Hit[] = useMemo(() => {
    // Only an answer to the question actually being asked: one more keystroke
    // and the list that came back no longer matches, so it is not shown.
    const filers = resolved.needle === needle ? resolved.companies : [];
    const held = new Set(followed.map((company) => company.ticker.toUpperCase()));
    return [
      ...followed.map((company) => ({ company, followed: true })),
      ...filers.filter((company) => !held.has(company.ticker.toUpperCase())).slice(0, FILERS_SHOWN).map((company) => ({ company, followed: false })),
    ];
  }, [followed, resolved, needle]);

  // A highlight that survives the list changing under it would point at a
  // different company than the one the reader was looking at.
  const highlighted = Math.min(active, Math.max(0, hits.length - 1));

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    addEventListener("mousedown", away);
    return () => removeEventListener("mousedown", away);
  }, [open]);

  function choose(hit: Hit) {
    setOpen(false); setQuery(""); setResolved({ needle: "", companies: [] }); setActive(0);
    if (hit.followed) onOpen(hit.company.ticker);
    else onAdd(hit.company);
  }

  return <div className="header-search" ref={box}>
    <Search size={15} aria-hidden="true"/>
    <input
      type="search"
      role="combobox"
      aria-expanded={open && hits.length > 0}
      aria-controls={listId}
      aria-autocomplete="list"
      value={query}
      placeholder="Search any company…"
      aria-label="Search your watchlist and every SEC filer"
      onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
      onFocus={() => setOpen(true)}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); (event.target as HTMLInputElement).blur(); return; }
        if (!hits.length) return;
        if (event.key === "ArrowDown") { event.preventDefault(); setActive((current) => (current + 1) % hits.length); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActive((current) => (current - 1 + hits.length) % hits.length); }
        else if (event.key === "Enter") { event.preventDefault(); choose(hits[highlighted]); }
      }}
    />
    {open && needle.length > 0 && <ul className="header-results" id={listId} role="listbox" aria-label="Search results">
      {hits.length === 0
        ? <li className="header-result-empty">{needle.length < 2 ? "Keep typing…" : `Nothing found for “${query.trim()}”.`}</li>
        : hits.map((hit, index) => <li key={`${hit.followed ? "own" : "sec"}:${hit.company.ticker}`} role="option" aria-selected={index === highlighted}>
            <button type="button" className={index === highlighted ? "active" : ""} onMouseEnter={() => setActive(index)} onClick={() => choose(hit)}>
              <b>{hit.company.ticker}</b>
              <span>{hit.company.name}</span>
              {/* Following it or not is the difference between opening a
                  company and adding one, so the row says which this is. */}
              <small>{hit.followed ? "In your watchlist" : "Add from SEC"}</small>
            </button>
          </li>)}
    </ul>}
  </div>;
}
