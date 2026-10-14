import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { completeRegistration, currentAccount, startSession } from "@/lib/accounts";
import { accountAnswer, refuse, sameOrigin } from "@/lib/account-http";

/** Step two: the browser's new passkey, verified and kept; the reader is signed in. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  const body = await request.json().catch(() => null) as { challengeId?: unknown; response?: unknown; label?: unknown } | null;
  if (!body || typeof body.challengeId !== "string" || !body.response || typeof body.response !== "object") return refuse("Incomplete request.");
  try {
    const signedIn = await currentAccount(request).catch(() => null);
    const account = await completeRegistration(request, signedIn, body.challengeId, body.response as RegistrationResponseJSON, typeof body.label === "string" ? body.label : "");
    return accountAnswer(account, signedIn ? undefined : await startSession(account.id), request);
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "The passkey could not be kept.");
  }
}
