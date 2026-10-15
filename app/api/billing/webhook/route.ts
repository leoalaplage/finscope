import { NextResponse } from "next/server";
import { applyStripeEvent, verifyStripeSignature } from "@/lib/billing";
import { runtimeSecret } from "@/lib/runtime-env";

/**
 * Stripe's webhook: subscriptions created, changed, renewed, cancelled. Only
 * an event signed with the endpoint's secret, over the exact body sent, is
 * applied (lib/billing.ts).
 */
export async function POST(request: Request) {
  const secret = runtimeSecret("STRIPE_WEBHOOK_SECRET");
  if (!secret) return NextResponse.json({ error: "Billing is not set up yet." }, { status: 503 });
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret))) {
    return NextResponse.json({ error: "Signature does not match." }, { status: 400 });
  }
  try {
    const outcome = await applyStripeEvent(JSON.parse(payload));
    console.log(`[billing] ${outcome}`);
    return NextResponse.json({ received: true });
  } catch (error) {
    // A 500 makes Stripe send the event again later.
    return NextResponse.json({ error: error instanceof Error ? error.message : "Not applied." }, { status: 500 });
  }
}
