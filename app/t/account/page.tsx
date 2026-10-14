import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { AccountPage } from "@/components/term/Account";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "ACCT · FinScope Terminal", robots: { index: false, follow: false } };

/** The reader's account: passkeys, sync between devices, the daily email (components/term/Account.tsx). */
export default function TerminalAccount() {
  return (
    <TermShell>
      <AccountPage />
    </TermShell>
  );
}
