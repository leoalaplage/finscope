import { NextResponse } from "next/server";
import { currentAccount, publicAccount, sessionCookie, type Account } from "./accounts";
import { emailConfigured } from "./email";
import { providerReady } from "./oauth";

/** Shared by the account routes: same-origin checks, answers that never cache. */
export const NO_STORE = { "Cache-Control": "no-store" };

/** A change asked for by this site's own pages, not by another site the reader has open. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin != null && origin === new URL(request.url).origin;
}

export const refuse = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: NO_STORE });

export function accountAnswer(account: Account | null, token?: string | null, request?: Request) {
  const response = NextResponse.json({
    account: account ? publicAccount(account) : null,
    emailService: emailConfigured(),
    // The ways in this site offers now: each provider once its secrets are set, the emailed link once email is.
    providers: { google: providerReady("google"), microsoft: providerReady("microsoft"), email: emailConfigured() },
  }, { headers: NO_STORE });
  if (token !== undefined && request) response.headers.append("Set-Cookie", sessionCookie(token, request));
  return response;
}

/** The account signed in, or an answer saying it is not. */
export async function requireAccount(request: Request): Promise<Account | Response> {
  const account = await currentAccount(request).catch(() => null);
  return account ?? refuse("Sign in first.", 401);
}
