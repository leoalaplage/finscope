"use client";

import { useEffect } from "react";
import { SYNCED_KEYS, type SyncedData, type SyncedKey } from "@/lib/account-sync";
import { useAccount } from "./account";

/**
 * Keeps this browser's work and the account's copy the same, while signed in.
 *
 * Each synced key carries the time it last changed here, kept beside it in
 * `finscope.sync.stamps.v1`. On arrival the account's copy is read: a key the
 * account changed later replaces this browser's, a key changed here later is
 * sent. Then every few seconds the keys are compared with what was last seen,
 * and a change is sent two seconds after the last edit. The newer copy wins,
 * key by key (lib/account-sync.ts). A browser never signed in keeps
 * everything to itself, as before.
 */

const STAMPS_KEY = "finscope.sync.stamps.v1";
export const SYNC_EVENT = "finscope:sync";
export interface SyncStatus { state: "idle" | "syncing" | "synced" | "failed"; at: string | null; error?: string }
let status: SyncStatus = { state: "idle", at: null };
export const syncStatus = () => status;
const announce = (next: SyncStatus) => { status = next; window.dispatchEvent(new Event(SYNC_EVENT)); };

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const readStamps = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(STAMPS_KEY) ?? "{}") as Record<string, string>; } catch { return {}; } };
const writeStamps = (stamps: Record<string, string>) => { try { localStorage.setItem(STAMPS_KEY, JSON.stringify(stamps)); } catch { /* Kept for this visit only. */ } };

/** Writes the account's copy here and tells every store on the page, as another tab's edit would. */
function apply(key: SyncedKey, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  } catch { /* A browser that keeps nothing. */ }
}

async function exchange(method: "GET" | "PUT", items?: SyncedData): Promise<SyncedData> {
  const response = await fetch("/api/account/data", {
    method, credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: method === "PUT" ? JSON.stringify({ items }) : undefined,
  });
  const body = await response.json().catch(() => ({})) as { items?: SyncedData; error?: string };
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
  return body.items ?? {};
}

export function AccountSync() {
  const { account } = useAccount();
  const signedIn = account?.id ?? null;

  useEffect(() => {
    if (!signedIn) return;
    let stopped = false;
    const seen = new Map<SyncedKey, string | null>();
    let pending = new Set<SyncedKey>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const push = async () => {
      timer = null;
      if (!pending.size || stopped) return;
      const keys = [...pending];
      pending = new Set();
      const stamps = readStamps();
      const items: SyncedData = Object.fromEntries(keys.map((key) => [key, { value: read(key), at: stamps[key] ?? new Date().toISOString() }]));
      announce({ state: "syncing", at: status.at });
      try {
        await exchange("PUT", items);
        announce({ state: "synced", at: new Date().toISOString() });
      } catch (error) {
        for (const key of keys) pending.add(key);
        announce({ state: "failed", at: status.at, error: error instanceof Error ? error.message : "Sync failed." });
      }
    };
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void push(); }, 2000); };

    const pull = async () => {
      announce({ state: "syncing", at: status.at });
      try {
        const remote = await exchange("GET");
        if (stopped) return;
        const stamps = readStamps();
        for (const key of SYNCED_KEYS) {
          const item = remote[key];
          const local = read(key);
          // A key this browser holds but never stamped predates the account: the account's copy, where it has one, wins.
          const localAt = stamps[key] ?? (local != null ? "1970-01-01T00:00:00.000Z" : null);
          if (item && (!localAt || item.at > localAt)) {
            if (item.value !== local) apply(key, item.value);
            stamps[key] = item.at;
          } else if (local != null && (!item || (localAt && localAt > item.at))) {
            if (!stamps[key]) stamps[key] = new Date().toISOString();
            pending.add(key);
          }
          seen.set(key, read(key));
        }
        writeStamps(stamps);
        announce({ state: "synced", at: new Date().toISOString() });
        if (pending.size) void push();
      } catch (error) {
        announce({ state: "failed", at: status.at, error: error instanceof Error ? error.message : "Sync failed." });
      }
    };

    // An edit here: stamped now, sent shortly.
    const watch = () => {
      if (stopped || !seen.size) return;
      const stamps = readStamps();
      let changed = false;
      for (const key of SYNCED_KEYS) {
        const value = read(key);
        if (value === seen.get(key)) continue;
        seen.set(key, value);
        stamps[key] = new Date().toISOString();
        pending.add(key);
        changed = true;
      }
      if (changed) { writeStamps(stamps); schedule(); }
    };

    void pull();
    const poll = setInterval(watch, 3000);
    // Another device's edits: read again when the reader comes back to this tab, and every few minutes.
    const again = setInterval(() => { void pull(); }, 5 * 60_000);
    const onFocus = () => { if (document.visibilityState === "visible") void pull(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stopped = true;
      clearInterval(poll); clearInterval(again);
      document.removeEventListener("visibilitychange", onFocus);
      if (timer) { clearTimeout(timer); void push(); }
    };
  }, [signedIn]);

  return null;
}
