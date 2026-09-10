"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Native navigation is
   required here while vinext's production RSC link bridge fails to hydrate. */

import { Settings as SettingsIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { onCompany, useRememberedCompany } from "./remembered";
import { Search } from "./Search";
import { readTheme, setTheme, subscribeTheme, type Theme } from "./theme";

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
function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as Theme);

  const flip = useCallback(() => {
    const next: Theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    setTheme(next);
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
  /*
   * Two of these destinations are about a company, and the reader is usually
   * already reading one. Carrying it means Compare opens holding that filer
   * with a field to name the second, and the DCF opens on its valuation —
   * rather than on three companies from a list and a first name in a registry.
  */
  const held = useRememberedCompany();
  const pathname = usePathname();
  const moreId = useId();
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const isCurrent = (destination: string) => {
    if (destination === "/company") return pathname === "/company" || pathname.startsWith("/s/");
    return pathname === destination;
  };

  useEffect(() => {
    if (!moreOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
      moreButton.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [moreOpen]);

  const compareHref = onCompany("/compare", held);
  const dcfHref = onCompany("/dcf", held);

  return (
    <div className="io">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="bar">
        <div className="wrap bar-inner bar-main">
          <a href="/" className="mark" aria-current={pathname === "/" ? "page" : undefined}>FinScope<span className="dim">.io</span></a>
          {search ? <div className="bar-desktop-search"><Search /></div> : <span className="bar-spacer" />}
          {/*
            * Plain anchors, like the wordmark beside them and the company links
            * everywhere else on this site: a document navigation works with or
            * without hydration, and every destination here is prerendered.
            *
            * They sit after the search, which is the element that grows, so the
            * destinations and the switch are carried to the right edge together
            * without either being positioned by hand.
            */}
          <nav className="bar-nav" aria-label="Primary navigation">
            <a href="/market" aria-current={isCurrent("/market") ? "page" : undefined}>Market</a>
            <a href="/company" aria-current={isCurrent("/company") ? "page" : undefined}>Company</a>
            <a href={compareHref} aria-current={isCurrent("/compare") ? "page" : undefined}>Compare</a>
            <a href="/screener" aria-current={isCurrent("/screener") ? "page" : undefined}>Screener</a>
            <a href={dcfHref} aria-current={isCurrent("/dcf") ? "page" : undefined}>DCF</a>
            <a href="/portfolio" aria-current={isCurrent("/portfolio") ? "page" : undefined}>Portfolio</a>
            <a href="/alerts" aria-current={isCurrent("/alerts") ? "page" : undefined}>Alerts</a>
          </nav>
          <ThemeSwitch />
          <a className="settings-link" href="/settings" aria-label="Open settings" title="Settings" aria-current={isCurrent("/settings") ? "page" : undefined}>
            <SettingsIcon aria-hidden="true" size={14} strokeWidth={1.5} />
          </a>
        </div>

        {search ? <div className="wrap bar-mobile-search"><Search /></div> : null}

        <nav className="wrap bar-mobile-nav" aria-label="Primary navigation">
          <a href="/market" aria-current={isCurrent("/market") ? "page" : undefined}>Market</a>
          <a href="/company" aria-current={isCurrent("/company") ? "page" : undefined}>Company</a>
          <a href="/screener" aria-current={isCurrent("/screener") ? "page" : undefined}>Screener</a>
          <a href="/portfolio" aria-current={isCurrent("/portfolio") ? "page" : undefined}>Portfolio</a>
          <div className="mobile-more" ref={moreRef}>
            <button
              ref={moreButton}
              type="button"
              aria-expanded={moreOpen}
              aria-controls={moreId}
              data-active={isCurrent("/compare") || isCurrent("/dcf") || isCurrent("/alerts")}
              onClick={() => setMoreOpen((open) => !open)}
            >
              More <span aria-hidden="true">{moreOpen ? "−" : "+"}</span>
            </button>
            {moreOpen ? (
              <div className="mobile-more-panel" id={moreId}>
                <a href={compareHref} aria-current={isCurrent("/compare") ? "page" : undefined}>Compare</a>
                <a href={dcfHref} aria-current={isCurrent("/dcf") ? "page" : undefined}>DCF</a>
                <a href="/alerts" aria-current={isCurrent("/alerts") ? "page" : undefined}>Alerts</a>
              </div>
            ) : null}
          </div>
        </nav>
      </header>
      {children}
      <footer className="io-legal wrap">
        <span>Research information only · not investment advice</span>
        <span>Filed and calculated data · no analyst estimates</span>
      </footer>
    </div>
  );
}
