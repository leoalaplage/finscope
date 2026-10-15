import { readSubscription, entitled } from "./billing";
import { datasetCache, runtimeSecret } from "./runtime-env";

/**
 * Who may use the terminal: subscribers, once the paywall is on.
 *
 * Every page and every API call reaches the Worker (no page is a static
 * file), so the rule is applied there, before anything is served
 * (worker/index.ts): a page asked for without a subscription leads to the
 * plans, an API call is refused with 402 — a link straight to a company page
 * or a script calling /api is turned away the same. The tour, the account and
 * billing stay open, so a visitor can see, sign in and subscribe.
 *
 * Off until the owner sets PAYWALL=on; while Tenqay is in beta nothing is
 * closed. The Worker's calls to itself (the scheduled warm-ups, through the
 * SELF binding) carry a token derived from a secret no browser ever sees.
 */

export type Gate = "page" | "api" | null;

/** Paths anyone may reach: the tour and its pictures, the account, billing, and the files every page needs. */
const OPEN = [
  /^\/t\/welcome(?:\/|$)/,
  /^\/t\/account(?:\/|$)/,
  /^\/api\/account(?:\/|$)/,
  /^\/api\/billing(?:\/|$)/,
];

/** Pure: whether a path is closed to non-subscribers, and how it is turned away. */
export function gateFor(pathname: string): Gate {
  if (OPEN.some((pattern) => pattern.test(pathname))) return null;
  if (pathname === "/t" || pathname.startsWith("/t/")) return "page";
  if (pathname.startsWith("/api/")) return "api";
  return null;
}

export function paywallOn(): boolean {
  return runtimeSecret("PAYWALL") === "on";
}

export const INTERNAL_HEADER = "X-FinScope-Internal";
let internal: Promise<string | null> | null = null;

/** The token the Worker's calls to itself carry: a hash of a secret, never the secret, and nothing a browser can know. */
export function internalToken(): Promise<string | null> {
  internal ??= (async () => {
    const seed = runtimeSecret("INTERNAL_TOKEN") ?? runtimeSecret("STRIPE_WEBHOOK_SECRET") ?? runtimeSecret("GOOGLE_CLIENT_SECRET") ?? runtimeSecret("RESEND_API_KEY");
    if (!seed) return null;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`tenqay-internal:${seed}`));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  })();
  return internal;
}

const SESSION = /(?:^|;\s*)fs_session=([A-Za-z0-9_-]{20,})/;
/** A minute of memory per session token: the pages of one screen ask a dozen times in a second. */
const remembered = new Map<string, { allowed: boolean; at: number }>();

export type Verdict = { allowed: true } | { allowed: false; signedIn: boolean };

/** Whether this request may pass the paywall. */
export async function admit(request: Request): Promise<Verdict> {
  const token = await internalToken();
  if (token && request.headers.get(INTERNAL_HEADER) === token) return { allowed: true };
  const session = SESSION.exec(request.headers.get("cookie") ?? "")?.[1];
  if (!session) return { allowed: false, signedIn: false };
  const held = remembered.get(session);
  if (held && Date.now() - held.at < 60_000) return held.allowed ? { allowed: true } : { allowed: false, signedIn: true };
  const record = await datasetCache()?.get<{ accountId: string }>(`account-session:v1:${session}`, "json").catch(() => null);
  if (!record) return { allowed: false, signedIn: false };
  const allowed = entitled(await readSubscription(record.accountId));
  remembered.set(session, { allowed, at: Date.now() });
  if (remembered.size > 5000) remembered.clear();
  return allowed ? { allowed: true } : { allowed: false, signedIn: true };
}
