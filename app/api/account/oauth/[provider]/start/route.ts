import { currentAccount, keepToken } from "@/lib/accounts";
import { authorizeUrl, isProvider, OAUTH_COOKIE, pkce, providerReady, randomToken, safeNext, type OAuthState } from "@/lib/oauth";

/** "Continue with Google / Microsoft": to the provider, with this sign-in's state, nonce and PKCE challenge. */
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const url = new URL(request.url);
  const { provider } = await context.params;
  const next = safeNext(url.searchParams.get("next"));
  if (!isProvider(provider) || !providerReady(provider)) return Response.redirect(`${url.origin}/t/account?signin=unavailable`, 302);
  const { verifier, challenge } = await pkce();
  const nonce = randomToken(24);
  const signedIn = await currentAccount(request).catch(() => null);
  const state = await keepToken<OAuthState>("oauth", { provider, verifier, nonce, next, link: !!signedIn }, 600);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl(provider, url.origin, state, challenge, nonce),
      // The state is this browser's: a sign-in started elsewhere cannot be finished here.
      // SameSite=None: Apple comes back by posting a form from its own site, which a Lax cookie would not follow.
      "Set-Cookie": `${OAUTH_COOKIE}=${state}; Path=/api/account/oauth; HttpOnly; SameSite=${secure ? "None" : "Lax"}; Max-Age=600${secure}`,
      "Cache-Control": "no-store",
    },
  });
}
