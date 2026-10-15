"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DATA_LIMIT, describeSynced, SYNCED_KEYS, SYNCED_LABELS, type SyncedData, type SyncedKey } from "@/lib/account-sync";
import {
  accountData, createPasskey, deleteAccount, passkeyError, passkeysSupported, removePasskey, renameAccount, renamePasskey,
  saveEmail, signIn, signOut, useAccount,
} from "./account";
import { SYNC_EVENT, syncNow, syncStatus } from "./AccountSync";

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
  const { loaded, account, emailService } = useAccount();
  const sync = useSyncExternalStore(subscribeSync, syncStatus, () => NO_SYNC);
  const supported = useSyncExternalStore(noop, passkeysSupported, () => true);
  const linked = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).get("email"), () => null);
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
  const shown = message ?? linkMessage;
  const notice = <p className="acct-notice" data-tone={shown?.tone} role="status" aria-live="polite">{shown?.text ?? ""}</p>;

  if (!loaded) {
    return (
      <main className="wrap settings-page acct" id="main-content" tabIndex={-1}>
        <header className="head settings-head"><div className="head-id"><h1 className="head-ticker">Account</h1><p className="head-name">Reading your account…</p></div></header>
      </main>
    );
  }

  if (!account) return <SignedOut supported={supported} busy={busy} run={run} notice={notice} />;

  const initial = account.name.trim().charAt(0).toUpperCase() || "F";
  return (
    <main className="wrap settings-page acct" id="main-content" tabIndex={-1}>
      <header className="head settings-head acct-head">
        <div className="acct-identity">
          <span className="acct-avatar" aria-hidden="true">{initial}</span>
          <div className="head-id">
            <h1 className="head-ticker">{account.name}</h1>
            <p className="head-name">
              Member since {day(account.created)} · {account.passkeys.length} passkey{account.passkeys.length === 1 ? "" : "s"}
              {account.email?.verified ? " · email confirmed" : ""}
            </p>
          </div>
        </div>
        <div className="acct-head-actions">
          <SyncBadge state={sync.state} at={sync.at} />
          <button type="button" className="acct-btn" disabled={busy} onClick={() => { void run(signOut, "Signed out. This browser keeps its own copy of your work."); }}>Sign out</button>
        </div>
      </header>
      {notice}

      <div className="settings-layout">
        <nav className="settings-index" aria-label="Account sections">
          <a href="#profile">Profile</a>
          <a href="#sync">Sync</a>
          <a href="#alerts">Email alerts</a>
          <a href="#security">Security</a>
          <a href="#data">Your data</a>
        </nav>
        <div className="settings-content">
          <Profile key={`profile-${account.name}`} name={account.name} created={account.created} id={account.id} busy={busy} run={run} />
          <Sync syncState={sync.state} syncAt={sync.at} syncError={sync.error} />
          <Alerts key={`alerts-${account.email?.address ?? ""}`} email={account.email} emailService={emailService} busy={busy} run={run} />
          <Security passkeys={account.passkeys} supported={supported} busy={busy} run={run} />
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

function SignedOut({ supported, busy, run, notice }: { supported: boolean; busy: boolean; run: Run; notice: React.ReactNode }) {
  const [name, setName] = useState("");
  return (
    <main className="wrap settings-page acct" id="main-content" tabIndex={-1}>
      <header className="head settings-head">
        <div className="head-id">
          <h1 className="head-ticker">Account</h1>
          <p className="head-name">Your work on every device, and a daily email of what changed</p>
        </div>
        <p className="head-note">Free · no password</p>
      </header>
      {notice}
      <div className="acct-welcome">
        <ul className="acct-benefits">
          <li><strong>Sync</strong><span>Watchlists, portfolio, notes, saved screens and the terminal&apos;s layout, the same on your phone and your computer.</span></li>
          <li><strong>Daily email</strong><span>Once a day after the US close, only when something changed for the companies you follow: results, filings, leadership changes, insider purchases.</span></li>
          <li><strong>Passkeys</strong><span>You sign in with your device&apos;s own lock: Face ID, Touch ID, Windows Hello or a security key. No password to choose, forget or leak.</span></li>
        </ul>

        {!supported ? (
          <p className="acct-notice" data-tone="error">This browser cannot use passkeys. Any recent Safari, Chrome, Edge or Firefox can.</p>
        ) : (
          <div className="acct-cards">
            <div className="acct-card">
              <h2>Sign in</h2>
              <p>With the passkey you made on this device, or one your Apple or Google account carries from another.</p>
              <button type="button" className="acct-btn acct-btn-primary" disabled={busy} onClick={() => { void run(signIn, "Signed in. Your work is being brought to this browser."); }}>Sign in with a passkey</button>
            </div>
            <div className="acct-card">
              <h2>Create an account</h2>
              <p>What this browser holds today is saved to it straight away.</p>
              <label className="acct-field">
                <span className="label">Display name</span>
                <input className="field" type="text" value={name} maxLength={40} placeholder="e.g. Léo" autoComplete="nickname" onChange={(event) => setName(event.target.value)} />
              </label>
              <button type="button" className="acct-btn acct-btn-primary" disabled={busy} onClick={() => { void run(() => createPasskey(name), "Account created. This browser's work is saved to it."); }}>Create with a passkey</button>
            </div>
          </div>
        )}
        <p className="stat-note acct-fineprint">Without an account nothing changes: everything stays in this browser, as before. Tenqay keeps only what is listed under Sync, never your passkey&apos;s private half, and you can take it away or delete it at any time.</p>
      </div>
    </main>
  );
}

/* --- Profile -------------------------------------------------------------- */

function Profile({ name, created, id, busy, run }: { name: string; created: string; id: string; busy: boolean; run: Run }) {
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
        <div><dt>Sign-in</dt><dd>Passkey only</dd></div>
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
      {failed ? <p className="acct-notice" data-tone="error">The account&apos;s copy could not be read just now.</p> : !items ? <p className="stat-note">Reading what the account holds…</p> : (
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
      <ul className="acct-list-plain">
        <li>Results and quarterly or annual reports</li>
        <li>Leadership changes, deals and red flags filed with the SEC</li>
        <li>Open-market purchases by insiders</li>
      </ul>
    </Section>
  );
}

/* --- Security --------------------------------------------------------------- */

function Security({ passkeys, supported, busy, run }: {
  passkeys: Array<{ id: string; label: string; created: string; lastUsed: string | null }>; supported: boolean; busy: boolean; run: Run;
}) {
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  return (
    <Section id="security" title="Security" lede="The passkeys that can sign in to this account. Add one on each device you use, so losing one never locks you out.">
      <ul className="acct-passkeys">
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
                <div className="acct-passkey">
                  <strong>{passkey.label}</strong>
                  <span>Added {day(passkey.created)} · {passkey.lastUsed ? `last used ${moment(passkey.lastUsed)}` : "not used to sign in yet"}</span>
                </div>
                <div className="acct-inline">
                  <button type="button" className="acct-btn" disabled={busy} onClick={() => setEditing({ id: passkey.id, label: passkey.label })}>Rename</button>
                  {passkeys.length > 1 ? (
                    <button type="button" className="acct-btn acct-btn-danger" disabled={busy} onClick={() => { if (window.confirm(`Remove "${passkey.label}"? That device will no longer sign in.`)) void run(() => removePasskey(passkey.id), "Passkey removed."); }}>Remove</button>
                  ) : null}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="acct-btn acct-btn-primary" disabled={busy || !supported} onClick={() => { void run(() => createPasskey(), "Passkey added. This device can now sign in on its own."); }}>Add a passkey on this device</button>
      <p className="stat-note">Passkeys kept by iCloud Keychain or Google Password Manager follow your account to your other devices.</p>
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
    link.download = `finscope-account-${new Date().toISOString().slice(0, 10)}.json`;
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
