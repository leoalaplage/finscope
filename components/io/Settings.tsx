"use client";

import { useSyncExternalStore } from "react";
import { readTheme, setTheme, subscribeTheme, type Theme } from "./theme";

const THEMES: Array<{ value: Theme; label: string; note: string }> = [
  { value: "dark", label: "Dark", note: "Black ground · light ink" },
  { value: "light", label: "Light", note: "White ground · dark ink" },
];

export function Settings() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as Theme);

  return (
    <main className="wrap settings-page">
      <header className="head settings-head">
        <div className="head-id">
          <h1 className="head-ticker">Settings</h1>
          <p className="head-name">Account, appearance and this device</p>
        </div>
        <p className="head-note">Preferences stay in this browser</p>
      </header>

      <div className="settings-layout">
        <nav className="settings-index" aria-label="Settings sections">
          <a href="#account">Account</a>
          <a href="#appearance">Appearance</a>
          <a href="#data">Data &amp; privacy</a>
        </nav>

        <div className="settings-content">
          <section className="section settings-section" id="account">
            <div className="settings-copy">
              <h2>Account</h2>
              <p>One identity for a watchlist and portfolio that can follow you across devices.</p>
            </div>
            <div className="settings-control">
              <div className="settings-control-head">
                <div>
                  <span className="label">Status</span>
                  <strong>Not signed in</strong>
                </div>
                <span className="settings-status">Foundation</span>
              </div>

              <div className="settings-fields" aria-label="Account creation preview" aria-describedby="account-foundation-note">
                <label>
                  <span className="label">Email</span>
                  <input type="email" placeholder="name@example.com" autoComplete="email" disabled />
                </label>
                <label>
                  <span className="label">Password</span>
                  <input type="password" placeholder="••••••••••••" autoComplete="new-password" disabled />
                </label>
              </div>

              <div className="settings-actions">
                <button className="settings-primary" type="button" disabled>Create account</button>
                <button className="settings-secondary" type="button" disabled>Sign in</button>
                <span className="stat-note" id="account-foundation-note">Account service not connected yet · nothing is collected</span>
              </div>
            </div>
          </section>

          <section className="section settings-section" id="appearance">
            <div className="settings-copy">
              <h2>Appearance</h2>
              <p>Choose the same one-ink interface on a light or dark ground.</p>
            </div>
            <div className="settings-control">
              <span className="label">Theme</span>
              <div className="settings-theme" role="group" aria-label="Theme">
                {THEMES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={theme === option.value}
                    onClick={() => setTheme(option.value)}
                  >
                    <span className="settings-theme-sample" data-theme={option.value} aria-hidden="true"><i /></span>
                    <span><strong>{option.label}</strong><small>{option.note}</small></span>
                  </button>
                ))}
              </div>
              <p className="stat-note settings-note">Saved on this device and applied before the next page is drawn.</p>
            </div>
          </section>

          <section className="section settings-section" id="data">
            <div className="settings-copy">
              <h2>Data &amp; privacy</h2>
              <p>What FinScope remembers today, and where each preference lives.</p>
            </div>
            <div className="settings-control settings-data">
              <dl>
                <div><dt>Watchlist &amp; last company</dt><dd>This browser</dd></div>
                <div><dt>Portfolio holdings</dt><dd>This browser</dd></div>
                <div><dt>Theme preference</dt><dd>This browser</dd></div>
                <div><dt>Account sync</dt><dd>Not connected</dd></div>
              </dl>
              <p className="stat-note settings-note">Public filing and market data may be cached by FinScope. Your watchlist and portfolio are not sent to a FinScope account.</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
