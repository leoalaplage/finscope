import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import "@/app/free-screener.css";
import { ScreenerWorkspace } from "@/components/term/ScreenerWorkspace";
import { TermPage } from "@/components/term/TermPage";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "EQS · FinScope Terminal", robots: { index: false, follow: false } };

/** Custom fundamental searches and Quality Score in the terminal EQS screen. */
export default function TerminalScreener() {
  return (
    <TermShell bare>
      <TermPage code="EQS"><ScreenerWorkspace /></TermPage>
    </TermShell>
  );
}
