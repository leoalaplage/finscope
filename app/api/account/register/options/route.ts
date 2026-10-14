import { NextResponse } from "next/server";
import { currentAccount, registrationOptions } from "@/lib/accounts";
import { NO_STORE, refuse, sameOrigin } from "@/lib/account-http";

/** Step one of a passkey: a new account's, or another one for the account signed in. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  const body = await request.json().catch(() => ({})) as { name?: unknown };
  const signedIn = await currentAccount(request).catch(() => null);
  try {
    return NextResponse.json(await registrationOptions(request, signedIn, typeof body.name === "string" ? body.name : ""), { headers: NO_STORE });
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "Passkeys are not available just now.", 503);
  }
}
