"use client";

import { useEffect, useState } from "react";
import type { Plan, Subscription } from "@/lib/billing";

/** What the browser knows of billing (app/api/billing): whether it is set up, the paywall, and this account's subscription. */
export interface BillingState { billing: boolean; paywall: boolean; signedIn: boolean; subscription: Subscription | null; entitled: boolean }

async function read(): Promise<BillingState | null> {
  const response = await fetch("/api/billing", { cache: "no-store" }).catch(() => null);
  return response?.ok ? response.json() as Promise<BillingState> : null;
}

/**
 * The billing state, read once — or every two seconds for half a minute after
 * a checkout, until Stripe's webhook has recorded the new subscription.
 */
export function useBilling(waitForSubscription = false): BillingState | null {
  const [state, setState] = useState<BillingState | null>(null);
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const load = async () => {
      const next = await read();
      if (!alive) return;
      if (next) setState(next);
      if (waitForSubscription && !next?.entitled && ++tries < 15) setTimeout(load, 2000);
    };
    void load();
    return () => { alive = false; };
  }, [waitForSubscription]);
  return state;
}

async function post(path: string, body?: unknown): Promise<string> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const answer = await response.json().catch(() => ({})) as { url?: string; error?: string };
  if (!response.ok || !answer.url) throw new Error(answer.error ?? "Billing is unavailable just now.");
  return answer.url;
}

/** To Stripe Checkout for the plan. */
export async function startCheckout(plan: Plan) { window.location.assign(await post("/api/billing/checkout", { plan })); }

/** To Stripe's billing portal: change plan, card, invoices, cancel. */
export async function openBillingPortal() { window.location.assign(await post("/api/billing/portal")); }

export const SUPPORT_EMAIL = "contact@tenqay.com";
