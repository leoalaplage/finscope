import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { MarketBoard } from "@/components/term/MarketBoard";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "MKT · FinScope Terminal", robots: { index: false, follow: false } };

/** The terminal's market screen (components/term/MarketBoard.tsx). */
export default function TerminalMarket() {
  return (
    <TermShell>
      <MarketBoard />
    </TermShell>
  );
}
