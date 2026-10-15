import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { Backtest } from "@/components/term/Backtest";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Backtest a trading rule · Tenkay",
  description: "Test a technical rule on daily prices: entries, exits, drawdown and the trades it would have made.",
  alternates: { canonical: "/t/backtest" },
};

/** The backtester (components/term/Backtest.tsx). */
export default function TerminalBacktest() {
  return (
    <TermShell>
      <Backtest />
    </TermShell>
  );
}
