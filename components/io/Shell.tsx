"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Native navigation is
   required here while vinext's production RSC link bridge fails to hydrate. */

import { useCallback, useSyncExternalStore } from "react";
import { Search } from "./Search";

/**
 * The bar, which holds a wordmark, the search and one switch.
 *
 * There is no navigation because there is nowhere else to go: this site is one
 * search and one company page. A menu here would be a menu of one item
 * pretending to be a product.
 */

type Theme = "light" | "dark";

const STORAGE_KEY = "finscope.theme";
const THEME_EVENT = "finscope:theme";

/**
 * The document's own attribute is the state, and React subscribes to it.
 *
 * The theme is stamped on `<html>` by an inline script before React exists, so
 * a copy of it held in component state would start out wrong and be corrected
 * by an effect — a cascading render on every page, and a flash of the other
 * theme on the first. Reading it as an external store instead means the first
 * render is already right, and the server's snapshot is the same default the
 * markup carries.
 */
function subscribe(notify: () => void) {
  window.addEventListener(THEME_EVENT, notify);
  return () => window.removeEventListener(THEME_EVENT, notify);
}

const readTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);

  const flip = useCallback(() => {
    const next: Theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* A browser refusing storage still gets the change. */ }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  /*
   * The symbol is what the switch gives you, not what you are on.
   *
   * A sun on a dark page means "make it day", which is the only reading that
   * survives without a word beside it — and the word is what had to go, because
   * the bar now carries destinations and the switch is not one of them. The
   * label stays for anyone who cannot see the glyph.
   */
  return (
    <button
      type="button"
      className="theme-switch"
      onClick={flip}
      aria-label={theme === "light" ? "Switch to the dark setting" : "Switch to the light setting"}
      title={theme === "light" ? "Dark" : "Light"}
    >
      <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
    </button>
  );
}

export function Shell({ children, search = true }: { children: React.ReactNode; search?: boolean }) {
  return (
    <div className="io">
      <header className="bar">
        <div className="wrap bar-inner">
          <a href="/" className="mark">FinScope<span className="dim">.io</span></a>
          {search ? <Search /> : <span className="bar-spacer" />}
          {/*
            * Plain anchors, like the wordmark beside them and the company links
            * everywhere else on this site: a document navigation works with or
            * without hydration, and every destination here is prerendered.
            *
            * They sit after the search, which is the element that grows, so the
            * destinations and the switch are carried to the right edge together
            * without either being positioned by hand.
            */}
          <nav className="bar-nav">
            <a href="/market">Market</a>
            <a href="/company">Company</a>
            <a href="/compare">Compare</a>
            <a href="/screener">Screener</a>
            <a href="/portfolio">Portfolio</a>
          </nav>
          <ThemeSwitch />
        </div>
      </header>
      {children}
    </div>
  );
}
