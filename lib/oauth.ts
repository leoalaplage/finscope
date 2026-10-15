import { runtimeSecret, type SecretName } from "./runtime-env";

/**
 * "Continue with Google", "Continue with Microsoft": OpenID Connect, the
 * authorization-code flow with PKCE, a state bound to the browser by a
 * cookie, and a nonce carried into the ID token.
 *
 * The ID token is read from the provider's token endpoint, over TLS and with
 * this site's client secret, which is what OpenID Connect allows in place of
 * checking its signature; its issuer, audience, expiry and nonce are still
 * checked. A provider shows only once its two secrets are set (GOOGLE_… and
 * MICROSOFT_CLIENT_ID / _CLIENT_SECRET, by `wrangler secret put`).
 */

export type OAuthProvider = "google" | "microsoft";

interface ProviderSpec {
  label: string;
  authorize: string;
  token: string;
  scope: string;
  issuer: (iss: string) => boolean;
  id: SecretName;
  secret: SecretName;
}

export const PROVIDERS: Record<OAuthProvider, ProviderSpec> = {
  google: {
    label: "Google",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    issuer: (iss) => iss === "https://accounts.google.com" || iss === "accounts.google.com",
    id: "GOOGLE_CLIENT_ID",
    secret: "GOOGLE_CLIENT_SECRET",
  },
  microsoft: {
    label: "Microsoft",
    // "common": work, school and personal Microsoft accounts alike.
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "openid email profile",
    issuer: (iss) => /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/.test(iss),
    id: "MICROSOFT_CLIENT_ID",
    secret: "MICROSOFT_CLIENT_SECRET",
  },
};

export const isProvider = (value: string): value is OAuthProvider => value === "google" || value === "microsoft";
export const providerReady = (provider: OAuthProvider) => !!runtimeSecret(PROVIDERS[provider].id) && !!runtimeSecret(PROVIDERS[provider].secret);

export const OAUTH_COOKIE = "fs_oauth";
export const callbackUrl = (origin: string, provider: OAuthProvider) => `${origin}/api/account/oauth/${provider}/callback`;

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** The PKCE pair: a secret verifier kept here, its SHA-256 sent with the request. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = random(48);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: base64url(digest) };
}

export interface OAuthState { provider: OAuthProvider; verifier: string; nonce: string; next: string; link: boolean }

export function authorizeUrl(provider: OAuthProvider, origin: string, state: string, challenge: string, nonce: string): string {
  const spec = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: runtimeSecret(spec.id) ?? "",
    redirect_uri: callbackUrl(origin, provider),
    response_type: "code",
    scope: spec.scope,
    state, nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${spec.authorize}?${params}`;
}

/** Only a path on this site: never a redirect to somewhere else after signing in. */
export const safeNext = (next: string | null | undefined) => (next && /^\/(?!\/)[\w\-./?=&%#]*$/.test(next) ? next : "/t/account");

export interface Claims { sub: string; email: string | null; emailVerified: boolean; name: string | null }

/** Pure: the ID token's claims, once its issuer, audience, expiry and nonce are what this sign-in asked for. */
export function readIdToken(provider: OAuthProvider, idToken: string, clientId: string, nonce: string, now = Date.now()): Claims {
  const [, payload] = idToken.split(".");
  if (!payload) throw new Error("The provider returned no identity.");
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payload.length + 3) % 4)), (char) => char.charCodeAt(0)))) as Record<string, unknown>;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (typeof claims.iss !== "string" || !PROVIDERS[provider].issuer(claims.iss)) throw new Error("The identity was not issued by the provider.");
  if (!audience.includes(clientId)) throw new Error("The identity was issued for another site.");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now - 60_000) throw new Error("The identity has expired. Try again.");
  if (claims.nonce !== nonce) throw new Error("The sign-in did not match its request. Try again.");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("The provider returned no identity.");
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : typeof claims.preferred_username === "string" && claims.preferred_username.includes("@") ? claims.preferred_username.toLowerCase() : null;
  // Google says whether it checked the address. Microsoft does not: a work account's address is whatever its
  // organisation's administrator typed, so it is confirmed by an emailed link like one typed here.
  const emailVerified = provider === "google" && claims.email_verified === true;
  return { sub: claims.sub, email, emailVerified, name: typeof claims.name === "string" ? claims.name : null };
}

export async function exchangeCode(provider: OAuthProvider, origin: string, code: string, verifier: string, nonce: string): Promise<Claims> {
  const spec = PROVIDERS[provider];
  const clientId = runtimeSecret(spec.id) ?? "";
  const response = await fetch(spec.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: callbackUrl(origin, provider),
      client_id: clientId, client_secret: runtimeSecret(spec.secret) ?? "", code_verifier: verifier,
    }),
  });
  const body = await response.json().catch(() => ({})) as { id_token?: string; error_description?: string; error?: string };
  if (!response.ok || !body.id_token) throw new Error(body.error_description ?? body.error ?? `${spec.label} refused the sign-in.`);
  return readIdToken(provider, body.id_token, clientId, nonce);
}

export const randomToken = random;
