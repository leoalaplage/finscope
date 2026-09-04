"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The only control on the site.
 *
 * It searches the SEC's own company registry rather than a list we maintain, so
 * every filer that publishes XBRL is reachable — about twelve thousand of them
 * — and a company nobody has ever opened here behaves exactly like one that
 * has. A ticker typed in full wins when the form is submitted, because someone
 * who typed four letters and pressed return meant those four letters.
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
  const field = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<Answer>({ query: "", matches: [] });

  const needle = query.trim();
  const matches = answer.query === needle ? answer.matches : [];
  const typed = needle.toUpperCase();
  const chosen = matches.find((match) => match.ticker.toUpperCase() === typed)
    ?? (SYMBOL.test(typed) ? { ticker: typed } : matches[0]);
  const destination = chosen ? `/s/${encodeURIComponent(chosen.ticker.toUpperCase())}` : undefined;

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
      } catch {
        if (!controller.signal.aborted) setAnswer({ query: needle, matches: [] });
      }
    }, 140);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [needle]);

  return (
    <form
      className="search"
      role="search"
      action={destination}
      onSubmit={(event) => { if (!destination) event.preventDefault(); }}
    >
      <div className="search-field">
        <input
          ref={field}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") field.current?.blur();
            if (event.key === "Enter" && destination) {
              event.preventDefault();
              submitButton.current?.click();
            }
          }}
          placeholder={size === "hero" ? "Ticker or company" : "Search"}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          enterKeyHint="go"
          aria-label="Search any US-listed company"
        />
        {size === "bar" ? <kbd className="search-key">⌘K</kbd> : null}
        <button ref={submitButton} type="submit" className="search-submit" aria-label="Open company" disabled={!destination}>↵</button>
      </div>
    </form>
  );
}
