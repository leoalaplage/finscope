import type { Metadata } from "next";
import "@/app/io.css";
import { AccountPage } from "@/components/io/AccountPage";
import { Shell } from "@/components/io/Shell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Account — FinScope.io",
  description: "Sign in with a passkey to keep your watchlists, portfolio and notes on every device, and get a daily email of what changed.",
  robots: { index: false, follow: false },
};

export default function Account() {
  return (
    <Shell>
      <AccountPage />
    </Shell>
  );
}
