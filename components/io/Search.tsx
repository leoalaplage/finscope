"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * The only control on the site.
 *
 * It searches the SEC's own company registry rather than a list we maintain, so
 * every filer that publishes XBRL is reachable — about twelve thousand of them
 * — and a company nobody has ever opened here behaves exactly like one that
 * has. A ticker typed in full is offered first, because someone who typed four
 * letters and a return meant those four letters.
 */

interface Match { ticker: string; name: string; cik: string }

/**
 * What came back, and what it was an answer to.
 *
 * Holding the query alongside the results is what makes "searching" a derived
 * fact rather than a second piece of state to keep in step: results whose query
 * is not the one in the field are simply not this question's results.
 */
interface Answer { query: string; matches: Match[] }

const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

export function Search({ size = "bar", focusOnMount = false }: { size?: "bar" | "hero"; focusOnMount?: boolean }) {
  const listId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<Answer>({ query: "", matches: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const needle = query.trim();
  const matches = answer.query === needle ? answer.matches : [];
  const working = needle.length > 0 && answer.query !== needle;

  // The keyboard shortcut every application of this kind has, because a reader
  // who wants another company wants it without reaching for the pointer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The landing page opens on an empty field, and a reader who arrived there
  // came to type. Done imperatively rather than with `autoFocus` so it happens
  // once, after paint, and cannot fight a restored scroll position.
  useEffect(() => {
    if (focusOnMount) field.current?.focus();
  }, [focusOnMount]);

  useEffect(() => {
    if (needle.length < 1) return;
    // Debounced, and every earlier request is abandoned rather than allowed to
    // land out of order over a newer one.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/resolve?q=${encodeURIComponent(needle)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const found = await response.json() as Match[];
        setAnswer({ query: needle, matches: found.slice(0, 8) });
        setActive(0);
      } catch {
        if (!controller.signal.aborted) setAnswer({ query: needle, matches: [] });
      }
    }, 140);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [needle]);

  const go = (ticker: string) => {
    setOpen(false);
    setQuery("");
    field.current?.blur();
    // Native navigation is intentional. The current vinext Link/RSC prefetch
    // bridge can fail before it installs its click handler in production,
    // leaving a perfectly valid company link looking inert. A document
    // navigation works with or without hydration and the destination page is
    // deliberately tiny; its own loading state takes over immediately.
    window.location.assign(`/s/${encodeURIComponent(ticker.toUpperCase())}`);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { setOpen(false); field.current?.blur(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, matches.length - 1)); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); return; }
    if (event.key !== "Enter") return;
    event.preventDefault();
    // A typed symbol beats a highlighted suggestion: the reader who typed
    // "MSFT" and pressed return has already chosen.
    const typed = needle.toUpperCase();
    const chosen = matches.find((match) => match.ticker.toUpperCase() === typed) ?? matches[active];
    if (chosen) go(chosen.ticker);
    else if (SYMBOL.test(typed)) go(typed);
  };

  // On the landing page the large result panel obscures the list the reader
  // came to choose from. The search still resolves company names in the
  // background and Enter opens the exact ticker or best match; the compact
  // header search keeps suggestions because no company grid sits below it.
  const showing = size === "bar" && open && needle.length > 0;

  return (
    <div className="search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <div className="search-field">
        <input
          ref={field}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={size === "hero" ? "Ticker or company" : "Search"}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          aria-label="Search any US-listed company"
          aria-expanded={showing}
          aria-controls={showing ? listId : undefined}
          aria-autocomplete={size === "bar" ? "list" : "none"}
          role="combobox"
        />
        {size === "bar" ? <kbd className="search-key">⌘K</kbd> : null}
      </div>

      {showing ? (
        <div className="results" id={listId} role="listbox">
          {matches.map((match, index) => (
            <button
              key={`${match.cik}-${match.ticker}`}
              type="button"
              className="result"
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(match.ticker)}
            >
              <span className="sym">{match.ticker}</span>
              <span className="nm">{match.name}</span>
            </button>
          ))}
          {!matches.length ? (
            <p className="results-note">{working ? "Searching…" : "No filer matches that."}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
