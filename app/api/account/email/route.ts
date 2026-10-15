import { setEmail } from "@/lib/accounts";
import { accountAnswer, refuse, requireAccount, sameOrigin } from "@/lib/account-http";
import { emailConfigured, plainEmail, sendEmail } from "@/lib/email";

/** The address the daily alerts go to, verified by a link sent to it, or none. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  const account = await requireAccount(request);
  if (account instanceof Response) return account;
  const body = await request.json().catch(() => null) as { address?: unknown; alerts?: unknown } | null;
  if (!body) return refuse("Incomplete request.");
  const address = typeof body.address === "string" && body.address.trim() ? body.address : null;
  try {
    const { account: updated, verifyToken } = await setEmail(account, address, body.alerts !== false);
    if (verifyToken && emailConfigured()) {
      const link = `${new URL(request.url).origin}/api/account/email/verify?token=${verifyToken}`;
      await sendEmail(plainEmail(updated.email!.address, "Confirm your email for Tenqay alerts", "Confirm your email",
        ["Follow the link to receive a daily email of what changed for the companies you follow on Tenqay.", "If you did not ask for this, ignore this message: nothing will be sent."],
        { href: link, label: "Confirm this address" }));
    }
    return accountAnswer(updated);
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "The address could not be kept.");
  }
}
