"use client";

import { useEffect, useId, useRef, useState } from "react";
import { chooseSymbol } from "@/components/io/choose-symbol";
import { hrefFor, parseCommand, suggestFunctions, type Command } from "@/lib/term/command";

/**
 * The line every terminal screen is driven from.
 *
 * It does two jobs the document site's search did one of. A security and a
 * function — `AAPL GP` — go straight where they say. Anything else is a name,
 * looked up in the SEC registry the way the site's search always has been, and
 * the answers are offered under the line alongside the functions that match
 * what has been typed. The grammar itself is lib/term/command.ts.
 *
 * Typing anywhere on the screen types here. A terminal has one input that
 * matters, and a reader who has to find it before they can use it is reading a
 * web page, not a terminal.
 */

interface Match { ticker: string; name: string }
interface Suggestion { key: string; code: string; name: string; kind: string; command: string }

export function CommandLine({ current, onHelp }: { current: string | null; onHelp: () => void }) {
  const listId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [answer, setAnswer] = useState<{ query: string; matches: Match[] }>({ query: "", matches: [] });
  const [error, setError] = useState<{ text: string; message: string } | null>(null);

  const parsed = parseCommand(text, current);
  // A name is looked up; so is a lone word that might be the start of one.
  const lookup = parsed.kind === "search" ? parsed.query
    : parsed.kind === "company" && parsed.fn === "DES" && !/\s/.test(text.trim()) ? text.trim()
      : "";
  const matches = answer.query === lookup ? answer.matches : [];

  const suggestions: Suggestion[] = [
    ...suggestFunctions(text, current).map((spec) => ({ key: `fn-${spec.command}`, code: spec.code, name: spec.name, kind: "FUNCTION", command: spec.command })),
    ...matches.map((match) => ({ key: `eq-${match.ticker}`, code: match.ticker, name: match.name, kind: "EQUITY", command: match.ticker })),
  ].slice(0, 12);
  const showing = open && text.trim().length > 0 && suggestions.length > 0;
  const message = error?.text === text ? error.message : null;

  useEffect(() => {
    if (!lookup) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/resolve?q=${encodeURIComponent(lookup)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const found = await response.json() as Match[];
        setAnswer({ query: lookup, matches: found.slice(0, 8) });
      } catch {
        if (!controller.signal.aborted) setAnswer({ query: lookup, matches: [] });
      }
    }, 120);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [lookup]);

  /*
   * Any letter typed while nothing else has the keyboard lands here, and so do
   * the shortcuts readers bring from elsewhere: "/" and ⌘K. A key pressed in
   * another field, or with a modifier held, is that field's or the browser's.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editing = target?.closest("input, textarea, select, [contenteditable='true'], dialog") != null;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
        return;
      }
      if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        field.current?.focus();
        return;
      }
      if (event.key.length === 1 && /[a-z0-9?]/i.test(event.key)) field.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (command: Command, typed: string) => {
    if (command.kind === "empty") return;
    if (command.kind === "global" && command.fn === "HELP") {
      setText("");
      setOpen(false);
      onHelp();
      return;
    }
    if (command.kind === "needs-ticker") {
      setError({ text: typed, message: `Name a security: AAPL ${command.fn}` });
      return;
    }
    if (command.kind === "search") {
      const ticker = chooseSymbol(command.query, matches);
      if (!ticker || !matches.length) {
        setError({ text: typed, message: answer.query === lookup ? "No security found" : "Searching…" });
        return;
      }
      go(`/t/s/${encodeURIComponent(ticker)}`);
      return;
    }
    /*
     * One word is a ticker or the name of a company, and the registry knows
     * which. "APPLE" is shaped exactly like a ticker, so it is resolved the way
     * the site's search resolves it (components/io/choose-symbol.ts) rather
     * than opened as a security nobody lists.
     */
    if (command.kind === "company" && command.fn === "DES" && answer.query === lookup && matches.length) {
      const ticker = chooseSymbol(command.ticker, matches) ?? command.ticker;
      go(`/t/s/${encodeURIComponent(ticker)}`);
      return;
    }
    const href = hrefFor(command);
    if (href) go(href);
  };

  const go = (href: string) => {
    setOpen(false);
    setText("");
    field.current?.blur();
    // Native navigation, like every link on this site; on the same screen only
    // the hash moves and the shell brings that panel into view.
    window.location.assign(href);
  };

  const execute = () => {
    const chosen = showing && active >= 0 ? suggestions[active] : null;
    const typed = chosen ? chosen.command : text;
    run(parseCommand(typed, current), text);
  };

  return (
    <div className="t-cmd">
      <form
        role="search"
        onSubmit={(event) => { event.preventDefault(); execute(); }}
        onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setOpen(false); }}
      >
        <span className="t-cmd-prompt" aria-hidden="true">&gt;</span>
        <input
          ref={field}
          value={text}
          onChange={(event) => { setText(event.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (showing) setOpen(false);
              else { setText(""); field.current?.blur(); }
              return;
            }
            if (event.key === "ArrowDown" && suggestions.length) {
              event.preventDefault();
              setOpen(true);
              setActive((index) => (index + 1) % suggestions.length);
            } else if (event.key === "ArrowUp" && suggestions.length) {
              event.preventDefault();
              setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
            } else if (event.key === "Tab" && showing && suggestions[Math.max(active, 0)]) {
              // Tab completes, the way it does in every shell.
              event.preventDefault();
              setText(`${suggestions[Math.max(active, 0)].command} `);
              setActive(-1);
            }
          }}
          placeholder={current ? `${current} FA · GP NVDA · company name · HELP` : "AAPL GP · company name · HELP"}
          aria-label="Command"
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        {message ? <span className="t-cmd-error" role="status">{message}</span> : null}
        <button type="submit" className="t-cmd-go" aria-label="Run command"><kbd>&lt;GO&gt;</kbd></button>
      </form>
      {showing ? (
        <div className="t-cmd-list" id={listId} role="listbox">
          {suggestions.map((suggestion, index) => (
            <button
              type="button"
              tabIndex={-1}
              key={suggestion.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => run(parseCommand(suggestion.command, current), text)}
              onPointerEnter={() => setActive(index)}
            >
              <span className="t-sug-code">{suggestion.code}</span>
              <span className="t-sug-name">{suggestion.name}</span>
              <span className="t-sug-kind">{suggestion.kind}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
