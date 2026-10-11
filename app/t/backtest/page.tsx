import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { Backtest } from "@/components/term/Backtest";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "BT · FinScope Terminal", robots: { index: false, follow: false } };

/** The backtester (components/term/Backtest.tsx). */
export default function TerminalBacktest() {
  return (
    <TermShell>
      <Backtest />
    </TermShell>
  );
}
