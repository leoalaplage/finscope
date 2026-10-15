import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { EconomyScreen } from "@/components/term/Economy";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "US economic calendar — CPI, jobs, Fed, against the consensus · Tenqay",
  description: "US economic releases as markets trade them: CPI, payrolls, PPI, retail sales, GDP and the Fed against the consensus, how the S&P 500 and the 10-year took them, and the official series.",
  alternates: { canonical: "/t/eco" },
};

/** ECO: the US economy as markets trade it (components/term/Economy.tsx). */
export default function TerminalEconomy() {
  return (
    <TermShell>
      <EconomyScreen />
    </TermShell>
  );
}
