import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { Screener } from "@/components/io/Screener";
import { TermPage } from "@/components/term/TermPage";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "EQS · FinScope Terminal", robots: { index: false, follow: false } };

/** The QS screener, in the terminal's frame (components/term/TermPage.tsx). */
export default function TerminalScreener() {
  return (
    <TermShell bare>
      <TermPage code="EQS"><Screener /></TermPage>
    </TermShell>
  );
}
