"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DATA_LIMIT, describeSynced, SYNCED_KEYS, SYNCED_LABELS, type SyncedData, type SyncedKey } from "@/lib/account-sync";
import {
  accountData, continueWith, createPasskey, deleteAccount, disconnectIdentity, emailSignInLink, passkeyError, passkeysSupported, removePasskey,
  renameAccount, renamePasskey, saveEmail, signIn, signOut, useAccount, type SignInProviders,
} from "./account";
import { SYNC_EVENT, syncNow, syncStatus } from "./AccountSync";
import { openBillingPortal, SUPPORT_EMAIL, useBilling } from "./billing";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};
const moment = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : `${day(iso)}, ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`);

const subscribeSync = (notify: () => void) => { window.addEventListener(SYNC_EVENT, notify); return () => window.removeEventListener(SYNC_EVENT, notify); };
const NO_SYNC = { state: "idle" as const, at: null };
const noop = () => () => undefined;

type Message = { tone: "ok" | "error"; text: string } | null;

/**
 * The reader's account, as a page of the site (app/account): who they are,
 * what follows them between devices and when it last did, the daily email,
 * the passkeys that sign them in, and their data — to take away or to delete.
 */
export function AccountPage() {
  const { loaded, account, emailService, providers } = useAccount();
  const sync = useSyncExternalStore(subscribeSync, syncStatus, () => NO_SYNC);
  const supported = useSyncExternalStore(noop, passkeysSupported, () => true);
  const linked = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).get("email"), () => null);
  // Back from Google, Microsoft or an emailed link (app/api/account/oauth, app/api/account/email-login).
  const signinState = useSyncExternalStore(noop, () => window.location.search, () => "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true); setMessage(null);
    try { await action(); if (done) setMessage({ tone: "ok", text: done }); }
    catch (error) { setMessage({ tone: "error", text: passkeyError(error) }); }
    finally { setBusy(false); }
  };

  const linkMessage: Message = linked === "verified" ? { tone: "ok", text: "Your address is confirmed. The daily email is on." }
    : linked === "expired" ? { tone: "error", text: "That confirmation link has expired or was already used. Save the address again to get a new one." } : null;
  const query = new URLSearchParams(signinState);
  const signinMessage: Message = query.get("signin") === "ok" ? { tone: "ok", text: "Signed in. Your data is syncing to this browser." }
    : query.get("signin") === "linked" ? { tone: "ok", text: "Connected: you can now sign in this way too." }
    : query.get("signin") === "unavailable" ? { tone: "error", text: "That way of signing in is not available yet." }
    : query.get("signin") === "error" ? { tone: "error", text: query.get("reason") ?? "The sign-in failed. Try again." } : null;
  const shown = message ?? linkMessage ?? signinMessage;
  const notice = <p className="acct-notice" data-tone={shown?.tone} role="status" aria-live="polite">{shown?.text ?? ""}</p>;

  if (!loaded) {
    return (
      <main className="wrap settings-page acct" id="main-content" tabIndex={-1}>
        <header className="head settings-head"><div className="head-id"><h1 className="head-ticker">Account</h1><p className="head-name">Reading your account…</p></div></header>
      </main>
    );
  }

  if (!account) return <SignedOut supported={supported} providers={providers} busy={busy} run={run} notice={notice} />;

  const methods = account.passkeys.length + (account.identities?.length ?? 0);
  const via = [...new Set((account.identities ?? []).map((identity) => ({ google: "Google", apple: "Apple", microsoft: "Microsoft", email: "email link" })[identity.provider]))];
  return (
    <main className="wrap settings-page acct" id="main-content" tabIndex={-1}>
      <header className="head settings-head acct-head">
        <div className="head-id">
          <h1 className="head-ticker">Account</h1>
          <p className="head-name">
            {account.name} · member since {day(account.created)} · {methods} sign-in method{methods === 1 ? "" : "s"}{via.length ? ` (${via.join(", ")}${account.passkeys.length ? ", passkey" : ""})` : ""}
          </p>
        </div>
        <div className="acct-head-actions">
          <SyncBadge state={sync.state} at={sync.at} />
          <a className="acct-btn acct-btn-link" href="/t/alerts">Alerts</a>
          <button type="button" className="acct-btn" disabled={busy} onClick={() => { void run(signOut, "Signed out. This browser keeps its own copy of your work."); }}>Sign out</button>
        </div>
      </header>
      {notice}

      <div className="settings-layout">
        <nav className="settings-index" aria-label="Account sections">
          <a href="#profile">Profile</a>
          <a href="#sync">Sync</a>
          <a href="#alerts">Email alerts</a>
          <a href="#subscription">Subscription</a>
          <a href="#security">Sign-in</a>
          <a href="#data">Your data</a>
        </nav>
        <div className="settings-content">
          <Profile key={`profile-${account.name}`} name={account.name} created={account.created} id={account.id} busy={busy} run={run}
            methods={[...new Set([...(account.identities ?? []).map((identity) => ({ google: "Google", apple: "Apple", microsoft: "Microsoft", email: "Email link" })[identity.provider]), ...(account.passkeys.length ? ["Passkey"] : [])])]} />
          <SubscriptionSection />
          <Sync syncState={sync.state} syncAt={sync.at} syncError={sync.error} />
          <Alerts key={`alerts-${account.email?.address ?? ""}`} email={account.email} emailService={emailService} busy={busy} run={run} />
          <Security passkeys={account.passkeys} identities={account.identities ?? []} providers={providers} supported={supported} busy={busy} run={run} />
          <DataSection name={account.name} busy={busy} run={run} />
        </div>
      </div>
    </main>
  );
}

type Run = (action: () => Promise<void>, done?: string) => Promise<void>;

function SyncBadge({ state, at }: { state: string; at: string | null }) {
  const text = state === "failed" ? "Not synced" : state === "syncing" ? "Syncing…" : at ? `Synced ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting to sync";
  return <span className="acct-badge" data-tone={state === "failed" ? "bad" : state === "synced" ? "good" : undefined}>{text}</span>;
}

function Section({ id, title, lede, children }: { id: string; title: string; lede: string; children: React.ReactNode }) {
  return (
    <section className="section settings-section" id={id}>
      <div className="settings-copy"><h2>{title}</h2><p>{lede}</p></div>
      <div className="settings-control">{children}</div>
    </section>
  );
}

/* --- Signed out ----------------------------------------------------------- */

/** The providers' own marks, as their sign-in guidelines ask. */
export function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
function AppleMark() {
  return (
    <svg viewBox="0 0 384 512" width="15" height="18" aria-hidden="true" fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}
function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" width="16" height="16" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" /><rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" /><rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function SignedOut({ supported, providers, busy, run, notice }: { supported: boolean; providers: SignInProviders; busy: boolean; run: Run; notice: React.ReactNode }) {
  const [address, setAddress] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [passkeyName, setPasskeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const social = providers.google || providers.apple || providers.microsoft;
  return (
    <main className="wrap settings-page acct" id="main-content" tabIndex={-1}>
      <header className="head settings-head">
        <div className="head-id">
          <h1 className="head-ticker">Account</h1>
          <p className="head-name">Cross-device sync and daily email alerts</p>
        </div>
        <p className="head-note">Passwordless sign-in</p>
      </header>
      {notice}
      <div className="acct-signin">
        <div className="acct-signin-card">
          <h2>Sign in or create an account</h2>
          <p>New accounts are created on first sign-in and include the data stored in this browser.</p>
          {social ? (
            <div className="acct-providers">
              {providers.google ? <button type="button" className="acct-provider" disabled={busy} onClick={() => continueWith("google")}><GoogleMark />Continue with Google</button> : null}
              {providers.apple ? <button type="button" className="acct-provider acct-provider-apple" disabled={busy} onClick={() => continueWith("apple")}><AppleMark />Continue with Apple</button> : null}
              {providers.microsoft ? <button type="button" className="acct-provider" disabled={busy} onClick={() => continueWith("microsoft")}><MicrosoftMark />Continue with Microsoft</button> : null}
            </div>
          ) : null}
          {providers.email ? (
            <>
              {social ? <div className="acct-or"><span>or</span></div> : null}
              {sentTo ? (
                <p className="acct-sent">Check your inbox: a sign-in link is on its way to <strong>{sentTo}</strong>. It works once, for fifteen minutes. <button type="button" className="acct-link" onClick={() => setSentTo(null)}>Use another address</button></p>
              ) : (
                <form className="acct-email-form" onSubmit={(event) => { event.preventDefault(); const to = address.trim(); void run(() => emailSignInLink(to).then(() => setSentTo(to))); }}>
                  <input className="field" type="email" required value={address} placeholder="you@example.com" autoComplete="email" aria-label="Email address" onChange={(event) => setAddress(event.target.value)} />
                  <button type="submit" className="acct-btn acct-btn-primary" disabled={busy || !address.trim()}>Continue with email</button>
                </form>
              )}
            </>
          ) : null}
          {supported ? (
            <>
              <div className="acct-or"><span>{social || providers.email ? "or with a passkey" : "with a passkey"}</span></div>
              <div className="acct-passkey-row">
                <button type="button" className="acct-btn" disabled={busy} onClick={() => { void run(signIn, "Signed in. Your data is syncing to this browser."); }}>Sign in with a passkey</button>
                <button type="button" className="acct-link" onClick={() => setCreating((open) => !open)}>{creating ? "Cancel" : "New here? Create one with a passkey"}</button>
              </div>
              {creating ? (
                <form className="acct-email-form" onSubmit={(event) => { event.preventDefault(); void run(() => createPasskey(passkeyName), "Account created. This browser's work is saved to it."); }}>
                  <input className="field" type="text" value={passkeyName} maxLength={40} placeholder="Display name, e.g. Léo" autoComplete="nickname" aria-label="Display name" onChange={(event) => setPasskeyName(event.target.value)} />
                  <button type="submit" className="acct-btn acct-btn-primary" disabled={busy}>Create with a passkey</button>
                </form>
              ) : null}
            </>
          ) : null}
          <p className="acct-terms">By continuing you agree that Tenqay keeps your account and what is listed under Sync. Research information only, not investment advice.</p>
        </div>
        <ul className="acct-benefits acct-benefits-side">
          <li><strong>Sync</strong><span>Watchlists, portfolio, notes, saved screens and the terminal&apos;s layout, the same on your phone and your computer.</span></li>
          <li><strong>Daily email</strong><span>Once a day after the US close, only when something changed for the companies you follow.</span></li>
          <li><strong>No password</strong><span>Google, Apple, a link by email or your device&apos;s own lock. No password to manage.</span></li>
        </ul>
      </div>
      <p className="stat-note acct-fineprint">Without an account nothing changes: everything stays in this browser, as before. You can take your data away or delete the account at any time.</p>
    </main>
  );
}

/* --- Subscription --------------------------------------------------------- */

/** The plan, its renewal, and Stripe's billing portal (components/io/billing.ts). */
function SubscriptionSection() {
  const billing = useBilling();
  const [failure, setFailure] = useState<string | null>(null);
  if (!billing || (!billing.billing && !billing.subscription)) {
    return (
      <Section id="subscription" title="Subscription" lede="Tenqay is billed monthly or annually.">
        <p className="acct-muted">Complimentary access during the beta. <a href="/t/welcome?step=account">View plans</a></p>
      </Section>
    );
  }
  const subscription = billing.subscription;
  const end = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : null;
  return (
    <Section id="subscription" title="Subscription" lede="Your plan, its renewal, payment method and invoices.">
      {subscription && billing.entitled ? (
        <>
          <p><strong>{subscription.plan === "annual" ? "Annual" : subscription.plan === "monthly" ? "Monthly" : "Active"}</strong> · {subscription.cancelAtPeriodEnd ? `ends ${end ?? ""}` : `renews ${end ?? ""}`}{subscription.status === "past_due" ? " · payment overdue" : ""}</p>
          <button type="button" className="acct-btn" onClick={() => { setFailure(null); openBillingPortal().catch((error: unknown) => setFailure(error instanceof Error ? error.message : "Unavailable.")); }}>Manage billing</button>
        </>
      ) : (
        <>
          <p className="acct-muted">{subscription ? "Your subscription has ended." : "No active subscription."}</p>
          <a className="acct-btn acct-btn-primary" href="/t/welcome?step=account">View plans</a>
        </>
      )}
      {failure ? <p className="acct-notice" data-tone="error">{failure}</p> : null}
      <p className="acct-muted">Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
    </Section>
  );
}

/* --- Profile -------------------------------------------------------------- */

function Profile({ name, created, id, busy, run, methods }: { name: string; created: string; id: string; busy: boolean; run: Run; methods: string[] }) {
  const [draft, setDraft] = useState(name);
  const changed = draft.trim() !== name && draft.trim().length > 0;
  return (
    <Section id="profile" title="Profile" lede="The name shown on your account and offered by your devices when you sign in.">
      <form className="acct-inline" onSubmit={(event) => { event.preventDefault(); if (changed) void run(() => renameAccount(draft), "Name saved."); }}>
        <label className="acct-field acct-grow">
          <span className="label">Display name</span>
          <input className="field" type="text" value={draft} maxLength={40} autoComplete="nickname" onChange={(event) => setDraft(event.target.value)} />
        </label>
        <button type="submit" className="acct-btn acct-btn-primary" disabled={busy || !changed}>Save</button>
        {changed ? <button type="button" className="acct-btn" onClick={() => setDraft(name)}>Cancel</button> : null}
      </form>
      <dl className="acct-facts">
        <div><dt>Member since</dt><dd>{day(created)}</dd></div>
        <div><dt>Account ID</dt><dd className="acct-mono">{id.slice(0, 8)}…</dd></div>
        <div><dt>Sign-in</dt><dd>{methods.join(", ") || "—"} · <a href="#security">manage</a></dd></div>
      </dl>
    </Section>
  );
}

/* --- Sync ----------------------------------------------------------------- */

function Sync({ syncState, syncAt, syncError }: { syncState: string; syncAt: string | null; syncError?: string }) {
  const [items, setItems] = useState<SyncedData | null>(null);
  const [failed, setFailed] = useState(false);
  // Read again after every sync, so the table is what the account holds now.
  useEffect(() => {
    let live = true;
    accountData().then((data) => { if (live) { setItems(data); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [syncAt]);
  const rows = SYNCED_KEYS.map((key) => ({ key, item: items?.[key] ?? null }))
    .filter(({ key, item }) => item?.value != null || key !== "finscope.io.home-watchlist.v1");
  const total = rows.reduce((sum, row) => sum + (row.item?.value?.length ?? 0), 0);
  const groups = ["Lists", "Research", "Terminal"] as const;

  return (
    <Section id="sync" title="Sync" lede="Kept on your account and on every device you sign in on. The newer copy of each wins; display preferences such as the theme stay with each device.">
      <div className="acct-inline acct-between">
        <p className="acct-status" data-tone={syncState === "failed" ? "bad" : undefined}>
          {syncState === "failed" ? `Not synced: ${syncError ?? "the server did not answer"}. It will try again.` : syncState === "syncing" ? "Syncing…" : syncAt ? `Last synced ${moment(syncAt)}` : "Waiting for the first sync…"}
        </p>
        <button type="button" className="acct-btn" onClick={syncNow}>Sync now</button>
      </div>
      {failed ? <p className="acct-notice" data-tone="error">Account data is temporarily unavailable.</p> : !items ? <p className="stat-note">Reading what the account holds…</p> : (
        <>
          <div className="acct-table" role="table" aria-label="What the account keeps">
            <div className="acct-row acct-row-head" role="row"><span role="columnheader">Kept</span><span role="columnheader">Holds</span><span role="columnheader">Size</span><span role="columnheader">Changed</span></div>
            {groups.map((group) => (
              <div key={group} role="rowgroup">
                <div className="acct-group" role="row"><span role="cell">{group}</span></div>
                {rows.filter((row) => SYNCED_LABELS[row.key as SyncedKey].group === group).map(({ key, item }) => (
                  <div className="acct-row" role="row" key={key} data-empty={item?.value == null || undefined}>
                    <span role="cell">{SYNCED_LABELS[key as SyncedKey].label}</span>
                    <span role="cell">{item?.value == null ? "Nothing yet" : describeSynced(key as SyncedKey, item.value) ?? "Kept"}</span>
                    <span role="cell" className="acct-mono">{item?.value == null ? "—" : size(item.value.length)}</span>
                    <span role="cell">{item?.value == null ? "—" : day(item.at)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="acct-meter" aria-label={`${size(total)} of ${size(DATA_LIMIT)} used`}>
            <span style={{ width: `${Math.min(100, (total / DATA_LIMIT) * 100).toFixed(1)}%` }} />
          </div>
          <p className="stat-note">{size(total)} of {size(DATA_LIMIT)} used.</p>
        </>
      )}
    </Section>
  );
}

/* --- Email alerts ----------------------------------------------------------- */

function Alerts({ email, emailService, busy, run }: {
  email: { address: string; verified: boolean; alerts: boolean; lastSent: string | null } | null; emailService: boolean; busy: boolean; run: Run;
}) {
  const [address, setAddress] = useState(email?.address ?? "");
  const changed = address.trim().toLowerCase() !== (email?.address ?? "") && address.trim().length > 0;
  return (
    <Section id="alerts" title="Email alerts" lede="One email a day after the US close, only when something changed for the companies in your watchlists, portfolio and notes.">
      {!emailService ? <p className="acct-notice">Email delivery is not switched on for Tenqay yet. Your address and choice are kept; the first email goes out once it is.</p> : null}
      <form className="acct-inline" onSubmit={(event) => { event.preventDefault(); if (changed) void run(() => saveEmail(address, email?.alerts ?? true), emailService ? "Saved. Follow the link we have just sent to confirm the address." : "Address saved."); }}>
        <label className="acct-field acct-grow">
          <span className="label">Email address</span>
          <input className="field" type="email" value={address} placeholder="you@example.com" autoComplete="email" onChange={(event) => setAddress(event.target.value)} />
        </label>
        <button type="submit" className="acct-btn acct-btn-primary" disabled={busy || !changed}>{email ? "Change" : "Save"}</button>
        {email ? <button type="button" className="acct-btn" disabled={busy} onClick={() => { void run(() => saveEmail(null, false), "Address removed. No email will be sent."); }}>Remove</button> : null}
      </form>
      {email ? (
        <>
          <dl className="acct-facts">
            <div><dt>Status</dt><dd><span className="acct-badge" data-tone={email.verified ? "good" : "warn"}>{email.verified ? "Confirmed" : "Waiting for confirmation"}</span></dd></div>
            <div><dt>Last email</dt><dd>{email.lastSent ? moment(email.lastSent) : "None yet"}</dd></div>
          </dl>
          <label className="acct-switch">
            <input type="checkbox" checked={email.alerts} disabled={busy} onChange={(event) => { void run(() => saveEmail(email.address, event.target.checked), event.target.checked ? "The daily email is on." : "The daily email is off."); }} />
            <span aria-hidden="true" />
            Send me the daily email
          </label>
          {!email.verified ? <p className="stat-note">Nothing is sent until you follow the link in the confirmation email.</p> : null}
        </>
      ) : null}
      <p className="stat-note"><a href="/t/alerts">Manage your alerts</a>: choose which companies and which kinds of news, add price alerts, pause or delete them.</p>
      <ul className="acct-list-plain">
        <li>Results and quarterly or annual reports</li>
        <li>Leadership changes, deals and red flags filed with the SEC</li>
        <li>Open-market purchases by insiders</li>
      </ul>
    </Section>
  );
}

/* --- Security --------------------------------------------------------------- */

const PROVIDER_NAMES: Record<string, string> = { google: "Google", apple: "Apple", microsoft: "Microsoft", email: "Email link" };

function Security({ passkeys, identities, providers, supported, busy, run }: {
  passkeys: Array<{ id: string; label: string; created: string; lastUsed: string | null }>;
  identities: Array<{ provider: string; subject: string; email: string | null; added: string; lastUsed: string | null }>;
  providers: SignInProviders; supported: boolean; busy: boolean; run: Run;
}) {
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const methods = passkeys.length + identities.length;
  const connected = new Set(identities.map((identity) => identity.provider));
  return (
    <Section id="security" title="Sign-in methods" lede="Every way you can sign in to this account. Keep two, so losing one never locks you out.">
      <ul className="acct-passkeys">
        {identities.map((identity) => (
          <li key={`${identity.provider}-${identity.subject}`}>
            <div className="acct-passkey acct-method">
              <span className="acct-method-mark" aria-hidden="true">{identity.provider === "google" ? <GoogleMark /> : identity.provider === "apple" ? <AppleMark /> : identity.provider === "microsoft" ? <MicrosoftMark /> : "@"}</span>
              <div>
                <strong>{PROVIDER_NAMES[identity.provider] ?? identity.provider}{identity.email ? ` · ${identity.email}` : ""}</strong>
                <span>Connected {day(identity.added)} · {identity.lastUsed ? `last used ${moment(identity.lastUsed)}` : "not used yet"}</span>
              </div>
            </div>
            {methods > 1 ? (
              <button type="button" className="acct-btn acct-btn-danger" disabled={busy} onClick={() => { if (window.confirm(`Disconnect ${PROVIDER_NAMES[identity.provider]}? You will no longer sign in that way.`)) void run(() => disconnectIdentity(identity.provider, identity.subject), "Disconnected."); }}>Disconnect</button>
            ) : null}
          </li>
        ))}
        {passkeys.map((passkey) => (
          <li key={passkey.id}>
            {editing?.id === passkey.id ? (
              <form className="acct-inline acct-grow" onSubmit={(event) => { event.preventDefault(); void run(() => renamePasskey(passkey.id, editing.label), "Passkey renamed.").then(() => setEditing(null)); }}>
                <input className="field acct-grow" type="text" value={editing.label} maxLength={40} aria-label="Passkey name" onChange={(event) => setEditing({ id: passkey.id, label: event.target.value })} />
                <button type="submit" className="acct-btn acct-btn-primary" disabled={busy || !editing.label.trim()}>Save</button>
                <button type="button" className="acct-btn" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <div className="acct-passkey acct-method">
                  <span className="acct-method-mark" aria-hidden="true">⌘</span>
                  <div>
                    <strong>Passkey · {passkey.label}</strong>
                    <span>Added {day(passkey.created)} · {passkey.lastUsed ? `last used ${moment(passkey.lastUsed)}` : "not used to sign in yet"}</span>
                  </div>
                </div>
                <div className="acct-inline">
                  <button type="button" className="acct-btn" disabled={busy} onClick={() => setEditing({ id: passkey.id, label: passkey.label })}>Rename</button>
                  {methods > 1 ? (
                    <button type="button" className="acct-btn acct-btn-danger" disabled={busy} onClick={() => { if (window.confirm(`Remove "${passkey.label}"? That device will no longer sign in.`)) void run(() => removePasskey(passkey.id), "Passkey removed."); }}>Remove</button>
                  ) : null}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="acct-inline">
        {providers.google && !connected.has("google") ? <button type="button" className="acct-provider acct-provider-small" disabled={busy} onClick={() => continueWith("google")}><GoogleMark />Connect Google</button> : null}
        {providers.apple && !connected.has("apple") ? <button type="button" className="acct-provider acct-provider-small acct-provider-apple" disabled={busy} onClick={() => continueWith("apple")}><AppleMark />Connect Apple</button> : null}
        {providers.microsoft && !connected.has("microsoft") ? <button type="button" className="acct-provider acct-provider-small" disabled={busy} onClick={() => continueWith("microsoft")}><MicrosoftMark />Connect Microsoft</button> : null}
        <button type="button" className="acct-btn" disabled={busy || !supported} onClick={() => { void run(() => createPasskey(), "Passkey added. This device can now sign in on its own."); }}>Add a passkey on this device</button>
      </div>
      <p className="stat-note">Connecting Google or Apple lets you sign in with them; Tenqay never sees their password. Passkeys kept by iCloud Keychain or Google Password Manager follow you to your other devices.</p>
    </Section>
  );
}

/* --- Your data ------------------------------------------------------------------ */

function DataSection({ name, busy, run }: { name: string; busy: boolean; run: Run }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const exportData = async () => {
    const [items, account] = await Promise.all([accountData(), fetch("/api/account", { credentials: "same-origin" }).then((response) => response.json())]);
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), account: (account as { account: unknown }).account, items }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `tenqay-account-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <Section id="data" title="Your data" lede="Take a copy of everything the account keeps, or delete the account and all of it.">
      <div className="acct-inline">
        <button type="button" className="acct-btn" disabled={busy} onClick={() => { void run(exportData, "Your data was downloaded."); }}>Download my data (JSON)</button>
      </div>
      <div className="acct-danger">
        <h3>Delete the account</h3>
        <p>Removes the account, its passkeys, its copy of your work and its email settings, for good. This browser keeps its own copy.</p>
        {confirming ? (
          <form className="acct-inline" onSubmit={(event) => { event.preventDefault(); if (typed.trim() === name) void run(deleteAccount, "Account deleted."); }}>
            <label className="acct-field acct-grow">
              <span className="label">Type your display name, {name}, to confirm</span>
              <input className="field" type="text" value={typed} onChange={(event) => setTyped(event.target.value)} />
            </label>
            <button type="submit" className="acct-btn acct-btn-danger-solid" disabled={busy || typed.trim() !== name}>Delete for good</button>
            <button type="button" className="acct-btn" onClick={() => { setConfirming(false); setTyped(""); }}>Cancel</button>
          </form>
        ) : (
          <button type="button" className="acct-btn acct-btn-danger" onClick={() => setConfirming(true)}>Delete the account…</button>
        )}
      </div>
    </Section>
  );
}
