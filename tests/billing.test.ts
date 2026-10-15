import { afterEach, describe, expect, it } from "vitest";
import { entitled, formEncode, fromStripe, verifyStripeSignature, type Subscription } from "../lib/billing";
import { gateFor, paywallOn } from "../lib/paywall";

const sign = async (payload: string, secret: string, stamp: number) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${stamp}.${payload}`));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

describe("the paywall", () => {
  afterEach(() => { delete process.env.PAYWALL; });

  it("closes every terminal page and API, whatever the way in, and leaves the tour, the account and billing open", () => {
    for (const path of ["/t", "/t/market", "/t/s/AAPL", "/t/s/AAPL#kpi", "/t/portfolio", "/t/settings"]) expect(gateFor(path)).toBe("page");
    for (const path of ["/api/scan", "/api/io/AAPL/kpis", "/api/watchlist", "/api/rates"]) expect(gateFor(path)).toBe("api");
    for (const path of ["/t/welcome", "/t/account", "/api/account", "/api/account/oauth/google/start", "/api/billing", "/api/billing/webhook", "/tour/market.webp", "/_next/static/x.js", "/favicon.ico", "/robots.txt"]) expect(gateFor(path)).toBeNull();
    // Not a prefix trick: /t/welcomeX and /api/accounts are not the open paths.
    expect(gateFor("/t/welcomeX")).toBe("page");
    expect(gateFor("/api/accounts")).toBe("api");
  });

  it("stays off unless turned on", () => {
    expect(paywallOn()).toBe(false);
    process.env.PAYWALL = "on";
    expect(paywallOn()).toBe(true);
  });
});

describe("a subscription", () => {
  const base: Subscription = { status: "active", plan: "annual", currentPeriodEnd: "2027-10-15T00:00:00.000Z", cancelAtPeriodEnd: false, customerId: "cus_1", subscriptionId: "sub_1", updatedAt: "" };
  const now = new Date("2026-10-15T12:00:00Z");

  it("gives access while active or on trial, for a week while a payment is retried, and not once it has ended", () => {
    expect(entitled(base, now)).toBe(true);
    expect(entitled({ ...base, status: "trialing" }, now)).toBe(true);
    expect(entitled({ ...base, status: "past_due", currentPeriodEnd: "2026-10-12T00:00:00Z" }, now)).toBe(true);
    expect(entitled({ ...base, status: "past_due", currentPeriodEnd: "2026-09-01T00:00:00Z" }, now)).toBe(false);
    expect(entitled({ ...base, status: "canceled" }, now)).toBe(false);
    expect(entitled({ ...base, status: "unpaid" }, now)).toBe(false);
    expect(entitled(null, now)).toBe(false);
  });

  it("reads Stripe's subscription, the plan from its price", () => {
    process.env.STRIPE_PRICE_MONTHLY = "price_m"; process.env.STRIPE_PRICE_ANNUAL = "price_a";
    const kept = fromStripe({ id: "sub_9", customer: "cus_9", status: "active", cancel_at_period_end: true, metadata: { account: "acc" }, items: { data: [{ price: { id: "price_a" }, current_period_end: 1_823_000_000 }] } }, now);
    expect(kept).toMatchObject({ status: "active", plan: "annual", cancelAtPeriodEnd: true, customerId: "cus_9", subscriptionId: "sub_9" });
    expect(kept.currentPeriodEnd).toBe(new Date(1_823_000_000 * 1000).toISOString());
    delete process.env.STRIPE_PRICE_MONTHLY; delete process.env.STRIPE_PRICE_ANNUAL;
  });
});

describe("Stripe", () => {
  it("encodes nested parameters the way its API reads them", () => {
    expect(formEncode({ mode: "subscription", line_items: [{ price: "price_a", quantity: 1 }], subscription_data: { metadata: { account: "a b" } }, skip: null }))
      .toBe("mode=subscription&line_items%5B0%5D%5Bprice%5D=price_a&line_items%5B0%5D%5Bquantity%5D=1&subscription_data%5Bmetadata%5D%5Baccount%5D=a%20b");
  });

  it("accepts only an event signed with the endpoint's secret, over the exact body, within five minutes", async () => {
    const secret = "whsec_test";
    const payload = JSON.stringify({ type: "customer.subscription.updated" });
    const now = 1_790_000_000_000;
    const stamp = Math.floor(now / 1000);
    const good = await sign(payload, secret, stamp);
    expect(await verifyStripeSignature(payload, `t=${stamp},v1=${good}`, secret, now)).toBe(true);
    expect(await verifyStripeSignature(payload, `t=${stamp},v1=deadbeef,v1=${good}`, secret, now)).toBe(true);
    expect(await verifyStripeSignature(`${payload} `, `t=${stamp},v1=${good}`, secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, `t=${stamp},v1=${good}`, "whsec_other", now)).toBe(false);
    expect(await verifyStripeSignature(payload, `t=${stamp},v1=${good}`, secret, now + 600_000)).toBe(false);
    expect(await verifyStripeSignature(payload, null, secret, now)).toBe(false);
  });
});
