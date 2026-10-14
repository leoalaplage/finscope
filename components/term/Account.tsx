"use client";

import { useAccount } from "@/components/io/account";

/** In the top bar: the account's name, or the way in — to the account page of the site (components/io/AccountPage.tsx). */
export function AccountChip() {
  const { loaded, account } = useAccount();
  if (!loaded) return null;
  return (
    <a href="/t/account" className="t-account-chip" data-signed-in={account ? "" : undefined} title={account ? "Your account: sync and email alerts" : "Sign in to keep your work on every device"}>
      {account ? account.name.slice(0, 16).toUpperCase() : "SIGN IN"}
    </a>
  );
}
