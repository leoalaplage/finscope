import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import "@/app/free-screener.css";
import { ScreenerWorkspace } from "@/components/term/ScreenerWorkspace";
import { TermPage } from "@/components/term/TermPage";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "SCAN · FinScope Terminal", robots: { index: false, follow: false } };

/** The technical scanner, now a mode of the screener (components/term/ScreenerWorkspace.tsx). */
export default function TerminalScan() {
  return (
    <TermShell bare>
      <TermPage code="EQS"><ScreenerWorkspace initial="scan" /></TermPage>
    </TermShell>
  );
}
