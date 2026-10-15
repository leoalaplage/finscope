import { accountForIdentity, currentAccount, sessionCookie, startSession, takeToken } from "@/lib/accounts";

/** The link in the sign-in email: the address is proven, the reader is signed in (or the address connected to their account). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const pending = await takeToken<{ address: string; next: string }>("email-login", url.searchParams.get("token") ?? "");
  if (!pending) return Response.redirect(`${url.origin}/t/account?signin=error&reason=${encodeURIComponent("That sign-in link has expired or was already used. Ask for a new one.")}`, 302);
  const signedIn = await currentAccount(request).catch(() => null);
  try {
    const account = await accountForIdentity({ provider: "email", subject: pending.address, email: pending.address, emailVerified: true, name: null }, signedIn);
    const headers = new Headers({ Location: `${url.origin}${pending.next}${pending.next.includes("?") ? "&" : "?"}signin=${signedIn ? "linked" : "ok"}`, "Cache-Control": "no-store" });
    if (!signedIn) headers.append("Set-Cookie", sessionCookie(await startSession(account.id), request));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return Response.redirect(`${url.origin}/t/account?signin=error&reason=${encodeURIComponent(error instanceof Error ? error.message : "The sign-in failed.")}`, 302);
  }
}
