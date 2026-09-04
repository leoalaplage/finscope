"use client";

import { useEffect, useId, useRef, useState } from "react";
import { chooseSymbol } from "./choose-symbol";

/**
 * The only control on the site.
 *
 * It searches the SEC's own company registry rather than a list we maintain, so
 * every filer that publishes XBRL is reachable — about twelve thousand of them
 * — and a company nobody has ever opened here behaves exactly like one that
 * has. A ticker typed in full wins when the form is submitted, because someone
 * who typed four letters and pressed return meant those four letters; a company
 * name falls through to what the registry answered. See chooseSymbol.
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

export function Search({
  size = "bar",
  focusOnMount = false,
  onPick,
}: {
  size?: "bar" | "hero";
  focusOnMount?: boolean;
  /**
   * Hands the symbol back instead of opening it.
   *
   * The comparison page adds a company to a list rather than navigating to one,
   * and it is the same search doing the same work — resolving what a reader
   * typed into a symbol the SEC lists. Only the last step differs.
   */
  onPick?: (ticker: string) => void;
}) {
  const listId = useId();
  const field = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<Answer>({ query: "", matches: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const needle = query.trim();
  const matches = answer.query === needle ? answer.matches : [];
  const highlighted = matches[active];
  // The reader's arrow keys override the resolver: a name they have moved to is
  // the company they mean, whatever the typed text would otherwise resolve to.
  const chosen = (active > 0 && highlighted ? highlighted.ticker.toUpperCase() : null) ?? chooseSymbol(needle, matches);
  const working = needle.length > 0 && answer.query !== needle;
  const showing = open && needle.length > 0;
  const destination = chosen ? `/s/${encodeURIComponent(chosen)}` : undefined;

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

  const take = (ticker: string) => {
    setOpen(false);
    if (onPick) { onPick(ticker); setQuery(""); return; }
    // Native navigation, like every link here: it works with or without
    // hydration and the destination page is deliberately tiny.
    window.location.assign(`/s/${encodeURIComponent(ticker)}`);
  };

  return (
    <form
      className="search"
      role="search"
      action={onPick ? undefined : destination}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onSubmit={(event) => {
        if (!onPick) { if (!destination) event.preventDefault(); return; }
        event.preventDefault();
        if (!chosen) return;
        onPick(chosen);
        setQuery("");
      }}
    >
      <div className="search-field">
        <input
          ref={field}
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setOpen(false); field.current?.blur(); return; }
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, matches.length - 1)); return; }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); return; }
            if (event.key === "Enter" && chosen) {
              event.preventDefault();
              submitButton.current?.click();
            }
          }}
          role="combobox"
          aria-expanded={showing}
          aria-controls={showing ? listId : undefined}
          aria-autocomplete="list"
          placeholder={size === "hero" ? "Ticker or company" : "Search"}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          enterKeyHint="go"
          aria-label="Search any US-listed company"
        />
        {size === "bar" ? <kbd className="search-key">⌘K</kbd> : null}
        <button ref={submitButton} type="submit" className="search-submit" aria-label={onPick ? "Add company" : "Open company"} disabled={!chosen}>{onPick ? "+" : "↵"}</button>
      </div>

      {/*
        * What the letters resolve to, while they are being typed.
        *
        * The panel was removed once because it covered the watchlist on the
        * landing page. Covering it is what a menu does — and without the panel
        * a reader typing a company's name had no way of knowing which company
        * they were about to open, which is how "apple" came to open a page
        * called APPLE.
        */}
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
              onClick={() => take(match.ticker.toUpperCase())}
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
    </form>
  );
}
