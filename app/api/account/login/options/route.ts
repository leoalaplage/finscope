import { NextResponse } from "next/server";
import { authenticationOptions } from "@/lib/accounts";
import { NO_STORE, refuse, sameOrigin } from "@/lib/account-http";

/** Step one of signing in: a challenge for whichever passkey the browser offers. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  try {
    return NextResponse.json(await authenticationOptions(request), { headers: NO_STORE });
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "Passkeys are not available just now.", 503);
  }
}
