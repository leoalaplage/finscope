import { accountForIdentity, currentAccount, sessionCookie, startSession, takeToken } from "@/lib/accounts";
import { exchangeCode, isProvider, OAUTH_COOKIE, type OAuthState } from "@/lib/oauth";

/** Back from the provider: the code exchanged, the identity checked, the reader signed in (or the identity connected). */
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const url = new URL(request.url);
  const { provider } = await context.params;
  const secure = url.protocol === "https:" ? "; Secure" : "";
  const clear = `${OAUTH_COOKIE}=; Path=/api/account/oauth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  const fail = (reason: string) => new Response(null, { status: 302, headers: {
    Location: `${url.origin}/t/account?signin=error&reason=${encodeURIComponent(reason.slice(0, 160))}`, "Set-Cookie": clear, "Cache-Control": "no-store",
  } });
  if (!isProvider(provider)) return fail("Unknown sign-in provider.");
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error") === "access_denied" ? "Sign-in cancelled." : "The provider refused the sign-in.");
  const stateValue = url.searchParams.get("state") ?? "";
  const cookie = new RegExp(`(?:^|;\\s*)${OAUTH_COOKIE}=([A-Za-z0-9_-]+)`).exec(request.headers.get("cookie") ?? "")?.[1];
  if (!cookie || cookie !== stateValue) return fail("This sign-in was started in another browser or has expired. Try again.");
  const state = await takeToken<OAuthState>("oauth", stateValue);
  if (!state || state.provider !== provider) return fail("This sign-in has expired. Try again.");
  try {
    const claims = await exchangeCode(provider, url.origin, url.searchParams.get("code") ?? "", state.verifier, state.nonce);
    const signedIn = state.link ? await currentAccount(request).catch(() => null) : null;
    const account = await accountForIdentity({ provider, subject: claims.sub, email: claims.email, emailVerified: claims.emailVerified, name: claims.name }, signedIn);
    const headers = new Headers({ Location: `${url.origin}${state.next}${state.next.includes("?") ? "&" : "?"}signin=${signedIn ? "linked" : "ok"}`, "Cache-Control": "no-store" });
    headers.append("Set-Cookie", clear);
    if (!signedIn) headers.append("Set-Cookie", sessionCookie(await startSession(account.id), request));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The sign-in failed.");
  }
}
