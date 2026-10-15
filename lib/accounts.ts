import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { datasetCache } from "./runtime-env";

/**
 * Accounts, signed in with a passkey — the phone's or the computer's own
 * lock (Face ID, Touch ID, Windows Hello) or a security key. No password is
 * kept, so none can leak; no third party signs anyone in; the browser holds
 * the private key and this server only its public half.
 *
 * An account keeps what the browser kept until now — watchlists, portfolio,
 * notes, saved screens, the terminal's workspace — so that it follows its
 * owner from one device to the next (lib/account-sync.ts), and an address the
 * daily alert email goes to (lib/email-alerts.ts).
 *
 * Everything sits in the Worker's KV store, under the keys below.
 */

export interface StoredCredential {
  id: string;
  /** The public key, base64url. */
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  created: string;
  /** "iPhone", "Chrome on Mac": what the reader called it, or the browser it was made in. */
  label: string;
  /** The last time it signed in. */
  lastUsed?: string;
}

export interface AccountEmail { address: string; verified: boolean; alerts: boolean; lastSent: string | null }

/** Another way in: an account at Google or Microsoft, or an email address that receives a sign-in link. */
export type IdentityProvider = "google" | "microsoft" | "apple" | "email";
export interface Identity { provider: IdentityProvider; subject: string; email: string | null; added: string; lastUsed?: string }

export interface Account {
  id: string;
  name: string;
  created: string;
  credentials: StoredCredential[];
  /** Sign-in through Google, Microsoft or an emailed link; older accounts have none. */
  identities?: Identity[];
  email: AccountEmail | null;
}

/** What the browser is shown of an account: never the keys. */
export interface PublicAccount {
  id: string;
  name: string;
  created: string;
  passkeys: Array<{ id: string; label: string; created: string; lastUsed: string | null }>;
  identities: Array<{ provider: IdentityProvider; subject: string; email: string | null; added: string; lastUsed: string | null }>;
  email: AccountEmail | null;
}

export const SESSION_COOKIE = "fs_session";
const SESSION_DAYS = 60;
const RP_NAME = "Tenqay";

const accountKey = (id: string) => `account:v1:${id}`;
const credentialKey = (id: string) => `account-credential:v1:${id}`;
const sessionKey = (token: string) => `account-session:v1:${token}`;
const challengeKey = (id: string) => `account-challenge:v1:${id}`;
export const dataKey = (id: string) => `account-data:v1:${id}`;
const identityKey = (provider: IdentityProvider, subject: string) => `account-identity:v1:${provider}:${subject}`;
export const SUBSCRIBERS_KEY = "account-alert-subscribers:v1";

function store(): KVNamespace {
  const cache = datasetCache();
  if (!cache) throw new Error("Accounts need the site's store, which this environment does not have.");
  return cache;
}

const randomId = (bytes = 18) => {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...values)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)), (char) => char.charCodeAt(0));

export const publicAccount = (account: Account): PublicAccount => ({
  id: account.id, name: account.name, created: account.created, email: account.email,
  passkeys: account.credentials.map((credential) => ({ id: credential.id, label: credential.label, created: credential.created, lastUsed: credential.lastUsed ?? null })),
  identities: (account.identities ?? []).map((identity) => ({ ...identity, lastUsed: identity.lastUsed ?? null })),
});

export async function readAccount(id: string): Promise<Account | null> {
  return store().get<Account>(accountKey(id), "json").catch(() => null);
}

export async function writeAccount(account: Account): Promise<void> {
  await store().put(accountKey(account.id), JSON.stringify(account));
  // The daily email reads a list of who wants it rather than every account.
  const subscribers = new Set(await store().get<string[]>(SUBSCRIBERS_KEY, "json").catch(() => null) ?? []);
  const wants = !!account.email?.verified && account.email.alerts;
  if (wants !== subscribers.has(account.id)) {
    if (wants) subscribers.add(account.id); else subscribers.delete(account.id);
    await store().put(SUBSCRIBERS_KEY, JSON.stringify([...subscribers]));
  }
}

/** The relying party is the site the browser is on: the passkey is bound to that name. */
export function relyingParty(request: Request): { id: string; origin: string } {
  const url = new URL(request.url);
  return { id: url.hostname, origin: url.origin };
}

/* --- Sessions ------------------------------------------------------------ */

export function sessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([A-Za-z0-9_-]{20,})`).exec(cookie);
  return match?.[1] ?? null;
}

export async function currentAccount(request: Request): Promise<Account | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const session = await store().get<{ accountId: string }>(sessionKey(token), "json").catch(() => null);
  return session ? readAccount(session.accountId) : null;
}

export async function startSession(accountId: string): Promise<string> {
  const token = randomId(32);
  await store().put(sessionKey(token), JSON.stringify({ accountId, created: new Date().toISOString() }), { expirationTtl: SESSION_DAYS * 86_400 });
  return token;
}

export async function endSession(request: Request): Promise<void> {
  const token = sessionToken(request);
  if (token) await store().delete(sessionKey(token));
}

export function sessionCookie(token: string | null, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return token
    ? `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure}`
    : `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/* --- Passkeys ------------------------------------------------------------ */

interface Challenge { challenge: string; kind: "register" | "login"; accountId?: string; name?: string }

async function keepChallenge(challenge: Challenge): Promise<string> {
  const id = randomId();
  await store().put(challengeKey(id), JSON.stringify(challenge), { expirationTtl: 300 });
  return id;
}

/** A challenge is used once: read and forgotten. */
async function takeChallenge(id: string, kind: Challenge["kind"]): Promise<Challenge | null> {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return null;
  const challenge = await store().get<Challenge>(challengeKey(id), "json").catch(() => null);
  if (challenge) await store().delete(challengeKey(id));
  return challenge?.kind === kind ? challenge : null;
}

/** A new account's first passkey, or another passkey for the account signed in. */
export async function registrationOptions(request: Request, signedIn: Account | null, name: string) {
  const rp = relyingParty(request);
  const accountId = signedIn?.id ?? randomId(16);
  const chosen = name.trim().replace(/\s+/g, " ");
  const accountName = signedIn?.name ?? (NAME_PATTERN.test(chosen) ? chosen : "Tenqay reader");
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    userName: accountName,
    userID: new TextEncoder().encode(accountId),
    attestationType: "none",
    excludeCredentials: (signedIn?.credentials ?? []).map((credential) => ({ id: credential.id, transports: credential.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const challengeId = await keepChallenge({ challenge: options.challenge, kind: "register", accountId, name: accountName });
  return { options, challengeId };
}

export async function completeRegistration(request: Request, signedIn: Account | null, challengeId: string, response: RegistrationResponseJSON, label: string): Promise<Account> {
  const challenge = await takeChallenge(challengeId, "register");
  if (!challenge?.accountId) throw new Error("The request expired. Try again.");
  if (signedIn && signedIn.id !== challenge.accountId) throw new Error("This passkey was started for another account.");
  const rp = relyingParty(request);
  const verification = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: rp.origin, expectedRPID: rp.id, requireUserVerification: false });
  if (!verification.verified || !verification.registrationInfo) throw new Error("The passkey could not be verified.");
  const { credential } = verification.registrationInfo;
  if (await store().get(credentialKey(credential.id))) throw new Error("This passkey is already registered.");
  const now = new Date().toISOString();
  const account: Account = signedIn ?? (await readAccount(challenge.accountId)) ?? { id: challenge.accountId, name: challenge.name ?? "Tenqay reader", created: now, credentials: [], email: null };
  account.credentials.push({ id: credential.id, publicKey: toBase64Url(credential.publicKey), counter: credential.counter, transports: credential.transports, created: now, label: label.slice(0, 60) || "Passkey" });
  await store().put(credentialKey(credential.id), account.id);
  await writeAccount(account);
  return account;
}

export async function authenticationOptions(request: Request) {
  const rp = relyingParty(request);
  // No list of credentials: the browser offers the passkeys it holds for this site.
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: "preferred" });
  const challengeId = await keepChallenge({ challenge: options.challenge, kind: "login" });
  return { options, challengeId };
}

export async function completeAuthentication(request: Request, challengeId: string, response: AuthenticationResponseJSON): Promise<Account> {
  const challenge = await takeChallenge(challengeId, "login");
  if (!challenge) throw new Error("The request expired. Try again.");
  const accountId = await store().get(credentialKey(response.id));
  const account = accountId ? await readAccount(accountId) : null;
  const credential = account?.credentials.find((entry) => entry.id === response.id);
  if (!account || !credential) throw new Error("This passkey belongs to no Tenqay account. It may have been removed.");
  const rp = relyingParty(request);
  const verification = await verifyAuthenticationResponse({
    response, expectedChallenge: challenge.challenge, expectedOrigin: rp.origin, expectedRPID: rp.id, requireUserVerification: false,
    credential: { id: credential.id, publicKey: fromBase64Url(credential.publicKey), counter: credential.counter, transports: credential.transports },
  });
  if (!verification.verified) throw new Error("The passkey could not be verified.");
  credential.counter = verification.authenticationInfo.newCounter;
  credential.lastUsed = new Date().toISOString();
  await writeAccount(account);
  return account;
}

/** A display name: one to forty characters, letters, digits, spaces and a little punctuation. */
export const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{0,39}$/u;

export async function renameAccount(account: Account, name: string): Promise<Account> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!NAME_PATTERN.test(trimmed)) throw new Error("A name is 1 to 40 letters, digits, spaces, dots, dashes or apostrophes.");
  account.name = trimmed;
  await writeAccount(account);
  return account;
}

export async function renamePasskey(account: Account, credentialId: string, label: string): Promise<Account> {
  const credential = account.credentials.find((entry) => entry.id === credentialId);
  if (!credential) throw new Error("No such passkey on this account.");
  const trimmed = label.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!trimmed) throw new Error("Give the passkey a name.");
  credential.label = trimmed;
  await writeAccount(account);
  return account;
}

/** Every way in an account has: its passkeys and its identities. One must remain. */
export const signInMethods = (account: Account) => account.credentials.length + (account.identities?.length ?? 0);

export async function removePasskey(account: Account, credentialId: string): Promise<Account> {
  if (signInMethods(account) <= 1) throw new Error("An account keeps at least one way to sign in: add another first, or delete the account.");
  account.credentials = account.credentials.filter((credential) => credential.id !== credentialId);
  await store().delete(credentialKey(credentialId));
  await writeAccount(account);
  return account;
}

/** Everything the account holds, gone: passkeys, data, its place on the email list. */
export async function deleteAccount(account: Account, request: Request): Promise<void> {
  await Promise.all(account.credentials.map((credential) => store().delete(credentialKey(credential.id))));
  await Promise.all((account.identities ?? []).map((identity) => store().delete(identityKey(identity.provider, identity.subject))));
  await store().delete(dataKey(account.id));
  await writeAccount({ ...account, email: null });
  await store().delete(accountKey(account.id));
  await endSession(request);
}

/* --- Email address ------------------------------------------------------- */

const verifyKey = (token: string) => `account-email-verify:v1:${token}`;
export const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** A new address is unverified until its owner follows the link sent to it. */
export async function setEmail(account: Account, address: string | null, alerts: boolean): Promise<{ account: Account; verifyToken: string | null }> {
  if (address == null) {
    account.email = null;
    await writeAccount(account);
    return { account, verifyToken: null };
  }
  const normalised = address.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalised) || normalised.length > 120) throw new Error("That is not an email address.");
  const same = account.email?.address === normalised;
  account.email = { address: normalised, verified: same ? account.email!.verified : false, alerts, lastSent: same ? account.email!.lastSent : null };
  await writeAccount(account);
  if (account.email.verified) return { account, verifyToken: null };
  const token = randomId(24);
  await store().put(verifyKey(token), JSON.stringify({ accountId: account.id, address: normalised }), { expirationTtl: 3 * 86_400 });
  return { account, verifyToken: token };
}

export async function verifyEmail(token: string): Promise<Account | null> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const pending = await store().get<{ accountId: string; address: string }>(verifyKey(token), "json").catch(() => null);
  if (!pending) return null;
  const account = await readAccount(pending.accountId);
  if (!account?.email || account.email.address !== pending.address) return null;
  account.email.verified = true;
  await writeAccount(account);
  await store().delete(verifyKey(token));
  return account;
}

/* --- Identities: Google, Microsoft, an emailed link ------------------------- */

/**
 * The account an identity signs in to, made on its first use. Signed in
 * already, the identity is added to that account instead — "connect Google".
 * Never matched to another account by its email address alone: an address
 * proves nothing about who holds an account here.
 */
export async function accountForIdentity(found: { provider: IdentityProvider; subject: string; email: string | null; emailVerified: boolean; name: string | null }, signedIn: Account | null): Promise<Account> {
  const now = new Date().toISOString();
  const linked = await store().get(identityKey(found.provider, found.subject));
  if (linked) {
    const account = await readAccount(linked);
    if (account) {
      if (signedIn && signedIn.id !== account.id) throw new Error("This sign-in already belongs to another Tenqay account.");
      const identity = account.identities?.find((entry) => entry.provider === found.provider && entry.subject === found.subject);
      if (identity) identity.lastUsed = now;
      await writeAccount(account);
      return account;
    }
  }
  const identity: Identity = { provider: found.provider, subject: found.subject, email: found.email, added: now, lastUsed: now };
  const chosen = (found.name ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  const account: Account = signedIn ?? {
    id: randomId(16), created: now, credentials: [],
    name: NAME_PATTERN.test(chosen) ? chosen : (found.email?.split("@")[0]?.slice(0, 40) || "Tenqay reader"),
    // A provider's verified address is the account's, confirmed; the daily email stays off until asked for.
    email: found.email && found.emailVerified ? { address: found.email.toLowerCase(), verified: true, alerts: false, lastSent: null } : null,
  };
  if (!NAME_PATTERN.test(account.name)) account.name = "Tenqay reader";
  account.identities = [...(account.identities ?? []).filter((entry) => !(entry.provider === found.provider && entry.subject === found.subject)), identity];
  if (!account.email && found.email && found.emailVerified) account.email = { address: found.email.toLowerCase(), verified: true, alerts: false, lastSent: null };
  await store().put(identityKey(found.provider, found.subject), account.id);
  await writeAccount(account);
  return account;
}

export async function removeIdentity(account: Account, provider: IdentityProvider, subject: string): Promise<Account> {
  if (signInMethods(account) <= 1) throw new Error("An account keeps at least one way to sign in: add another first, or delete the account.");
  account.identities = (account.identities ?? []).filter((entry) => !(entry.provider === provider && entry.subject === subject));
  await store().delete(identityKey(provider, subject));
  await writeAccount(account);
  return account;
}

/* --- Short-lived tokens: an OAuth round trip, an emailed sign-in link ------- */

export async function keepToken<T>(kind: string, value: T, seconds: number): Promise<string> {
  const token = randomId(24);
  await store().put(`account-token:v1:${kind}:${token}`, JSON.stringify(value), { expirationTtl: Math.max(60, seconds) });
  return token;
}

/** Used once: read and forgotten. */
export async function takeToken<T>(kind: string, token: string): Promise<T | null> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const key = `account-token:v1:${kind}:${token}`;
  const value = await store().get<T>(key, "json").catch(() => null);
  if (value) await store().delete(key);
  return value;
}

/** At most one emailed link a minute to an address: the button cannot be made to spam someone. */
export async function emailLinkAllowed(address: string): Promise<boolean> {
  const key = `account-email-throttle:v1:${address}`;
  if (await store().get(key)) return false;
  await store().put(key, "1", { expirationTtl: 60 });
  return true;
}
