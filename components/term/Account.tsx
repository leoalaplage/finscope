"use client";

import { useState, useSyncExternalStore } from "react";
import { SYNCED_KEYS } from "@/lib/account-sync";
import { createPasskey, deleteAccount, passkeyError, passkeysSupported, removePasskey, saveEmail, signIn, signOut, useAccount } from "@/components/io/account";
import { SYNC_EVENT, syncStatus } from "@/components/io/AccountSync";
import { shortDate } from "@/components/io/format";
import { Panel } from "./Panel";

/** In the top bar: the account's name, or the way in. */
export function AccountChip() {
  const { loaded, account } = useAccount();
  if (!loaded) return null;
  return (
    <a href="/t/account" className="t-account-chip" data-signed-in={account ? "" : undefined} title={account ? "Your account: sync and email alerts" : "Sign in to keep your work on every device"}>
      {account ? account.name.slice(0, 16).toUpperCase() : "SIGN IN"}
    </a>
  );
}

const subscribeSync = (notify: () => void) => { window.addEventListener(SYNC_EVENT, notify); return () => window.removeEventListener(SYNC_EVENT, notify); };
const NO_SYNC = { state: "idle" as const, at: null };
const noop = () => () => undefined;

/**
 * ACCT: an account signed in with a passkey (lib/accounts.ts) — so that the
 * watchlists, the portfolio, the notes, the saved screens and the terminal's
 * workspace follow the reader between devices — and the daily email of what
 * changed for the companies they follow.
 */
export function AccountPage() {
  const { loaded, account, emailService } = useAccount();
  const sync = useSyncExternalStore(subscribeSync, syncStatus, () => NO_SYNC);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const supported = useSyncExternalStore(noop, passkeysSupported, () => true);
  // Arriving from the confirmation email's link.
  const linked = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).get("email"), () => null);
  const linkMessage = linked === "verified" ? { tone: "ok" as const, text: "Your address is confirmed: the daily email is on." }
    : linked === "expired" ? { tone: "error" as const, text: "That link has expired or was already used. Save the address again for a new one." } : null;

  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true); setMessage(null);
    try { await action(); if (done) setMessage({ tone: "ok", text: done }); }
    catch (error) { setMessage({ tone: "error", text: passkeyError(error) }); }
    finally { setBusy(false); }
  };

  const shownAddress = address ?? account?.email?.address ?? "";
  const shown = message ?? linkMessage;
  const status = shown ? <p className="t-acct-message" data-tone={shown.tone} role="status">{shown.text}</p> : null;

  if (!loaded) return <div className="t-grid"><Panel code="ACCT" title="Account"><p className="t-empty">Reading your account…</p></Panel></div>;

  if (!account) {
    return (
      <div className="t-grid">
        <Panel code="ACCT" title="Account">
          <div className="t-panel-pad t-acct-body">
            <p className="t-acct-message">An account keeps your watchlists, portfolio, notes, saved screens and terminal layout on every device you sign in on, and can email you once a day what changed for the companies you follow. Without one, everything stays in this browser, as it does now.</p>
            {!supported ? <p className="t-acct-message" data-tone="error">This browser cannot use passkeys. Any recent Safari, Chrome, Edge or Firefox can.</p> : (
              <>
                <section>
                  <h3>Sign in</h3>
                  <div className="t-acct-row">
                    <button type="button" className="t-chip" disabled={busy} onClick={() => { void run(signIn, "Signed in."); }}>Sign in with a passkey</button>
                  </div>
                </section>
                <section>
                  <h3>Create an account</h3>
                  <div className="t-acct-row">
                    <input type="text" value={name} maxLength={60} placeholder="Your name (optional)" aria-label="Your name" onChange={(event) => setName(event.target.value)} />
                    <button type="button" className="t-chip" disabled={busy} onClick={() => { void run(() => createPasskey(name), "Account created, and this browser's work saved to it."); }}>Create with a passkey</button>
                  </div>
                  <p className="t-study-note">A passkey is your device&apos;s own lock — Face ID, Touch ID, Windows Hello, or a security key. There is no password to choose, remember or leak, and no one but your device can sign in as you. Your work in this browser is saved to the account as soon as it is created.</p>
                </section>
              </>
            )}
            {status}
          </div>
        </Panel>
      </div>
    );
  }

  const email = account.email;
  return (
    <div className="t-grid">
      <Panel code="ACCT" title={`Account · ${account.name}`} actions={<button type="button" className="t-chip" disabled={busy} onClick={() => { void run(signOut, "Signed out. This browser keeps its copy of your work."); }}>Sign out</button>}>
        <div className="t-panel-pad t-acct-body">
          {status}
          <section>
            <h3>Sync</h3>
            <p className="t-acct-message">
              {sync.state === "failed" ? `Not synced: ${sync.error ?? "the server did not answer"}. It will try again.` : sync.state === "syncing" ? "Syncing…" : sync.at ? `In sync, ${new Date(sync.at).toLocaleTimeString()}.` : "Waiting for the first sync…"}
            </p>
            <p className="t-study-note">Kept on the account and on every device you sign in on: watchlists, portfolio and its trades, notes, saved screens, scans, backtests, chart drawings and studies, and the terminal&apos;s layout ({SYNCED_KEYS.length} stores). The newer copy of each wins. Display preferences stay with each device.</p>
          </section>

          <section>
            <h3>Daily email</h3>
            {!emailService ? <p className="t-acct-message">Email delivery is not switched on for this site yet. Your address and choice are kept, and the first email will go out once it is.</p> : null}
            <div className="t-acct-row">
              <input type="email" value={shownAddress} placeholder="you@example.com" aria-label="Email address" onChange={(event) => setAddress(event.target.value)} />
              <label className="t-acct-row"><input type="checkbox" checked={email?.alerts ?? true} disabled={!email} onChange={(event) => { void run(() => saveEmail(email!.address, event.target.checked), event.target.checked ? "The daily email is on." : "The daily email is off."); }} /> Send the daily email</label>
              <button type="button" className="t-chip" disabled={busy || !shownAddress.trim() || shownAddress.trim().toLowerCase() === email?.address} onClick={() => { void run(() => saveEmail(shownAddress, email?.alerts ?? true), emailService ? "Saved. Follow the link we have just sent to confirm the address." : "Saved."); setAddress(null); }}>Save</button>
              {email ? <button type="button" className="t-chip" disabled={busy} onClick={() => { void run(() => saveEmail(null, false), "Address removed."); setAddress(null); }}>Remove</button> : null}
            </div>
            {email ? (
              <p className="t-study-note">
                {email.verified ? "Confirmed." : "Not confirmed yet: nothing is sent until you follow the link in the confirmation email."}
                {email.lastSent ? ` Last sent ${shortDate(email.lastSent.slice(0, 10))}.` : ""}
                {" "}Once a day after the US close, only when something changed: results, reports, leadership changes, deals, red flags and insider purchases for the companies in your watchlists, portfolio and notes.
              </p>
            ) : null}
          </section>

          <section>
            <h3>Passkeys</h3>
            <ul className="t-acct-list">
              {account.passkeys.map((passkey) => (
                <li key={passkey.id}>
                  <span>{passkey.label}</span>
                  <span className="t-dim">added {shortDate(passkey.created.slice(0, 10))}</span>
                  {account.passkeys.length > 1 ? <button type="button" className="t-chip" disabled={busy} onClick={() => { if (window.confirm(`Remove the passkey "${passkey.label}"? That device will no longer sign in.`)) void run(() => removePasskey(passkey.id), "Passkey removed."); }}>Remove</button> : null}
                </li>
              ))}
            </ul>
            <div className="t-acct-row">
              <button type="button" className="t-chip" disabled={busy || !supported} onClick={() => { void run(() => createPasskey(), "Passkey added: this device can now sign in on its own."); }}>Add a passkey on this device</button>
            </div>
            <p className="t-study-note">Passkeys on an Apple or Google account follow it to your other devices. Add one per device otherwise, so losing one never locks you out.</p>
          </section>

          <section>
            <h3>Delete</h3>
            <button type="button" className="t-chip t-acct-danger" disabled={busy} onClick={() => { if (window.confirm("Delete the account and everything it keeps? This browser keeps its own copy.")) void run(deleteAccount, "Account deleted."); }}>Delete the account</button>
          </section>
        </div>
      </Panel>
    </div>
  );
}
