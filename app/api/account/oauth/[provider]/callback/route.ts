import { accountForIdentity, currentAccount, sessionCookie, startSession, takeToken } from "@/lib/accounts";
import { appleName, exchangeCode, isProvider, OAUTH_COOKIE, type OAuthState } from "@/lib/oauth";

/** Back from the provider: the code exchanged, the identity checked, the reader signed in (or the identity connected). */
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  return finish(request, new URL(request.url).searchParams, (await context.params).provider);
}

/** Apple answers by posting a form (response_mode=form_post), with the name on the first sign-in only. */
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const form = await request.formData().catch(() => null);
  const params = new URLSearchParams();
  for (const key of ["code", "state", "error", "user"]) {
    const value = form?.get(key);
    if (typeof value === "string") params.set(key, value);
  }
  return finish(request, params, (await context.params).provider);
}

async function finish(request: Request, query: URLSearchParams, provider: string) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  const clear = `${OAUTH_COOKIE}=; Path=/api/account/oauth; HttpOnly; SameSite=${secure ? "None" : "Lax"}; Max-Age=0${secure}`;
  const fail = (reason: string) => new Response(null, { status: 303, headers: {
    Location: `${url.origin}/t/account?signin=error&reason=${encodeURIComponent(reason.slice(0, 160))}`, "Set-Cookie": clear, "Cache-Control": "no-store",
  } });
  if (!isProvider(provider)) return fail("Unknown sign-in provider.");
  // A form posted back by Apple is answered with 303, so the browser follows it with a GET.
  if (query.get("error")) return fail(query.get("error") === "access_denied" || query.get("error") === "user_cancelled_authorize" ? "Sign-in cancelled." : "The provider refused the sign-in.");
  const stateValue = query.get("state") ?? "";
  const cookie = new RegExp(`(?:^|;\\s*)${OAUTH_COOKIE}=([A-Za-z0-9_-]+)`).exec(request.headers.get("cookie") ?? "")?.[1];
  if (!cookie || cookie !== stateValue) return fail("This sign-in was started in another browser or has expired. Try again.");
  const state = await takeToken<OAuthState>("oauth", stateValue);
  if (!state || state.provider !== provider) return fail("This sign-in has expired. Try again.");
  try {
    const claims = await exchangeCode(provider, url.origin, query.get("code") ?? "", state.verifier, state.nonce);
    const signedIn = state.link ? await currentAccount(request).catch(() => null) : null;
    const name = claims.name ?? (provider === "apple" ? appleName(query.get("user")) : null);
    const account = await accountForIdentity({ provider, subject: claims.sub, email: claims.email, emailVerified: claims.emailVerified, name }, signedIn);
    const headers = new Headers({ Location: `${url.origin}${state.next}${state.next.includes("?") ? "&" : "?"}signin=${signedIn ? "linked" : "ok"}`, "Cache-Control": "no-store" });
    headers.append("Set-Cookie", clear);
    if (!signedIn) headers.append("Set-Cookie", sessionCookie(await startSession(account.id), request));
    return new Response(null, { status: 303, headers });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The sign-in failed.");
  }
}
