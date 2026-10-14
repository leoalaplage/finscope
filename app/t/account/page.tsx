import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { AccountPage } from "@/components/io/AccountPage";
import { TermPage } from "@/components/term/TermPage";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "ACCT · FinScope Terminal", robots: { index: false, follow: false } };

/** The reader's account — profile, sync, email alerts, passkeys, data — as a terminal screen (components/io/AccountPage.tsx). */
export default function TerminalAccount() {
  return (
    <TermShell bare>
      <TermPage code="ACCT"><AccountPage /></TermPage>
    </TermShell>
  );
}
