import { endSession } from "@/lib/accounts";
import { accountAnswer, refuse, sameOrigin } from "@/lib/account-http";

/** Signs this browser out. What it keeps locally stays. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  await endSession(request).catch(() => undefined);
  return accountAnswer(null, null, request);
}
