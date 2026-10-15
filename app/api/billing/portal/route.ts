import { NextResponse } from "next/server";
import { currentAccount } from "@/lib/accounts";
import { portalUrl } from "@/lib/billing";

/** POST: Stripe's billing portal for the signed-in account — change plan, card, invoices, cancel. */
export async function POST(request: Request) {
  const account = await currentAccount(request);
  if (!account) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    return NextResponse.json({ url: await portalUrl(account.id, new URL(request.url).origin) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The billing portal could not be opened." }, { status: 502 });
  }
}
