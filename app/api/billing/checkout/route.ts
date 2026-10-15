import { NextResponse } from "next/server";
import { currentAccount } from "@/lib/accounts";
import { billingReady, checkoutUrl, type Plan } from "@/lib/billing";

/** POST { plan }: a Stripe Checkout page for the signed-in account. */
export async function POST(request: Request) {
  if (!billingReady()) return NextResponse.json({ error: "Billing is not set up yet." }, { status: 503 });
  const account = await currentAccount(request);
  if (!account) return NextResponse.json({ error: "Sign in to subscribe." }, { status: 401 });
  const body = await request.json().catch(() => null) as { plan?: string } | null;
  const plan: Plan | null = body?.plan === "monthly" || body?.plan === "annual" ? body.plan : null;
  if (!plan) return NextResponse.json({ error: "Choose monthly or annual." }, { status: 400 });
  try {
    const url = await checkoutUrl({ accountId: account.id, email: account.email?.address ?? account.identities?.find((identity) => identity.email)?.email ?? null, plan, origin: new URL(request.url).origin });
    return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Checkout could not be opened." }, { status: 502 });
  }
}
