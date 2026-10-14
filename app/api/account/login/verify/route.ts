import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { completeAuthentication, startSession } from "@/lib/accounts";
import { accountAnswer, refuse, sameOrigin } from "@/lib/account-http";

/** Step two: the passkey's signature verified; the reader is signed in. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  const body = await request.json().catch(() => null) as { challengeId?: unknown; response?: unknown } | null;
  if (!body || typeof body.challengeId !== "string" || !body.response || typeof body.response !== "object") return refuse("Incomplete request.");
  try {
    const account = await completeAuthentication(request, body.challengeId, body.response as AuthenticationResponseJSON);
    return accountAnswer(account, await startSession(account.id), request);
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "Signing in failed.", 401);
  }
}
