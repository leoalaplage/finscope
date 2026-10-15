import { datasetCache, runtimeSecret } from "./runtime-env";

/**
 * Subscriptions: Stripe Checkout to subscribe, Stripe's customer portal to
 * change or cancel, a signed webhook to learn what happened — and the state
 * of each account's subscription kept in KV beside the account.
 *
 * Nothing here runs until the site's owner sets the Stripe secrets
 * (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY,
 * STRIPE_PRICE_ANNUAL); the access rule that reads it is lib/paywall.ts.
 * Stripe is called over its REST API with fetch — no SDK in the Worker.
 */

export type Plan = "monthly" | "annual";
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "unpaid" | "canceled" | "incomplete" | "incomplete_expired" | "paused";

export interface Subscription {
  status: SubscriptionStatus;
  plan: Plan | null;
  /** When the period paid for ends: the renewal, or the end of access once cancelled. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  customerId: string;
  subscriptionId: string;
  updatedAt: string;
}

const subscriptionKey = (accountId: string) => `account-subscription:v1:${accountId}`;
const customerKey = (customerId: string) => `stripe-customer:v1:${customerId}`;

/** Access follows payment: active or on trial, or past due while Stripe retries the card. */
export function entitled(subscription: Subscription | null, now = new Date()): boolean {
  if (!subscription) return false;
  if (subscription.status === "active" || subscription.status === "trialing") return true;
  // Past due: Stripe is retrying; access holds until the period paid for runs out.
  if (subscription.status === "past_due") return subscription.currentPeriodEnd != null && Date.parse(subscription.currentPeriodEnd) > now.getTime() - 7 * 86_400_000;
  return false;
}

export function billingReady(): boolean {
  return Boolean(runtimeSecret("STRIPE_SECRET_KEY") && runtimeSecret("STRIPE_PRICE_MONTHLY") && runtimeSecret("STRIPE_PRICE_ANNUAL"));
}

export async function readSubscription(accountId: string): Promise<Subscription | null> {
  return (await datasetCache()?.get<Subscription>(subscriptionKey(accountId), "json").catch(() => null)) ?? null;
}

async function saveSubscription(accountId: string, subscription: Subscription) {
  const cache = datasetCache();
  if (!cache) throw new Error("No store for subscriptions.");
  await cache.put(subscriptionKey(accountId), JSON.stringify(subscription));
  await cache.put(customerKey(subscription.customerId), accountId);
}

/* --- Stripe's REST API ---------------------------------------------------- */

/** Pure: nested parameters the way Stripe's form encoding writes them — line_items[0][price]=… */
export function formEncode(params: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((item, index) => parts.push(typeof item === "object" && item ? formEncode(item as Record<string, unknown>, `${name}[${index}]`) : `${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`));
    else if (typeof value === "object") parts.push(formEncode(value as Record<string, unknown>, name));
    else parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return parts.filter(Boolean).join("&");
}

async function stripe<T>(method: "GET" | "POST", path: string, params?: Record<string, unknown>): Promise<T> {
  const key = runtimeSecret("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Billing is not set up yet.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "POST" && params ? formEncode(params) : undefined,
  });
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Stripe answered ${response.status}.`);
  return body;
}

const priceFor = (plan: Plan) => runtimeSecret(plan === "monthly" ? "STRIPE_PRICE_MONTHLY" : "STRIPE_PRICE_ANNUAL");
const planFor = (priceId: string | undefined): Plan | null =>
  priceId && priceId === runtimeSecret("STRIPE_PRICE_MONTHLY") ? "monthly" : priceId && priceId === runtimeSecret("STRIPE_PRICE_ANNUAL") ? "annual" : null;

/** A Checkout page for the plan, for this account; Stripe hosts the card form. */
export async function checkoutUrl(input: { accountId: string; email: string | null; plan: Plan; origin: string }): Promise<string> {
  const price = priceFor(input.plan);
  if (!price) throw new Error("Billing is not set up yet.");
  const existing = await readSubscription(input.accountId);
  const session = await stripe<{ url: string }>("POST", "checkout/sessions", {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: input.accountId,
    ...(existing?.customerId ? { customer: existing.customerId } : input.email ? { customer_email: input.email } : {}),
    subscription_data: { metadata: { account: input.accountId } },
    metadata: { account: input.accountId },
    allow_promotion_codes: "true",
    success_url: `${input.origin}/t/welcome?step=account&checkout=success`,
    cancel_url: `${input.origin}/t/welcome?step=account&checkout=cancelled`,
  });
  return session.url;
}

/** Stripe's own page for the subscription: change plan, update the card, read invoices, cancel. */
export async function portalUrl(accountId: string, origin: string): Promise<string> {
  const subscription = await readSubscription(accountId);
  if (!subscription) throw new Error("No subscription on this account.");
  const session = await stripe<{ url: string }>("POST", "billing_portal/sessions", { customer: subscription.customerId, return_url: `${origin}/t/account` });
  return session.url;
}

/* --- The webhook ----------------------------------------------------------- */

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Pure but for the clock: is the Stripe-Signature header Stripe's, over this exact body, within five minutes? */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, now = Date.now()): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.split("=") as [string, string]);
  const stamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isFinite(stamp) || !signatures.length || Math.abs(now / 1000 - stamp) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${stamp}.${payload}`)));
  // Constant-time enough for a hex comparison of equal length.
  return signatures.some((signature) => signature.length === expected.length && [...signature].reduce((diff, char, index) => diff | (char.charCodeAt(0) ^ expected.charCodeAt(index)), 0) === 0);
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: SubscriptionStatus;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items: { data: Array<{ price: { id: string }; current_period_end?: number }> };
}

/** Pure: Stripe's subscription as this site keeps it. */
export function fromStripe(subscription: StripeSubscription, now = new Date()): Subscription {
  const item = subscription.items.data[0];
  const end = item?.current_period_end ?? subscription.current_period_end;
  return {
    status: subscription.status,
    plan: planFor(item?.price.id),
    currentPeriodEnd: end ? new Date(end * 1000).toISOString() : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    customerId: subscription.customer,
    subscriptionId: subscription.id,
    updatedAt: now.toISOString(),
  };
}

/** An event Stripe sent, applied: the account's subscription as Stripe now has it. */
export async function applyStripeEvent(event: { type: string; data: { object: Record<string, unknown> } }): Promise<string> {
  const object = event.data.object;
  if (event.type === "checkout.session.completed") {
    const accountId = (object.client_reference_id as string | null) ?? (object.metadata as Record<string, string> | undefined)?.account;
    const subscriptionId = object.subscription as string | null;
    if (!accountId || !subscriptionId) return "ignored: no account or subscription";
    await saveSubscription(accountId, fromStripe(await stripe<StripeSubscription>("GET", `subscriptions/${subscriptionId}`)));
    return `subscribed ${accountId}`;
  }
  if (event.type.startsWith("customer.subscription.")) {
    const subscription = object as unknown as StripeSubscription;
    const accountId = subscription.metadata?.account ?? (await datasetCache()?.get(customerKey(subscription.customer)).catch(() => null)) ?? null;
    if (!accountId) return "ignored: unknown customer";
    await saveSubscription(accountId, fromStripe(subscription));
    return `${subscription.status} ${accountId}`;
  }
  return `ignored: ${event.type}`;
}
