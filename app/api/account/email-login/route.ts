import { NextResponse } from "next/server";
import { EMAIL_PATTERN, emailLinkAllowed, keepToken } from "@/lib/accounts";
import { NO_STORE, refuse, sameOrigin } from "@/lib/account-http";
import { emailConfigured, plainEmail, sendEmail } from "@/lib/email";
import { safeNext } from "@/lib/oauth";

/**
 * "Continue with email": a sign-in link, good for fifteen minutes and once,
 * sent to the address. The answer is the same whether or not the address has
 * an account, so it tells no one who uses Tenqay.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  if (!emailConfigured()) return refuse("Signing in by email is not available yet.", 503);
  const body = await request.json().catch(() => null) as { address?: unknown; next?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(address) || address.length > 120) return refuse("That is not an email address.");
  if (await emailLinkAllowed(address)) {
    const token = await keepToken("email-login", { address, next: safeNext(typeof body?.next === "string" ? body.next : null) }, 15 * 60);
    const link = `${new URL(request.url).origin}/api/account/email-login/verify?token=${token}`;
    const sent = await sendEmail(plainEmail(address, "Your Tenqay sign-in link", "Sign in to Tenqay",
      ["Follow the link to sign in. It works once, for fifteen minutes.", "If you did not ask for it, ignore this email: nothing happens without the link."],
      { href: link, label: "Sign in to Tenqay" }));
    if (!sent.sent) return refuse("The email could not be sent just now. Try again in a minute.", 502);
  }
  return NextResponse.json({ sent: true }, { headers: NO_STORE });
}
