import { NextResponse } from "next/server";
import { currentAccount } from "@/lib/accounts";
import { billingReady, entitled, readSubscription } from "@/lib/billing";
import { paywallOn } from "@/lib/paywall";

/** What the plans page and the account need to know: whether billing is set up, whether the paywall is on, and this account's subscription. */
export async function GET(request: Request) {
  const account = await currentAccount(request).catch(() => null);
  const subscription = account ? await readSubscription(account.id) : null;
  return NextResponse.json(
    { billing: billingReady(), paywall: paywallOn(), signedIn: Boolean(account), subscription, entitled: entitled(subscription) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
