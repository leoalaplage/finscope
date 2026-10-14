"use client";

import { useEffect, useSyncExternalStore } from "react";
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import type { PublicAccount } from "@/lib/accounts";

/**
 * The account signed in on this browser, as one store every component reads
 * (the top bar's chip, the ACCT page, the sync): asked of the server once a
 * page, and again after anything that changes it.
 */

export interface AccountState { loaded: boolean; account: PublicAccount | null; emailService: boolean }

const EVENT = "finscope:account";
let state: AccountState = { loaded: false, account: null, emailService: false };
let asking: Promise<void> | null = null;
const SERVER_STATE: AccountState = { loaded: false, account: null, emailService: false };

function set(next: AccountState) {
  state = next;
  window.dispatchEvent(new Event(EVENT));
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
  return body;
}

const take = (body: { account: PublicAccount | null; emailService: boolean }) => set({ loaded: true, account: body.account, emailService: body.emailService });

export function refreshAccount(): Promise<void> {
  asking ??= json<{ account: PublicAccount | null; emailService: boolean }>("/api/account")
    .then(take)
    .catch(() => set({ ...state, loaded: true }))
    .finally(() => { asking = null; });
  return asking;
}

export function useAccount(): AccountState {
  const current = useSyncExternalStore(
    (notify) => { window.addEventListener(EVENT, notify); return () => window.removeEventListener(EVENT, notify); },
    () => state,
    () => SERVER_STATE,
  );
  useEffect(() => { if (!state.loaded) void refreshAccount(); }, []);
  return current;
}

export const passkeysSupported = () => typeof window !== "undefined" && browserSupportsWebAuthn();

/** What the browser is, to name the passkey it is about to make. */
function deviceLabel(): string {
  const agent = navigator.userAgent;
  const device = /iPhone/.test(agent) ? "iPhone" : /iPad/.test(agent) ? "iPad" : /Android/.test(agent) ? "Android" : /Mac/.test(agent) ? "Mac" : /Windows/.test(agent) ? "Windows" : /Linux/.test(agent) ? "Linux" : "Device";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "browser";
  return `${browser} on ${device}`;
}

/** A new account, or a new passkey for the account signed in. */
export async function createPasskey(name = ""): Promise<void> {
  const { options, challengeId } = await json<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"]; challengeId: string }>("/api/account/register/options", { method: "POST", body: JSON.stringify({ name }) });
  const response = await startRegistration({ optionsJSON: options });
  take(await json("/api/account/register/verify", { method: "POST", body: JSON.stringify({ challengeId, response, label: deviceLabel() }) }));
}

export async function signIn(): Promise<void> {
  const { options, challengeId } = await json<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"]; challengeId: string }>("/api/account/login/options", { method: "POST", body: "{}" });
  const response = await startAuthentication({ optionsJSON: options });
  take(await json("/api/account/login/verify", { method: "POST", body: JSON.stringify({ challengeId, response }) }));
}

export async function signOut(): Promise<void> {
  take(await json("/api/account/logout", { method: "POST", body: "{}" }));
}

export async function removePasskey(id: string): Promise<void> {
  take(await json(`/api/account/passkey?id=${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function saveEmail(address: string | null, alerts: boolean): Promise<void> {
  take(await json("/api/account/email", { method: "POST", body: JSON.stringify({ address, alerts }) }));
}

export async function deleteAccount(): Promise<void> {
  take(await json("/api/account", { method: "DELETE" }));
}

/** A browser's refusal ("The operation either timed out or was not allowed") in words a reader acts on. */
export function passkeyError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return "Cancelled, or no passkey for this site on this device.";
  if (name === "InvalidStateError") return "This device already holds a passkey for this account.";
  return error instanceof Error ? error.message : "Something went wrong.";
}
